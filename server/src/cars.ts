import type { HaClient, HaEntity, StatisticPoint } from "./ha.js";
import { num } from "./ha.js";
import { carStatus } from "./lastgood.js";
import { addDays, londonDate, londonInstant, londonMinutes, nextLondon, parsePredbatLocal } from "./time.js";
import { getVariables, iogDispatchId, kiaLike, parseHhMm, teslaLike, vehiclePowerFallback, vehiclePowerId } from "./variables.js";

export type CarKey = string;
export type CarCfg = {
  name: string;
  predbatIndex: number;
  slot: string;
  soc: string;
  socPlan: string;
  power: string;
  powerFallback?: string;
  socEntity: string;
  odometer?: string;
};

export function importRateId() {
  return getVariables().tariff.import_rate;
}
export const IMPORT_RATE_ID = () => importRateId();

function iogDispatch() {
  return iogDispatchId(getVariables()) || "";
}

export function carsNow(): Record<CarKey, CarCfg> {
  const v = getVariables();
  const out: Record<CarKey, CarCfg> = {};
  for (const car of v.vehicles) {
    out[car.id] = {
      name: car.name,
      predbatIndex: car.predbat_index ?? 0,
      slot: car.predbat_slot || "",
      soc: car.predbat_soc || "",
      socPlan: car.predbat_soc || "",
      power: vehiclePowerId(v, car) || "",
      powerFallback: vehiclePowerFallback(v, car),
      socEntity: car.soc,
      odometer: car.odometer || undefined,
    };
  }
  return out;
}

/** Live view of configured cars (tesla / ev9 and any added later). */
export const CARS = new Proxy({} as Record<CarKey, CarCfg>, {
  get(_t, prop: string | symbol) {
    if (prop === "then") return undefined;
    if (typeof prop !== "string") return undefined;
    return carsNow()[prop];
  },
  ownKeys() { return Object.keys(carsNow()); },
  getOwnPropertyDescriptor(_t, prop) {
    const c = carsNow();
    if (typeof prop === "string" && prop in c) return { configurable: true, enumerable: true, value: c[prop] };
    return undefined;
  },
});

export type PlannedSlot = { start: string; end: string; kwh: number | null; cost_p: number | null; rate_p: number | null };

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalise Predbat's `planned` attribute (times are London wall clock "MM-DD HH:MM:SS"). */
export function normalizeSlots(planned: unknown, ref = new Date()): PlannedSlot[] {
  if (!Array.isArray(planned)) return [];
  const out: PlannedSlot[] = [];
  for (const p of planned as Record<string, unknown>[]) {
    const s = parsePredbatLocal(p.start, ref);
    const e = parsePredbatLocal(p.end, ref);
    if (!s || !e) continue;
    out.push({
      start: s.toISOString(),
      end: e.toISOString(),
      kwh: asNum(p.kwh ?? p.kWh),
      cost_p: asNum(p.cost),
      rate_p: asNum(p.average ?? p.rate),
    });
  }
  return out;
}

/** Value of a Predbat `results` time-series at or just before `at`. */
export function seriesAt(results: unknown, at: Date): number | null {
  if (!results || typeof results !== "object") return null;
  let best: { t: number; v: number } | null = null;
  for (const [k, v] of Object.entries(results as Record<string, unknown>)) {
    const t = Date.parse(k.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const n = Number(v);
    if (!Number.isFinite(t) || !Number.isFinite(n)) continue;
    if (t <= at.getTime() && (!best || t > best.t)) best = { t, v: n };
  }
  return best?.v ?? null;
}

export function morningTarget(ha: HaClient, from = new Date()): Date {
  const sel = ha.get(getVariables().predbat.car_charging_plan_time)?.state || "07:00:00";
  const [h, m] = sel.split(":").map(Number);
  return nextLondon(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, from);
}

/** Live Predbat plan for one car (sourced from Predbat, not the charger, so it is populated during the day too). */
export function carPlan(ha: HaClient, key: CarKey, now = new Date()) {
  const c = CARS[key];
  if (!c) {
    return {
      car: key,
      name: key,
      slot_active: false,
      slots: [] as PlannedSlot[],
      planned_kwh: null as number | null,
      planned_cost_p: null as number | null,
      avg_rate_p: null as number | null,
      next_start: null as string | null,
      soc_now: null as number | null,
      soc_predbat_now: null as number | null,
      soc_morning: null as number | null,
      morning_at: morningTarget(ha, now).toISOString(),
      data_status: carStatus(key, now),
    };
  }
  const slotEnt = ha.get(c.slot);
  const slots = normalizeSlots(slotEnt?.attributes?.planned, now);
  const totalKwh = asNum(slotEnt?.attributes?.kwh ?? slotEnt?.attributes?.kWh) ?? (slots.length ? slots.reduce((a, s) => a + (s.kwh || 0), 0) : null);
  const totalCost = asNum(slotEnt?.attributes?.cost) ?? (slots.length ? slots.reduce((a, s) => a + (s.cost_p || 0), 0) : null);
  const target = morningTarget(ha, now);
  const socEnt = ha.get(c.socPlan);
  const startEnt = ha.get(getVariables().vehicles.find((x) => x.id === key)?.predbat_start || "");
  return {
    car: key,
    name: c.name,
    slot_active: slotEnt?.state === "on",
    slots,
    planned_kwh: totalKwh,
    planned_cost_p: totalCost,
    avg_rate_p: totalKwh && totalCost != null && totalKwh > 0 ? totalCost / totalKwh : null,
    next_start: (startEnt?.attributes?.timestamp as string | null) || null,
    soc_now: num(ha.get(c.socEntity)) ?? num(socEnt),
    soc_predbat_now: asNum(socEnt?.attributes?.today) ?? num(socEnt),
    soc_morning: seriesAt(socEnt?.attributes?.results, target) ?? num(ha.get(c.socEntity)),
    morning_at: target.toISOString(),
    data_status: carStatus(key, now),
  };
}

/** IOG dispatches for the Tesla (the whole house gets the cheap rate during these). */
export function iogDispatches(ha: HaClient) {
  const e = ha.get(iogDispatch());
  const map = (arr: unknown) =>
    (Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []).map((d) => ({
      start: String(d.start ?? ""),
      end: String(d.end ?? ""),
      kwh: asNum(d.charge_in_kwh) != null ? Math.abs(asNum(d.charge_in_kwh)!) : null,
      source: d.source ? String(d.source) : null,
    }));
  return { active: e?.state === "on", planned: map(e?.attributes?.planned_dispatches), completed: map(e?.attributes?.completed_dispatches) };
}

export function isExtraIogSlot(start: string, end: string) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  for (let t = s; t < e; t += 5 * 60000) {
    const m = londonMinutes(t);
    const tf = getVariables().tariff;
    const a = parseHhMm(tf.off_peak_start) ?? 23 * 60 + 30;
    const b = parseHhMm(tf.off_peak_end) ?? 5 * 60 + 30;
    const off = a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
    if (!off) return true;
  }
  return false;
}

// ---------- energy from statistics ----------

type Stat = StatisticPoint;

function rateLookup(rate: Stat[] | undefined) {
  const m = new Map<number, number>();
  for (const p of rate || []) {
    const v = p.mean ?? p.state;
    if (v != null && Number.isFinite(v)) m.set(p.start, v);
  }
  return m;
}

/** kWh and £ from mean-power statistics × the import-rate statistic for the same bucket. */
const homeMaxKw = () => getVariables().site.home_max_kw || 11.5;

type Interval = { s: number; e: number };
function inAny(iv: Interval[] | null, t: number) {
  if (!iv) return true;
  return iv.some((x) => t >= x.s && t < x.e);
}

function integrate(
  power: Stat[] | undefined,
  rate: Stat[] | undefined,
  bucketMin: number,
  startMs: number,
  endMs: number,
  opts: { home?: Interval[] | null; cheap?: Interval[]; exclude?: Set<number> } = {},
) {
  const rates = rateLookup(rate);
  const rateVals = [...rates.values()];
  const fallbackRate = rateVals.length ? rateVals[rateVals.length - 1] : getVariables().tariff.offpeak_gbp;
  let kwh = 0;
  let gbp = 0;
  let cheapKwh = 0;
  let firstOn: number | null = null;
  let lastOn: number | null = null;
  for (const p of power || []) {
    if (p.start < startMs || p.start >= endMs) continue;
    const kw = p.mean ?? 0;
    if (!Number.isFinite(kw) || kw <= 0.02) continue;
    if ((p.max ?? kw) > homeMaxKw()) continue; // DC / away session
    if (!inAny(opts.home ?? null, p.start + (bucketMin * 60000) / 2)) continue;
    if (opts.exclude?.has(p.start)) continue;
    const e = (kw * bucketMin) / 60;
    let r = rates.get(p.start) ?? fallbackRate;
    // IOG dispatches bill the whole house at the off-peak rate even when the rate sensor caught up late
    if (opts.cheap?.length) {
      const mid = p.start + (bucketMin * 60000) / 2;
      if (inAny(opts.cheap, mid)) r = Math.min(r, getVariables().tariff.offpeak_gbp);
    }
    kwh += e;
    gbp += e * r;
    if (r < getVariables().tariff.cheap_rate_gbp) cheapKwh += e;
    if (kw > 0.5) {
      if (firstOn == null) firstOn = p.start;
      lastOn = p.start + bucketMin * 60000;
    }
  }
  return {
    kwh: Math.round(kwh * 100) / 100,
    cost_gbp: Math.round(gbp * 100) / 100,
    cheap_share: kwh > 0 ? cheapKwh / kwh : null,
    first_on: firstOn ? new Date(firstOn).toISOString() : null,
    last_on: lastOn ? new Date(lastOn).toISOString() : null,
  };
}

function lastBefore<T extends { last_changed?: string; last_updated?: string }>(series: T[] | undefined, t: number): T | null {
  let best: T | null = null;
  for (const p of series || []) {
    const pt = Date.parse(p.last_changed || p.last_updated || "");
    if (Number.isFinite(pt) && pt <= t) best = p;
  }
  return best;
}

/** "Last night" = 17:00 yesterday → 09:00 today London (or → now while it is still in progress). */
export function lastNightWindow(now = new Date()) {
  const today = londonDate(now);
  const mins = londonMinutes(now);
  const tf = getVariables().tariff;
  const offStart = parseHhMm(tf.off_peak_start) ?? 23 * 60 + 30;
  const offEnd = parseHhMm(tf.off_peak_end) ?? 5 * 60 + 30;
  const offStartH = Math.floor(offStart / 60), offStartM = offStart % 60;
  const offEndH = Math.floor(offEnd / 60), offEndM = offEnd % 60;
  // Until tonight's off-peak starts the most recent night is the one that ended this morning,
  // so the evening shows last night's finished result rather than an empty "in progress" night.
  const eveningDate = mins >= offStart ? today : addDays(today, -1);
  const start = londonInstant(eveningDate, 17, 0);
  const offPeakStart = londonInstant(eveningDate, offStartH, offStartM);
  const morning = addDays(eveningDate, 1);
  const end = londonInstant(morning, 9, 0);
  const offPeakEnd = londonInstant(morning, offEndH, offEndM);
  return { date: eveningDate, start, end: new Date(Math.min(end.getTime(), now.getTime())), nominalEnd: end, offPeakStart, offPeakEnd, morningAt: londonInstant(morning, 7, 0), complete: now >= end };
}

let lastNightCache: { at: number; key: string; data: unknown } | null = null;

/** Planned (from Predbat's own history) vs actual (charger power + car SoC) for the most recent night. */
export async function lastNight(ha: HaClient, now = new Date()) {
  const w = lastNightWindow(now);
  const key = w.date;
  if (lastNightCache && lastNightCache.key === key && Date.now() - lastNightCache.at < 5 * 60000) return lastNightCache.data as Awaited<ReturnType<typeof buildLastNight>>;
  const data = await buildLastNight(ha, w);
  lastNightCache = { at: Date.now(), key, data };
  return data;
}

async function buildLastNight(ha: HaClient, w: ReturnType<typeof lastNightWindow>) {
  const startIso = w.start.toISOString();
  const endIso = w.end.toISOString();
  const cars = carsNow();
  const keys = Object.keys(cars);
  const ids = keys.flatMap((k) => [cars[k].slot, cars[k].socPlan, cars[k].socEntity].filter(Boolean));
  const statIds = [...new Set(keys.flatMap((k) => [cars[k].power, cars[k].powerFallback]).filter((x): x is string => !!x)), importRateId()];
  const [hist, stats] = await Promise.all([
    ha.historyWithAttributes(ids, startIso, endIso).catch(() => [] as HaEntity[][]),
    ha
      .statisticsDuringPeriod(statIds, startIso, endIso, "5minute")
      .catch(() => ({}) as Record<string, Stat[]>),
  ]);
  const byId: Record<string, HaEntity[]> = {};
  for (const s of hist) if (s?.[0]?.entity_id) byId[s[0].entity_id] = s;

  // Plan going into the cheap window: last Predbat update before 23:30 (or the first one after, if none).
  const planAt = w.offPeakStart.getTime();
  const cheap = dispatchIntervals(ha);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const c = cars[key];
    const slotHist = byId[c.slot];
    const slotRec = lastBefore(slotHist, planAt) || slotHist?.[0] || null;
    const slots = normalizeSlots(slotRec?.attributes?.planned, w.start).filter((s) => Date.parse(s.end) > w.start.getTime() && Date.parse(s.start) < w.nominalEnd.getTime());
    const plannedKwh = slots.length ? slots.reduce((a, s) => a + (s.kwh || 0), 0) : slotRec ? 0 : null;
    const plannedCost = slots.length ? slots.reduce((a, s) => a + (s.cost_p || 0), 0) : slotRec ? 0 : null;
    const socPlanRec = lastBefore(byId[c.socPlan], planAt) || byId[c.socPlan]?.[0] || null;
    const plannedMorningSoc = seriesAt(socPlanRec?.attributes?.results, w.morningAt);

    let measured = integrate(stats[c.power], stats[importRateId()], 5, w.start.getTime(), w.end.getTime(), { cheap });
    let source = c.power;
    if (c.powerFallback && measured.kwh < 0.05) {
      const fb = integrate(stats[c.powerFallback], stats[importRateId()], 5, w.start.getTime(), w.end.getTime(), { cheap });
      if (fb.kwh > measured.kwh) {
        measured = fb;
        source = c.powerFallback;
      }
    }
    const socSeries = byId[c.socEntity];
    const socStartRec = lastBefore(socSeries, w.start.getTime()) || socSeries?.[0];
    const socEndRec = lastBefore(socSeries, w.end.getTime());
    const socStart = asNum(socStartRec?.state);
    const socEnd = asNum(socEndRec?.state);
    const capRaw = num(ha.get(getVariables().vehicles.find((x) => x.id === key)?.capacity || ""));
    const capKwh = capRaw == null ? null : capRaw > 1000 ? capRaw / 3600 : capRaw;
    out[key] = {
      car: key,
      name: c.name,
      plan_recorded: Boolean(slotRec),
      planned_slots: slots,
      planned_kwh: plannedKwh == null ? null : Math.round(plannedKwh * 100) / 100,
      planned_cost_p: plannedCost == null ? null : Math.round(plannedCost * 100) / 100,
      planned_morning_soc: plannedMorningSoc,
      actual_kwh: measured.kwh,
      actual_cost_gbp: measured.cost_gbp,
      actual_cheap_share: measured.cheap_share,
      actual_first_on: measured.first_on,
      actual_last_on: measured.last_on,
      energy_source: source,
      soc_start: socStart,
      soc_end: socEnd,
      soc_gain_kwh: capKwh != null && socStart != null && socEnd != null ? Math.round(((socEnd - socStart) / 100) * capKwh * 10) / 10 : null,
    };
  }
  return {
    window: { date: w.date, start: startIso, end: endIso, complete: w.complete, plan_at: w.offPeakStart.toISOString() },
    tesla: (teslaLike()?.id ? out[teslaLike()!.id] : undefined) as CarNight | undefined,
    ev9: (kiaLike()?.id ? out[kiaLike()!.id] : undefined) as CarNight | undefined,
    vehicles: out as Record<string, CarNight>,
  };
}

export type CarNight = {
  car: CarKey;
  name: string;
  plan_recorded: boolean;
  planned_slots: PlannedSlot[];
  planned_kwh: number | null;
  planned_cost_p: number | null;
  planned_morning_soc: number | null;
  actual_kwh: number;
  actual_cost_gbp: number;
  actual_cheap_share: number | null;
  actual_first_on: string | null;
  actual_last_on: string | null;
  energy_source: string;
  soc_start: number | null;
  soc_end: number | null;
  soc_gain_kwh: number | null;
};

/** Intervals when the Tesla was at home (device_tracker state only; no coordinates are read). */
async function teslaHome(ha: HaClient, start: Date, end: Date): Promise<Interval[] | null> {
  try {
    const loc = getVariables().vehicles.find((x) => x.id === "tesla" || x.kind === "tesla_iog")?.location;
    if (!loc) return null;
    const raw = (await ha.history([loc], start.toISOString(), end.toISOString(), true)) as { state?: string; last_changed?: string }[][];
    const pts = (raw?.[0] || []).map((p) => ({ t: Date.parse(p.last_changed || ""), home: p.state === "home" })).filter((p) => Number.isFinite(p.t));
    if (!pts.length) return null;
    // Before the recorder's history starts we can't tell, so assume home (the >11.5 kW filter still drops DC sessions).
    const out: Interval[] = pts[0].t > start.getTime() + 3600000 ? [{ s: start.getTime(), e: pts[0].t }] : [];
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].home) continue;
      const s = Math.max(pts[i].t, start.getTime());
      const e = i + 1 < pts.length ? pts[i + 1].t : end.getTime();
      out.push({ s, e });
    }
    return out;
  } catch {
    return null;
  }
}

function dispatchIntervals(ha: HaClient): Interval[] {
  const d = iogDispatches(ha);
  return [...d.completed, ...d.planned]
    .map((x) => ({ s: Date.parse(x.start), e: Date.parse(x.end) }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e));
}

// ---------- monthly per-car cost ----------

let costCache: { at: number; data: unknown } | null = null;

export async function carCosts(ha: HaClient) {
  if (costCache && Date.now() - costCache.at < 10 * 60000) return costCache.data as Awaited<ReturnType<typeof buildCarCosts>>;
  const data = await buildCarCosts(ha);
  costCache = { at: Date.now(), data };
  return data;
}

async function buildCarCosts(ha: HaClient, now = new Date()) {
  const today = londonDate(now);
  const [y, m] = today.split("-").map(Number);
  const monthStartStr = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevStartStr = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const monthStart = londonInstant(monthStartStr);
  const prevStart = londonInstant(prevStartStr);
  const cars = carsNow();
  const HOME_LOAD = getVariables().site.pw_home_usage;
  const powerIds = Object.values(cars).map((c) => c.power).filter(Boolean);
  const odoIds = Object.values(cars).map((c) => c.odometer).filter((x): x is string => !!x);
  const stats = await ha.statisticsDuringPeriod(
    [...powerIds, importRateId(), HOME_LOAD],
    prevStart.toISOString(),
    now.toISOString(),
    "hour",
  );
  const odo = odoIds.length
    ? await ha.statisticsDuringPeriod(odoIds, prevStart.toISOString(), now.toISOString(), "day").catch(() => ({}) as Record<string, Stat[]>)
    : ({} as Record<string, Stat[]>);

  const home = await teslaHome(ha, prevStart, now);
  const cheap = dispatchIntervals(ha);
  // The Powerwall gateway meters every kWh the house uses, including a car on the home charger.
  // If the cars' charger power in an hour is more than the house used, the Tesla was charging somewhere else.
  const load = new Map<number, number>();
  for (const p of stats[HOME_LOAD] || []) if (p.change != null && Number.isFinite(p.change)) load.set(p.start, p.change);
  const teslaId = teslaLike()?.id || (cars.tesla ? "tesla" : "");
  const teslaPower = teslaId ? cars[teslaId]?.power : "";
  const otherPower = Object.entries(cars).filter(([id]) => id !== teslaId).map(([, c]) => c.power);
  const otherByHour = new Map<number, number>();
  for (const pid of otherPower) for (const p of stats[pid] || []) if (p.mean != null) otherByHour.set(p.start, (otherByHour.get(p.start) || 0) + p.mean);
  const teslaAway = new Set<number>();
  if (teslaPower) {
    for (const p of stats[teslaPower] || []) {
      const kwh = p.mean ?? 0;
      const l = load.get(p.start);
      if (kwh > 0.3 && l != null && kwh + (otherByHour.get(p.start) ?? 0) > l * 1.1 + 0.5) teslaAway.add(p.start);
    }
  }
  const period = (label: string, from: Date, to: Date) => {
    const perCar: Record<string, { kwh: number; cost_gbp: number; cheap_share: number | null; miles: number | null; p_per_mile: number | null; mi_per_kwh: number | null }> = {};
    let total = 0;
    for (const [id, c] of Object.entries(cars)) {
      const integ = integrate(stats[c.power], stats[importRateId()], 60, from.getTime(), to.getTime(), { home: id === teslaId ? home : undefined, cheap, exclude: id === teslaId ? teslaAway : undefined });
      const odoId = c.odometer;
      const miles = odoId
        ? (odo[odoId] || []).filter((p) => p.start >= from.getTime() && p.start < to.getTime()).reduce((a, p) => a + (p.change && p.change > 0 && p.change < 1500 ? p.change : 0), 0)
        : 0;
      const evMiles = miles > 0 ? Math.round(miles * 10) / 10 : null;
      perCar[id] = {
        kwh: integ.kwh,
        cost_gbp: integ.cost_gbp,
        cheap_share: integ.cheap_share,
        miles: evMiles,
        p_per_mile: evMiles && evMiles > 5 ? Math.round(((integ.cost_gbp * 100) / evMiles) * 10) / 10 : null,
        mi_per_kwh: evMiles && integ.kwh > 0.5 ? Math.round((evMiles / integ.kwh) * 10) / 10 : null,
      };
      total += integ.cost_gbp;
    }
    const t = (teslaLike()?.id && perCar[teslaLike()!.id]) || perCar.tesla || { kwh: 0, cost_gbp: 0, cheap_share: null, miles: null, p_per_mile: null, mi_per_kwh: null };
    const e = (kiaLike()?.id && perCar[kiaLike()!.id]) || perCar.ev9 || { kwh: 0, cost_gbp: 0, cheap_share: null, miles: null, p_per_mile: null, mi_per_kwh: null };
    return {
      label,
      start: from.toISOString(),
      end: to.toISOString(),
      tesla: t,
      ev9: e,
      cars: perCar,
      total_gbp: Math.round(total * 100) / 100,
    };
  };
  const monthName = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", month: "long", year: "numeric" }).format(d);
  return {
    generated: now.toISOString(),
    this_month: period(`${monthName(monthStart)} to date`, monthStart, now),
    data_status: Object.fromEntries(Object.keys(cars).map((id) => [id, carStatus(id, now)])),
    last_month: period(monthName(prevStart), prevStart, monthStart),
    method: [
      "Energy is the hourly mean of each car's measured charger power from Home Assistant long-term statistics (the linked charger, or the car's own charging-power entity), so 1 h at 7 kW = 7 kWh.",
      "Each hour is priced at that hour's mean import rate from the configured tariff rate sensor (which drops to the cheap rate during Intelligent Octopus dispatches); hours inside a known IOG dispatch are forced to the configured off-peak rate in case the sensor caught up late. Standing charge is not allocated to the cars.",
      "Home charging only: for a Tesla / IOG car, hours are counted only while its location entity is 'home' (where Home Assistant still has that history, typically about 10 days). Any hour where that car drew more than the whole house used (home-usage meter) is treated as away charging, and any hour peaking above the configured home_max_kw (default 11.5 kW, typical of DC rapid charging) is ignored. Charger power includes charging losses at the wall, which is what you pay for.",
      "If a car's data is lost (for example Tesla Fleet 'unknown' after a restart), its charger power has no readings for that time, so any charging then is missing from these totals until the data returns.",
      "Pence-per-mile is shown only for cars with an odometer entity configured over the same period.",
    ],
  };
}
