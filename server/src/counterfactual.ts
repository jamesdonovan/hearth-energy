/**
 * "Without solar & Powerwall" comparator.
 *
 * Counterfactual: every kWh the home used (house + both cars, Powerwall "home usage" meter) is bought
 * from the grid on the same Intelligent Octopus Go tariff, priced at the import rate in effect in that
 * 5-minute (last ~10 days) or hourly (older) period. Battery charging is not counted, there is no export
 * income, and the standing charge is the same in both scenarios.
 *
 * Saving breakdown (each period priced at the same import rate r, so the parts reconcile):
 *   solar self-consumption  = solar used directly by the home           × r
 *   battery time-shift      = battery energy delivered to the home       × r  −  grid energy charged into the battery × r
 *   export income           = actual export earnings (same source as Financials)
 *   other / rounding        = saving − the three above  (metered Octopus import cost vs meter kWh × rate, timing at the edges)
 *
 * Read-only: long-term statistics only.
 */
import type { HaClient, StatisticPoint } from "./ha.js";
import { buildFinancials } from "./financials.js";
import { type Period, addDaysStr, parsePeriod, periodCacheKey } from "./period.js";
import { iogDispatches } from "./cars.js";
import { getVariables, isOffPeakMins, parseHhMm } from "./variables.js";

const TZ = "Europe/London";
function ctx() {
  const { site: s, tariff: t } = getVariables();
  const ID = {
    load: s.pw_home_usage,
    imp: s.pw_grid_imported,
    exp: s.pw_grid_exported,
    solar: s.pw_solar_generated,
    solarExp: s.pw_solar_exported,
    bCharged: s.pw_batt_charged,
    bDischarged: s.pw_batt_discharged,
    bFromGrid: s.pw_batt_from_grid,
    bFromSolar: s.pw_batt_from_solar,
    rate: t.import_rate,
  };
  return {
    ID,
    ENERGY_IDS: [ID.load, ID.imp, ID.exp, ID.solar, ID.solarExp, ID.bCharged, ID.bDischarged, ID.bFromGrid, ID.bFromSolar],
    PEAK: t.peak_gbp,
    OFF: t.offpeak_gbp,
    cheap: t.cheap_rate_gbp,
  };
}
const FIVE = 5 * 60 * 1000;
const HOUR = 3600 * 1000;

type Bucket = { start: number; ms: number; v: Record<string, number>; rate: number | null; fixedRate?: number };

/**
 * Hourly statistics can't see the 23:30 / 05:30 boundary. For those two hours, split the hour into its
 * peak and off-peak halves using how each meter's energy was actually split within that hour in the
 * 5-minute data (e.g. the cars and Powerwall start charging at 23:30), learned from the last ~10 days.
 */
function edgeHours() {
  const tf = getVariables().tariff;
  const a = parseHhMm(tf.off_peak_start) ?? 23 * 60 + 30;
  const b = parseHhMm(tf.off_peak_end) ?? 5 * 60 + 30;
  return { startH: Math.floor(a / 60), endH: Math.floor(b / 60) };
}

function learnSplits(five: Map<number, Bucket>): Record<number, Record<string, number>> {
  const { ENERGY_IDS } = ctx();
  const { startH, endH } = edgeHours();

  const acc: Record<number, Record<string, { off: number; all: number }>> = {};
  for (const b of five.values()) {
    const p = londonParts(b.start);
    const h = Math.floor(p.mins / 60);
    if (h !== startH && h !== endH) continue;
    const off = isOff(b.start);
    for (const [id, v] of Object.entries(b.v)) {
      const a = ((acc[h] ||= {})[id] ||= { off: 0, all: 0 });
      a.all += v;
      if (off) a.off += v;
    }
  }
  const out: Record<number, Record<string, number>> = {};
  for (const h of [startH, endH]) {
    out[h] = {};
    for (const id of ENERGY_IDS) {
      const a = acc[h]?.[id];
      out[h][id] = a && a.all > 0.5 ? a.off / a.all : 0.5;
    }
  }
  return out;
}

function splitStraddle(b: Bucket, splits: Record<number, Record<string, number>>): Bucket[] {
  const { PEAK, OFF, cheap } = ctx();

  if (b.ms !== HOUR) return [b];
  const { startH, endH } = edgeHours();
  const h = Math.floor(londonParts(b.start).mins / 60);
  if (h !== startH && h !== endH) return [b];
  // A daytime-style dispatch at the boundary (e.g. 05:30–06:00) shows up as a cheap average: keep it whole.
  if (b.rate != null && b.rate < (cheap ?? getVariables().tariff.cheap_rate_gbp)) return [b];
  const half = HOUR / 2;
  const offFirst = h === endH; // end hour is off then peak; start hour is peak then off
  const offV: Record<string, number> = {};
  const peakV: Record<string, number> = {};
  for (const [id, v] of Object.entries(b.v)) {
    const f = splits[h]?.[id] ?? 0.5;
    offV[id] = v * f;
    peakV[id] = v * (1 - f);
  }
  const off: Bucket = { start: offFirst ? b.start : b.start + half, ms: half, v: offV, rate: null, fixedRate: OFF };
  const peak: Bucket = { start: offFirst ? b.start + half : b.start, ms: half, v: peakV, rate: null, fixedRate: PEAK };
  return [off, peak];
}

function londonParts(ms: number) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value || "0";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, mins: Number(g("hour")) * 60 + Number(g("minute")) };
}
const isOff = (ms: number) => {
  const m = londonParts(ms).mins;
  const tf = getVariables().tariff;
  return isOffPeakMins(m, tf.off_peak_start, tf.off_peak_end);
};

/** IOG rate for [start, start+ms) from the schedule plus known dispatches (fallback when the rate statistic is missing). */
function scheduleRate(start: number, ms: number, dispatch: [number, number][]) {
  const { PEAK, OFF } = ctx();

  let sum = 0;
  let n = 0;
  for (let t = start; t < start + ms; t += FIVE) {
    const inDispatch = dispatch.some(([a, b]) => t >= a && t < b);
    sum += isOff(t) || inDispatch ? OFF : PEAK;
    n++;
  }
  return n ? sum / n : PEAK;
}
/** Fraction of the period inside a known IOG dispatch (house is on the cheap rate then). */
function dispatchFraction(start: number, ms: number, dispatch: [number, number][]) {
  let inD = 0;
  let n = 0;
  for (let t = start; t < start + ms; t += FIVE) {
    if (!isOff(t) && dispatch.some(([a, b]) => t >= a && t < b)) inD++;
    n++;
  }
  return n ? inD / n : 0;
}

function toBuckets(stats: Record<string, StatisticPoint[]>, ms: number): Map<number, Bucket> {
  const { ID, ENERGY_IDS } = ctx();

  const out = new Map<number, Bucket>();
  for (const id of ENERGY_IDS) {
    for (const p of stats[id] || []) {
      const c = p.change;
      if (c == null || !Number.isFinite(c)) continue;
      const b = out.get(p.start) || { start: p.start, ms, v: {}, rate: null };
      // Daily-reset Powerwall totals: a negative change is a reset artefact, never real energy.
      b.v[id] = Math.max(0, c);
      out.set(p.start, b);
    }
  }
  for (const p of stats[ID.rate] || []) {
    const b = out.get(p.start);
    if (b && p.mean != null && Number.isFinite(p.mean)) b.rate = p.mean;
  }
  return out;
}

type Acc = {
  load_kwh: number;
  cf_energy_gbp: number;
  solar_direct_kwh: number;
  solar_value_gbp: number;
  battery_to_home_kwh: number;
  battery_to_home_gbp: number;
  battery_grid_charge_kwh: number;
  battery_grid_charge_gbp: number;
  import_kwh: number;
  import_model_gbp: number;
  peak_load_kwh: number;
  off_load_kwh: number;
  dispatch_load_kwh: number;
  buckets_5min: number;
  buckets_hour: number;
};
const zero = (): Acc => ({ load_kwh: 0, cf_energy_gbp: 0, solar_direct_kwh: 0, solar_value_gbp: 0, battery_to_home_kwh: 0, battery_to_home_gbp: 0, battery_grid_charge_kwh: 0, battery_grid_charge_gbp: 0, import_kwh: 0, import_model_gbp: 0, peak_load_kwh: 0, off_load_kwh: 0, dispatch_load_kwh: 0, buckets_5min: 0, buckets_hour: 0 });

/** Per-day tariff: the rates Octopus actually billed that day and how much schedule-peak import it billed at off-peak. */
type DayTariff = { peak: number; off: number; fd: number; source: "rate_stat" | "billed" | "default" };

/** Base rate for a bucket before calibration: the rate statistic if present, otherwise the day's billed peak/off-peak by schedule. */
function baseRate(b: Bucket, t: DayTariff, dispatch: [number, number][]): { r: number; dFrac: number; peakish: boolean } {
  const { PEAK, OFF } = ctx();
  const dFrac = dispatchFraction(b.start, b.ms, dispatch);
  let r: number;
  if (b.fixedRate != null) r = b.fixedRate === OFF ? t.off : t.peak;
  else if (b.rate != null && b.rate > 0.01 && b.rate < 1) r = b.rate;
  else {
    const sched = scheduleRate(b.start, b.ms, []);
    const f = (PEAK - sched) / (PEAK - OFF); // off-peak share of the bucket by the clock
    r = t.peak * (1 - f) + t.off * f;
  }
  if (dFrac > 0) r = r * (1 - dFrac) + t.off * dFrac;
  return { r, dFrac, peakish: r > (t.peak + t.off) / 2 };
}

function add(acc: Acc, b: Bucket, t: DayTariff, dispatch: [number, number][]) {
  const { ID } = ctx();

  const g = (id: string) => b.v[id] ?? 0;
  const load = g(ID.load);
  const { r, dFrac, peakish } = baseRate(b, t, dispatch);
  // Tesla's solar_exported sensor tracks solar generated here, so it can't be used. Export is
  // attributed to solar first (whatever solar didn't put into the battery), the rest to the battery.
  const solarAvail = Math.max(0, g(ID.solar) - g(ID.bFromSolar));
  const solarToGrid = Math.min(g(ID.exp), solarAvail);
  const solarDirect = Math.max(0, solarAvail - solarToGrid);
  const gridToHome = Math.max(0, g(ID.imp) - g(ID.bFromGrid));
  const battToHome = Math.max(0, load - solarDirect - gridToHome);
  // Import Octopus billed at off-peak although the clock/rate said peak = IOG dispatches nobody recorded
  // (fd from the day's metered peak kWh). That energy went to the home (cars), so it is on the cheap rate on both sides.
  const dk = peakish && t.fd > 0 ? Math.min(g(ID.imp) * t.fd, gridToHome) : 0;
  acc.load_kwh += load;
  acc.cf_energy_gbp += load * r - dk * (r - t.off);
  acc.solar_direct_kwh += solarDirect;
  acc.solar_value_gbp += solarDirect * r;
  acc.battery_to_home_kwh += battToHome;
  acc.battery_to_home_gbp += battToHome * r;
  acc.battery_grid_charge_kwh += g(ID.bFromGrid);
  acc.battery_grid_charge_gbp += g(ID.bFromGrid) * r;
  acc.import_kwh += g(ID.imp);
  acc.import_model_gbp += g(ID.imp) * r - dk * (r - t.off);
  const offFrac = (() => {
    let o = 0;
    let n = 0;
    for (let t = b.start; t < b.start + b.ms; t += FIVE) {
      if (isOff(t)) o++;
      n++;
    }
    return n ? o / n : 0;
  })();
  acc.off_load_kwh += load * offFrac;
  acc.dispatch_load_kwh += load * dFrac + dk;
  acc.peak_load_kwh += Math.max(0, load * Math.max(0, 1 - offFrac - dFrac) - dk);
  if (b.ms === FIVE) acc.buckets_5min++;
  else acc.buckets_hour++;
}

function startOfLondonDay(dateStr: string): number {
  // find the UTC instant of 00:00 London on dateStr
  const guess = Date.parse(`${dateStr}T00:00:00Z`);
  for (const off of [0, -HOUR, HOUR]) {
    const t = guess + off;
    const p = londonParts(t);
    if (p.date === dateStr && p.mins === 0) return t;
  }
  return guess;
}

const cache = new Map<string, { at: number; data: unknown }>();

function sumAcc(list: Acc[]): Acc {
  const t = zero();
  for (const a of list) for (const k of Object.keys(t) as (keyof Acc)[]) t[k] += a[k];
  return t;
}

/** Long-term statistics in ≤45-day slices so a 12-month request doesn't become one huge websocket reply. */
async function statsChunked(ha: HaClient, ids: string[], start: number, end: number, period: "hour" | "5minute") {
  const out: Record<string, StatisticPoint[]> = {};
  const step = 45 * 86400000;
  const slices: [number, number][] = [];
  for (let a = start; a < end; a += step) slices.push([a, Math.min(end, a + step)]);
  const parts = await Promise.all(slices.map(([a, b]) => ha.statisticsDuringPeriod(ids, new Date(a).toISOString(), new Date(b).toISOString(), period)));
  for (const part of parts) for (const [id, pts] of Object.entries(part)) (out[id] ||= []).push(...pts);
  return out;
}

const fmtDay = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T12:00:00Z`));

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function counterfactual(ha: HaClient, periodOrDays: Period | number, now = new Date()) {
  const { ID, ENERGY_IDS, PEAK, OFF } = ctx();

  const period: Period = typeof periodOrDays === "number" ? parsePeriod({ days: periodOrDays }, now) : periodOrDays;
  const days = period.days;
  const key = periodCacheKey(period);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
  const fin = await buildFinancials(ha, period);
  const startDate = fin.window.start;
  const start = startOfLondonDay(startDate);
  const end = period.includes_today ? now.getTime() : startOfLondonDay(addDaysStr(period.end, 1));
  const fiveFrom = Math.max(start, now.getTime() - 9.5 * 86400000);

  const ids = [...ENERGY_IDS, ID.rate];
  const [hourly, five] = await Promise.all([
    statsChunked(ha, ids, start, end, "hour"),
    fiveFrom < end ? ha.statisticsDuringPeriod(ids, new Date(fiveFrom).toISOString(), new Date(end).toISOString(), "5minute") : Promise.resolve({}),
  ]);
  const hB = toBuckets(hourly, HOUR);
  const fB = toBuckets(five, FIVE);

  const dispatch: [number, number][] = iogDispatches(ha)
    .completed.map((d) => [Date.parse(d.start), Date.parse(d.end)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);

  let splits = learnSplits(fB);
  if (fiveFrom > start || fiveFrom >= end) {
    // Learn the 23:30 / 05:30 split from the latest ~10 days even when the window itself is older.
    try {
      const recentFrom = now.getTime() - 9.5 * 86400000;
      splits = learnSplits(toBuckets(await ha.statisticsDuringPeriod(ENERGY_IDS, new Date(recentFrom).toISOString(), now.toISOString(), "5minute"), FIVE));
    } catch {
      /* keep what we have */
    }
  }
  const perDay = new Map<string, Acc>();
  let lastCovered = start;
  const dayBuckets = new Map<string, Bucket[]>();
  const use = (b: Bucket) => {
    const d = londonParts(b.start).date;
    const list = dayBuckets.get(d) || [];
    list.push(b);
    dayBuckets.set(d, list);
    lastCovered = Math.max(lastCovered, b.start + b.ms);
  };
  // Hour by hour: use the twelve 5-minute buckets when all are there (exact 23:30 / 05:30 split and
  // dispatch edges), otherwise the hourly statistic.
  const hourStarts = new Set<number>([...hB.keys()].filter((t) => t >= start));
  for (const t of fB.keys()) hourStarts.add(t - (t % HOUR));
  for (const h of [...hourStarts].sort((a, b) => a - b)) {
    if (h < start) continue;
    const fives: Bucket[] = [];
    for (let t = h; t < h + HOUR; t += FIVE) {
      const b = fB.get(t);
      if (b && b.v[ID.load] != null) fives.push(b);
    }
    const hb = hB.get(h);
    if (fives.length === 12 || (!hb && fives.length)) fives.forEach(use);
    else if (hb && hb.v[ID.load] != null) splitStraddle(hb, splits).forEach(use);
  }

  // Billed rates per day from Octopus' settled peak / off-peak cost and kWh (these are dispatch-aware),
  // falling back to that month's billed average, then the current IOG rates.
  const billed = new Map<string, { peak: number | null; off: number | null; peakKwh: number | null }>();
  const monthAgg = new Map<string, { pc: number; pk: number; oc: number; ok: number }>();
  for (const r of fin.daily) {
    if (r.peak_source !== "metered") continue;
    const peak = r.peak_kwh != null && r.peak_kwh > 1 && r.peak_cost_gbp != null ? r.peak_cost_gbp / r.peak_kwh : null;
    const off = r.offpeak_kwh != null && r.offpeak_kwh > 1 && r.offpeak_cost_gbp != null ? r.offpeak_cost_gbp / r.offpeak_kwh : null;
    billed.set(r.date, { peak: peak != null && peak > 0.15 && peak < 0.6 ? peak : null, off: off != null && off > 0.02 && off < 0.15 ? off : null, peakKwh: r.peak_kwh });
    const m = monthAgg.get(r.date.slice(0, 7)) || { pc: 0, pk: 0, oc: 0, ok: 0 };
    m.pc += r.peak_cost_gbp ?? 0; m.pk += r.peak_kwh ?? 0; m.oc += r.offpeak_cost_gbp ?? 0; m.ok += r.offpeak_kwh ?? 0;
    monthAgg.set(r.date.slice(0, 7), m);
  }
  const tariffs = new Map<string, DayTariff>();
  const tariffSources = { rate_stat: 0, billed: 0, default: 0 };
  let fdKwh = 0;
  for (const [d, list] of dayBuckets) {
    const bl = billed.get(d);
    const m = monthAgg.get(d.slice(0, 7));
    const mPeak = m && m.pk > 10 ? m.pc / m.pk : null;
    const mOff = m && m.ok > 10 ? m.oc / m.ok : null;
    const hasStat = list.some((b) => b.rate != null && b.rate > 0.01);
    const t: DayTariff = {
      peak: hasStat ? PEAK : bl?.peak ?? (mPeak != null && mPeak > 0.15 && mPeak < 0.6 ? mPeak : PEAK),
      off: hasStat ? OFF : bl?.off ?? (mOff != null && mOff > 0.02 && mOff < 0.15 ? mOff : OFF),
      fd: 0,
      source: hasStat ? "rate_stat" : bl?.peak != null || mPeak != null ? "billed" : "default",
    };
    if (hasStat) {
      // With a rate statistic, use that day's own peak/off levels for any split straddle halves.
      const rs = list.map((b) => b.rate).filter((x): x is number => x != null && x > 0.01);
      t.peak = Math.max(...rs, OFF) > 0.2 ? Math.max(...rs) : PEAK;
      t.off = Math.min(...rs, PEAK) < 0.15 ? Math.min(...rs) : OFF;
    }
    // Calibrate unseen dispatches against the metered peak kWh.
    if (bl?.peakKwh != null) {
      let pSched = 0;
      for (const b of list) {
        const { dFrac, peakish } = baseRate(b, t, dispatch);
        if (peakish) pSched += (b.v[ID.imp] ?? 0) * (1 - dFrac);
      }
      if (pSched > 0.5) t.fd = Math.min(1, Math.max(0, (pSched - bl.peakKwh) / pSched));
      fdKwh += Math.max(0, pSched - bl.peakKwh);
    }
    tariffs.set(d, t);
    tariffSources[t.source]++;
    const acc = zero();
    for (const b of list) add(acc, b, t, dispatch);
    perDay.set(d, acc);
  }

  // Like-for-like: only days that have both Powerwall energy history and Octopus costs count on either side.
  const finByDate = new Map(fin.daily.map((d) => [d.date, d]));
  const comparable = [...perDay.entries()]
    .filter(([d, a]) => a.load_kwh > 0.05 && finByDate.get(d)?.net_cost_gbp != null)
    .map(([d]) => d)
    .sort();
  const total = sumAcc(comparable.map((d) => perDay.get(d)!));
  const rows = comparable.map((d) => finByDate.get(d)!);
  const sumOf = (f: (r: (typeof rows)[number]) => number | null | undefined) => rows.reduce((t, r) => t + (f(r) ?? 0), 0);
  const standing = sumOf((r) => r.standing_gbp);
  const actualNet = sumOf((r) => r.net_cost_gbp);
  const exportIncome = sumOf((r) => r.export_earnings_gbp);
  const importCost = sumOf((r) => r.import_cost_gbp);
  const actualImportEnergy = importCost - standing;
  const finDays = fin.daily.filter((r) => r.import_cost_gbp != null || r.export_earnings_gbp != null).length;
  const compFrom = comparable[0] ?? null;
  const compTo = comparable[comparable.length - 1] ?? null;
  const compPartial = comparable.length < days;
  const todayIn = compTo === period.today && period.includes_today;
  const todayFrac = Math.min(1, Math.max(0.02, (now.getTime() - startOfLondonDay(period.today)) / 86400000));
  const compElapsed = Math.max(0.04, comparable.length - (todayIn ? 1 - todayFrac : 0));
  const compNote = !comparable.length
    ? "No Powerwall energy history in this period, so there is nothing to compare."
    : compPartial
      ? `Comparator covers ${comparable.length} of ${days} days${compFrom && compFrom > startDate ? `, data from ${fmtDay(compFrom)}` : ""} (days with both Powerwall energy history and Octopus costs${finDays > comparable.length ? `; ${finDays - comparable.length} other day(s) have costs but no Powerwall history and are left out of both sides` : ""}).`
      : null;
  const cfTotal = total.cf_energy_gbp + standing;
  const saving = cfTotal - actualNet;
  const batteryShift = total.battery_to_home_gbp - total.battery_grid_charge_gbp;
  const residual = saving - (total.solar_value_gbp + batteryShift + exportIncome);
  const elapsedDays = compElapsed;
  const coveredDays = Math.max(0.04, (lastCovered - start) / 86400000);
  const perDaySaving = saving / elapsedDays;

  const dailyRows = [...perDay.entries()]
    .filter(([d]) => comparable.includes(d))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, a]) => {
      const f = fin.daily.find((d) => d.date === date);
      return {
        date,
        load_kwh: Math.round(a.load_kwh * 10) / 10,
        pw_home_usage_kwh: f?.load_kwh != null ? Math.round(f.load_kwh * 10) / 10 : null,
        counterfactual_gbp: r2(a.cf_energy_gbp + (f?.standing_gbp ?? 0)),
        actual_net_gbp: f?.net_cost_gbp != null ? r2(f.net_cost_gbp) : null,
        saving_gbp: f?.net_cost_gbp != null ? r2(a.cf_energy_gbp + (f?.standing_gbp ?? 0) - f.net_cost_gbp) : null,
        import_kwh: Math.round(a.import_kwh * 10) / 10,
        import_model_gbp: r2(a.import_model_gbp),
        import_metered_gbp: f?.import_cost_gbp != null ? r2(f.import_cost_gbp - (f.standing_gbp ?? 0)) : null,
        avg_cf_rate_p: a.load_kwh > 0 ? Math.round((a.cf_energy_gbp / a.load_kwh) * 1000) / 10 : null,
      };
    });

  const data = {
    days,
    period: fin.period,
    coverage: { requested_start: startDate, requested_end: period.end, requested_days: days, data_from: compFrom, data_to: compTo, days_with_data: comparable.length, partial: compPartial, note: compNote },
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), covered_until: new Date(lastCovered).toISOString(), elapsed_days: Math.round(elapsedDays * 100) / 100, covered_days: Math.round(coveredDays * 100) / 100 },
    counterfactual: {
      total_gbp: r2(cfTotal),
      energy_gbp: r2(total.cf_energy_gbp),
      standing_gbp: r2(standing),
      load_kwh: Math.round(total.load_kwh * 10) / 10,
      avg_rate_p: total.load_kwh > 0 ? Math.round((total.cf_energy_gbp / total.load_kwh) * 1000) / 10 : null,
      peak_kwh: Math.round(total.peak_load_kwh * 10) / 10,
      offpeak_kwh: Math.round(total.off_load_kwh * 10) / 10,
      dispatch_kwh: Math.round(total.dispatch_load_kwh * 10) / 10,
    },
    actual: { net_gbp: r2(actualNet), import_gbp: r2(importCost), export_gbp: r2(exportIncome), standing_gbp: r2(standing) },
    saving: { gbp: r2(saving), pct: cfTotal > 0 ? Math.round((saving / cfTotal) * 1000) / 10 : null },
    breakdown: {
      solar_self_consumption_gbp: r2(total.solar_value_gbp),
      solar_self_consumption_kwh: Math.round(total.solar_direct_kwh * 10) / 10,
      battery_time_shift_gbp: r2(batteryShift),
      battery_to_home_kwh: Math.round(total.battery_to_home_kwh * 10) / 10,
      battery_to_home_value_gbp: r2(total.battery_to_home_gbp),
      battery_grid_charge_kwh: Math.round(total.battery_grid_charge_kwh * 10) / 10,
      battery_grid_charge_cost_gbp: r2(total.battery_grid_charge_gbp),
      export_income_gbp: r2(exportIncome),
      other_gbp: r2(residual),
      import_model_gbp: r2(total.import_model_gbp),
      import_metered_gbp: r2(actualImportEnergy),
    },
    projection: {
      per_day_gbp: r2(perDaySaving),
      per_month_gbp: r2(perDaySaving * 30.44),
      per_year_gbp: r2(perDaySaving * 365),
      based_on_days: Math.round(elapsedDays * 10) / 10,
    },
    daily: dailyRows,
    tariff_days: tariffSources,
    calibrated_dispatch_kwh: Math.round(fdKwh * 10) / 10,
    resolution: { five_minute_buckets: total.buckets_5min, hourly_buckets: total.buckets_hour, boundary_splits: { "23:00": Math.round((splits[23]?.[ID.load] ?? 0.5) * 100) / 100, "05:00": Math.round((splits[5]?.[ID.load] ?? 0.5) * 100) / 100 } },
    method: [
      "Counterfactual = every kWh the home used (the configured home-usage meter: house plus cars; battery charging is not load) bought from the grid at the tariff rates, with no solar, no battery and no export.",
      "Solar used directly = solar generated − solar into the battery − the part of grid export that solar could have supplied (Tesla's own 'solar exported' counter isn't usable here). Export beyond that is counted as battery export.",
      "Each period is priced at the import rate in effect then, from the configured Octopus rate statistic. 5-minute statistics are used where Home Assistant still has them (about the last 10 days), hourly ones before that; for older hours that straddle the off-peak start or end, each meter's energy is split between the peak and off-peak half using how it split in the recent 5-minute data.",
      "Rates: where Home Assistant has the Octopus rate statistic (from Sept 2026) it is used directly. Before that, each day uses the peak and off-peak rates Octopus actually billed that day (settled peak cost ÷ peak kWh, off-peak likewise — e.g. about 30–31p / 5.9p in mid-2026), falling back to that month's billed average.",
      "Assumption: daytime IOG dispatch slots stay at the off-peak rate, because they come from the Tesla being on IOG, which would still happen without solar or a Powerwall. Known completed dispatches are priced off-peak, and on settled days any import that fell in peak time but that Octopus billed as off-peak (an unrecorded dispatch) is treated as dispatch energy on both sides.",
      "Actual = the existing Financials figure: Octopus import cost (incl. standing charge) minus export earnings, summed over the same days as the counterfactual (days with both Powerwall energy history and Octopus costs). Powerwall energy statistics in Home Assistant start 11 Jan 2026, so longer periods are compared from then.",
      "The standing charge is added to both, so it is shown but does not change the saving.",
      "Breakdown, each period at the same rate: solar self-consumption = solar used directly in the home (above); battery time-shift = (home load − solar used directly − grid used directly) valued at the rate then, minus the cost of grid energy charged into the battery; export income = actual export earnings (includes battery exports). 'Other / rounding' is what is left: mainly metered Octopus import cost vs Powerwall meter kWh × rate, plus timing at the window edges.",
      "Projection = average saving per day in this window × 30.44 or × 365. It is an extrapolation: solar and export vary a lot by season, so a winter window understates a year.",
    ],
  };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  return data;
}
