import { type Period, parsePeriod, addDaysStr, daysBetweenIncl } from "./period.js";
import type { HaClient, HaEntity, StatisticPoint } from "./ha.js";
import { num } from "./ha.js";
import { eventRates } from "./plan.js";
import { getVariables, isOffPeakMins } from "./variables.js";

function rateLabels() {
  const tr = getVariables().tariff;
  const p = (gbp: number) => `${Number.isInteger(gbp * 100) ? (gbp * 100).toFixed(0) : (gbp * 100).toFixed(1)}p`;
  return { peak: p(tr.peak_gbp), off: p(tr.offpeak_gbp), start: tr.off_peak_start, end: tr.off_peak_end };
}


const TZ = "Europe/London";

function fin() {
  const { site: s, tariff: t, predbat: p } = getVariables();
  const IMPORT_COST_ID = t.import_accumulative_cost;
  const IMPORT_KWH_ID = t.import_accumulative_consumption;
  const OFFICIAL_IMPORT_COST = t.official.import_cost;
  const OFFICIAL_IMPORT_COST_PEAK = t.official.import_cost_peak;
  const OFFICIAL_IMPORT_COST_OFF = t.official.import_cost_off_peak;
  const OFFICIAL_IMPORT_KWH = t.official.import_kwh;
  const OFFICIAL_IMPORT_KWH_PEAK = t.official.import_kwh_peak;
  const OFFICIAL_IMPORT_KWH_OFF = t.official.import_kwh_off_peak;
  const OFFICIAL_EXPORT_COST = t.official.export_cost;
  const OFFICIAL_EXPORT_KWH = t.official.export_kwh;
  const TOTAL_EXPORT_ID = t.import_total_export;
  const TOTAL_IMPORT_ID = t.import_total_consumption;
  const PW_IMPORT = s.pw_grid_imported;
  const PW_EXPORT = s.pw_grid_exported;
  const PW_SOLAR = s.pw_solar_generated;
  const PW_LOAD = s.pw_home_usage;
  const PW_SOLAR_EXPORTED = s.pw_solar_exported;
  const EXPORT_RATE_ID = t.export_current_rate;
  const STANDING_ID = t.standing_charge;
  const IMPORT_RATE_ID = t.import_rate;
  const DAILY_IDS = [
    IMPORT_COST_ID, IMPORT_KWH_ID,
    OFFICIAL_IMPORT_COST, OFFICIAL_IMPORT_COST_PEAK, OFFICIAL_IMPORT_COST_OFF,
    OFFICIAL_IMPORT_KWH, OFFICIAL_IMPORT_KWH_PEAK, OFFICIAL_IMPORT_KWH_OFF,
    OFFICIAL_EXPORT_COST, OFFICIAL_EXPORT_KWH,
    TOTAL_EXPORT_ID, TOTAL_IMPORT_ID,
    PW_IMPORT, PW_EXPORT, PW_SOLAR, PW_LOAD, PW_SOLAR_EXPORTED, STANDING_ID,
  ];
  const HOURLY_IDS = [TOTAL_EXPORT_ID, TOTAL_IMPORT_ID, PW_IMPORT, PW_EXPORT, PW_SOLAR, PW_LOAD, EXPORT_RATE_ID, IMPORT_RATE_ID];
  return {
    IMPORT_COST_ID, IMPORT_KWH_ID,
    OFFICIAL_IMPORT_COST, OFFICIAL_IMPORT_COST_PEAK, OFFICIAL_IMPORT_COST_OFF,
    OFFICIAL_IMPORT_KWH, OFFICIAL_IMPORT_KWH_PEAK, OFFICIAL_IMPORT_KWH_OFF,
    OFFICIAL_EXPORT_COST, OFFICIAL_EXPORT_KWH,
    TOTAL_EXPORT_ID, TOTAL_IMPORT_ID,
    PW_IMPORT, PW_EXPORT, PW_SOLAR, PW_LOAD, PW_SOLAR_EXPORTED,
    EXPORT_RATE_ID, STANDING_ID, IMPORT_RATE_ID,
    DAILY_IDS, HOURLY_IDS,
    IOG_PEAK_GBP: t.peak_gbp,
    IOG_OFFPEAK_GBP: t.offpeak_gbp,
    DEFAULT_STANDING: t.standing_gbp,
    savingsId: p.savings_yesterday_predbat,
    exportPrevDay: t.export_previous_day_rates,
    exportCurrentDay: t.export_current_day_rates,
  };
}

export type SourceKind = "metered" | "estimated" | "mixed";

export type DailyFinancial = {
  date: string;
  import_kwh: number | null;
  import_cost_gbp: number | null;
  export_kwh: number | null;
  export_earnings_gbp: number | null;
  net_cost_gbp: number | null;
  standing_gbp: number | null;
  peak_kwh: number | null;
  peak_cost_gbp: number | null;
  offpeak_kwh: number | null;
  offpeak_cost_gbp: number | null;
  solar_kwh: number | null;
  load_kwh: number | null;
  solar_exported_kwh: number | null;
  self_consumption_kwh: number | null;
  self_consumption_value_gbp: number | null;
  predbat_savings_gbp: number | null;
  import_source: SourceKind;
  export_source: SourceKind;
  peak_source: SourceKind | null;
};

export type Totals = {
  import_cost_gbp: number | null;
  export_earnings_gbp: number | null;
  net_cost_gbp: number | null;
  import_kwh: number | null;
  export_kwh: number | null;
  standing_gbp: number | null;
  avg_import_p_kwh: number | null;
  avg_export_p_kwh: number | null;
  peak_kwh: number | null;
  peak_cost_gbp: number | null;
  offpeak_kwh: number | null;
  offpeak_cost_gbp: number | null;
  solar_kwh: number | null;
  load_kwh: number | null;
  self_consumption_kwh: number | null;
  self_consumption_value_gbp: number | null;
  predbat_savings_gbp: number | null;
  days_with_import: number;
  days_with_export: number;
  import_source: SourceKind;
  export_source: SourceKind;
};

export type Coverage = {
  requested_start: string;
  requested_end: string;
  requested_days: number;
  data_from: string | null;
  data_to: string | null;
  days_with_data: number;
  export_days?: number;
  import_days?: number;
  partial: boolean;
  note: string | null;
};

export type FinancialsResponse = {
  days: number;
  period: { key: string; label: string; start: string; end: string; days: number; includes_today: boolean };
  coverage: Coverage;
  previous_coverage: Coverage;
  timezone: string;
  generated: string;
  window: { start: string; end: string; inclusive: string };
  previous_window: { start: string; end: string };
  current: Totals;
  previous: Totals;
  deltas: Record<string, number | null>;
  daily: DailyFinancial[];
  analysis: string[];
  sources: Record<string, string>;
  tariffs: {
    import_peak_p: number;
    import_offpeak_p: number;
    offpeak_hours: string;
    standing_gbp: number;
    export: string;
  };
  gaps: string[];
};

function londonDate(input: Date | number | string): string {
  const d = typeof input === "number" || typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function londonOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

function startOfLondonDay(dateStr: string): Date {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - londonOffsetMs(guess));
}

function addDays(dateStr: string, n: number): string {
  const start = startOfLondonDay(dateStr);
  return londonDate(new Date(start.getTime() + n * 24 * 3600 * 1000 + 12 * 3600 * 1000));
}

function listDates(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= endInclusive) {
    out.push(cur);
    cur = addDays(cur, 1);
    if (out.length > 1500) break;
  }
  return out;
}

function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  // Day 0 of next month
  const start = startOfLondonDay(`${y}-${String(m).padStart(2, "0")}-01`);
  const next = m === 12 ? startOfLondonDay(`${y + 1}-01-01`) : startOfLondonDay(`${y}-${String(m + 1).padStart(2, "0")}-01`);
  return Math.round((next.getTime() - start.getTime()) / 86400000);
}

function londonHourMinute(ms: number): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { hour: get("hour"), minute: get("minute") };
}

/** Fraction of [startMs, startMs+durationMs) that falls in IOG off-peak 23:30–05:30 London. */
function offPeakFraction(startMs: number, durationMs = 3600_000): number {
  const step = 5 * 60 * 1000;
  let off = 0;
  let n = 0;
  for (let t = startMs; t < startMs + durationMs; t += step) {
    const { hour, minute } = londonHourMinute(t);
    const mins = hour * 60 + minute;
    const tf = getVariables().tariff;
    if (isOffPeakMins(mins, tf.off_peak_start, tf.off_peak_end)) off += 1;
    n += 1;
  }
  return n ? off / n : 0;
}

function dailyState(pts: StatisticPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!pts) return m;
  for (const p of pts) {
    const v = p.state ?? p.change;
    if (v == null || !Number.isFinite(v)) continue;
    m.set(londonDate(p.start), v);
  }
  return m;
}

function dailyChange(pts: StatisticPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!pts) return m;
  for (const p of pts) {
    const v = p.change;
    if (v == null || !Number.isFinite(v)) continue;
    m.set(londonDate(p.start), v);
  }
  return m;
}

function dailyMean(pts: StatisticPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!pts) return m;
  for (const p of pts) {
    const v = p.mean ?? p.state;
    if (v == null || !Number.isFinite(v)) continue;
    m.set(londonDate(p.start), v);
  }
  return m;
}

function pick(map: Map<string, number>, date: string): number | null {
  const v = map.get(date);
  return v == null || !Number.isFinite(v) ? null : v;
}

function first(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function sum(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0);
}

function sourceMix(rows: DailyFinancial[], key: "import_source" | "export_source"): SourceKind {
  const kinds = new Set(rows.map((r) => r[key]));
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has("estimated") && kinds.has("metered")) return "mixed";
  if (kinds.has("mixed")) return "mixed";
  return "metered";
}

type RateSlot = { start: number; end: number; value: number };

function ratesFromEvents(entities: Array<HaEntity | null | undefined>): RateSlot[] {
  const slots: RateSlot[] = [];
  for (const ent of entities) {
    for (const r of eventRates(ent || undefined)) {
      const start = Date.parse(r.start);
      const end = Date.parse(r.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(r.value)) continue;
      slots.push({ start, end, value: r.value });
    }
  }
  return slots;
}

function rateAt(slots: RateSlot[], t: number): number | null {
  for (const s of slots) {
    if (t >= s.start && t < s.end) return s.value;
  }
  return null;
}

type HourlyBundle = {
  exportKwh: StatisticPoint[];
  importKwh: StatisticPoint[];
  pwExport: StatisticPoint[];
  pwImport: StatisticPoint[];
  pwSolar: StatisticPoint[];
  pwLoad: StatisticPoint[];
  exportRate: StatisticPoint[];
};

function estimateExportForDay(date: string, hourly: HourlyBundle, eventSlots: RateSlot[]): { kwh: number; gbp: number } | null {
  const start = startOfLondonDay(date).getTime();
  const end = startOfLondonDay(addDays(date, 1)).getTime();
  const energy = (hourly.exportKwh.length ? hourly.exportKwh : hourly.pwExport).filter(
    (p) => p.start >= start && p.start < end,
  );
  if (!energy.length) return null;
  const rateByStart = new Map<number, number>();
  for (const p of hourly.exportRate) {
    if (p.mean != null && Number.isFinite(p.mean)) rateByStart.set(p.start, p.mean);
  }
  let kwh = 0;
  let gbp = 0;
  let priced = 0;
  for (const p of energy) {
    const k = p.change ?? 0;
    if (!Number.isFinite(k) || k === 0) {
      if (Number.isFinite(k)) kwh += k;
      continue;
    }
    const mid = p.start + 30 * 60 * 1000;
    const rate = rateByStart.get(p.start) ?? rateAt(eventSlots, mid);
    kwh += k;
    if (rate != null) {
      gbp += k * rate;
      priced += k;
    }
  }
  if (priced <= 0 && kwh <= 0) return null;
  if (priced < kwh && priced > 0) {
    // apply average priced rate to any unpriced kWh
    const avg = gbp / priced;
    gbp += (kwh - priced) * avg;
  }
  return { kwh, gbp };
}


function estimateSelfConsumption(date: string, hourly: HourlyBundle): number | null {
  const start = startOfLondonDay(date).getTime();
  const end = startOfLondonDay(addDays(date, 1)).getTime();
  const solar = hourly.pwSolar.filter((p) => p.start >= start && p.start < end);
  const expSrc = hourly.exportKwh.length ? hourly.exportKwh : hourly.pwExport;
  if (!solar.length) return null;
  const expBy = new Map<number, number>();
  for (const p of expSrc) {
    if (p.start >= start && p.start < end) expBy.set(p.start, p.change ?? 0);
  }
  let self = 0;
  let any = false;
  for (const p of solar) {
    const s = p.change ?? 0;
    if (!Number.isFinite(s)) continue;
    any = true;
    const exported = expBy.get(p.start) ?? 0;
    self += Math.max(0, s - (Number.isFinite(exported) ? exported : 0));
  }
  return any ? self : null;
}

function estimatePeakSplit(
  date: string,
  hourly: HourlyBundle,
  peakGbp: number,
  offGbp: number,
): { peak_kwh: number; peak_cost_gbp: number; offpeak_kwh: number; offpeak_cost_gbp: number } | null {
  const start = startOfLondonDay(date).getTime();
  const end = startOfLondonDay(addDays(date, 1)).getTime();
  const energy = (hourly.importKwh.length ? hourly.importKwh : hourly.pwImport).filter(
    (p) => p.start >= start && p.start < end,
  );
  if (!energy.length) return null;
  let peak_kwh = 0;
  let offpeak_kwh = 0;
  let peak_cost_gbp = 0;
  let offpeak_cost_gbp = 0;
  for (const p of energy) {
    const k = p.change ?? 0;
    if (!Number.isFinite(k) || k === 0) continue;
    const frac = offPeakFraction(p.start, (p.end ?? p.start + 3600_000) - p.start);
    const off = k * frac;
    const peak = k - off;
    offpeak_kwh += off;
    peak_kwh += peak;
    offpeak_cost_gbp += off * offGbp;
    peak_cost_gbp += peak * peakGbp;
  }
  return { peak_kwh, peak_cost_gbp, offpeak_kwh, offpeak_cost_gbp };
}

function savingsByDay(hist: { last_changed?: string; state: string }[]): Map<string, number> {
  // savings_yesterday holds the previous day's Predbat savings all day.
  // Attribute the last reading on calendar day D to day D-1.
  const lastOn: Map<string, { t: string; v: number }> = new Map();
  for (const p of hist) {
    const ts = p.last_changed || "";
    if (!ts) continue;
    if (p.state === "unknown" || p.state === "unavailable" || p.state === "") continue;
    const v = Number(p.state);
    if (!Number.isFinite(v)) continue;
    const d = londonDate(ts);
    const prev = lastOn.get(d);
    if (!prev || ts >= prev.t) lastOn.set(d, { t: ts, v });
  }
  const out = new Map<string, number>();
  for (const [d, x] of lastOn) {
    out.set(addDays(d, -1), x.v / 100); // pence -> GBP
  }
  return out;
}

function flattenHistory(raw: unknown): Record<string, { last_changed?: string; state: string }[]> {
  const out: Record<string, { last_changed?: string; state: string }[]> = {};
  if (!Array.isArray(raw)) return out;
  for (const series of raw as { entity_id?: string; last_changed?: string; state?: string }[][]) {
    if (!Array.isArray(series) || !series.length) continue;
    const id = series[0]?.entity_id || "unknown";
    out[id] = series.map((p) => ({ last_changed: p.last_changed, state: String(p.state ?? "") }));
  }
  return out;
}

type SeriesCache = {
  at: number;
  from: string;
  hourlyFrom: string;
  daily: DailyFinancial[];
  standing: number;
  peakGbp: number;
  offGbp: number;
  gaps: string[];
};

let cache: SeriesCache | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function loadDailyFinancials(ha: HaClient, force = false, fromDate?: string, hourlyFromDate?: string): Promise<SeriesCache> {
  const wantFrom = (() => {
    const def = addDays(londonDate(new Date()), -70);
    return fromDate && fromDate < def ? fromDate : def;
  })();
  const wantHourly = (() => {
    const def = addDays(londonDate(new Date()), -70);
    return hourlyFromDate && hourlyFromDate < def ? hourlyFromDate : def;
  })();
  if (!force && cache && Date.now() - cache.at < CACHE_MS && cache.from <= wantFrom && cache.hourlyFrom <= wantHourly) return cache;

  const now = new Date();
  const today = londonDate(now);
  // Need 30D + previous 30D plus a little slack.
  const startDate = wantFrom;
  const startIso = startOfLondonDay(startDate).toISOString();
  const endIso = now.toISOString();
  const hourlyStartIso = startOfLondonDay(wantHourly < startDate ? startDate : wantHourly).toISOString();

  const {
    IMPORT_COST_ID, IMPORT_KWH_ID, OFFICIAL_IMPORT_COST, OFFICIAL_IMPORT_COST_PEAK, OFFICIAL_IMPORT_COST_OFF,
    OFFICIAL_IMPORT_KWH, OFFICIAL_IMPORT_KWH_PEAK, OFFICIAL_IMPORT_KWH_OFF, OFFICIAL_EXPORT_COST, OFFICIAL_EXPORT_KWH,
    TOTAL_EXPORT_ID, TOTAL_IMPORT_ID, PW_IMPORT, PW_EXPORT, PW_SOLAR, PW_LOAD, PW_SOLAR_EXPORTED,
    EXPORT_RATE_ID, STANDING_ID, IMPORT_RATE_ID, DAILY_IDS, HOURLY_IDS, IOG_PEAK_GBP, IOG_OFFPEAK_GBP, DEFAULT_STANDING,
    savingsId, exportPrevDay, exportCurrentDay,
  } = fin();
  const live = ha.getAll();
  const standing = num(live[STANDING_ID]) ?? DEFAULT_STANDING;
  const peakGbp = num(live[IMPORT_RATE_ID]) && (num(live[IMPORT_RATE_ID]) as number) > 0.2
    ? (num(live[IMPORT_RATE_ID]) as number)
    : IOG_PEAK_GBP;
  const offGbp = IOG_OFFPEAK_GBP;

  const [dailyStats, hourlyStats] = await Promise.all([
    ha.statisticsDuringPeriod(DAILY_IDS, startIso, endIso, "day"),
    ha.statisticsDuringPeriod(HOURLY_IDS, hourlyStartIso, endIso, "hour"),
  ]);

  const importCost = dailyState(dailyStats[IMPORT_COST_ID]);
  const importKwh = dailyState(dailyStats[IMPORT_KWH_ID]);
  const officialCost = dailyState(dailyStats[OFFICIAL_IMPORT_COST]);
  const officialPeakC = dailyState(dailyStats[OFFICIAL_IMPORT_COST_PEAK]);
  const officialOffC = dailyState(dailyStats[OFFICIAL_IMPORT_COST_OFF]);
  const officialKwh = dailyState(dailyStats[OFFICIAL_IMPORT_KWH]);
  const officialPeakK = dailyState(dailyStats[OFFICIAL_IMPORT_KWH_PEAK]);
  const officialOffK = dailyState(dailyStats[OFFICIAL_IMPORT_KWH_OFF]);
  const officialExpC = dailyState(dailyStats[OFFICIAL_EXPORT_COST]);
  const officialExpK = dailyState(dailyStats[OFFICIAL_EXPORT_KWH]);
  const totalExp = dailyChange(dailyStats[TOTAL_EXPORT_ID]);
  const totalImp = dailyChange(dailyStats[TOTAL_IMPORT_ID]);
  const pwImp = dailyState(dailyStats[PW_IMPORT]);
  const pwExp = dailyState(dailyStats[PW_EXPORT]);
  const pwSolar = dailyState(dailyStats[PW_SOLAR]);
  const pwLoad = dailyState(dailyStats[PW_LOAD]);
  const pwSolarExp = dailyChange(dailyStats[PW_SOLAR_EXPORTED]);
  const standingHist = dailyMean(dailyStats[STANDING_ID]);

  const hourly: HourlyBundle = {
    exportKwh: hourlyStats[TOTAL_EXPORT_ID] || [],
    importKwh: hourlyStats[TOTAL_IMPORT_ID] || [],
    pwExport: hourlyStats[PW_EXPORT] || [],
    pwImport: hourlyStats[PW_IMPORT] || [],
    pwSolar: hourlyStats[PW_SOLAR] || [],
    pwLoad: hourlyStats[PW_LOAD] || [],
    exportRate: hourlyStats[EXPORT_RATE_ID] || [],
  };

  // Previous/current day Agile rates for any hours missing LTS means.
  let eventSlots: RateSlot[] = [];
  try {
    const [prev, cur] = await Promise.all([
      ha.getRawState(exportPrevDay),
      ha.getRawState(exportCurrentDay),
    ]);
    eventSlots = ratesFromEvents([prev, cur]);
  } catch {
    eventSlots = ratesFromEvents([
      live[exportCurrentDay],
    ]);
  }

  let savingsMap = new Map<string, number>();
  try {
    const raw = await ha.history(
      [savingsId],
      startIso,
      endIso,
      true,
    );
    savingsMap = savingsByDay(flattenHistory(raw)[savingsId] || []);
  } catch (err) {
    console.error("financials: predbat savings history failed", err);
  }
  const liveYesterdaySavings = num(live[savingsId]);
  if (liveYesterdaySavings != null) savingsMap.set(addDays(today, -1), liveYesterdaySavings / 100);

  // Live overlays for today (LTS for today can lag the meter by a kWh or two).
  const liveImportCost = num(live[IMPORT_COST_ID]);
  const liveImportKwh = num(live[IMPORT_KWH_ID]);
  const livePwExport = num(live[PW_EXPORT]);
  const livePwImport = num(live[PW_IMPORT]);
  const livePwSolar = num(live[PW_SOLAR]);
  const livePwLoad = num(live[PW_LOAD]);
  const liveTotalExport = num(live[TOTAL_EXPORT_ID]);

  const dates = listDates(startDate, today);
  const daily: DailyFinancial[] = [];
  const gaps: string[] = [];

  for (const date of dates) {
    const isToday = date === today;
    const dayStanding = pick(standingHist, date) ?? standing;

    let import_cost_gbp = isToday && liveImportCost != null ? liveImportCost : pick(importCost, date);
    let import_kwh = isToday && liveImportKwh != null ? liveImportKwh : pick(importKwh, date);
    let import_source: SourceKind = import_cost_gbp != null ? "metered" : "estimated";

    if (import_cost_gbp == null) {
      const official = pick(officialCost, date);
      if (official != null) {
        import_cost_gbp = official + dayStanding;
        import_source = "metered";
      }
    }
    if (import_kwh == null) {
      import_kwh = first(pick(officialKwh, date), pick(totalImp, date), isToday ? livePwImport : pick(pwImp, date));
    }

    let export_earnings_gbp = pick(officialExpC, date);
    let export_kwh = pick(officialExpK, date);
    let export_source: SourceKind = export_earnings_gbp != null ? "metered" : "estimated";

    if (export_earnings_gbp == null || isToday) {
      const est = estimateExportForDay(date, hourly, eventSlots);
      if (export_earnings_gbp == null && est) {
        export_earnings_gbp = est.gbp;
        export_source = "estimated";
        if (export_kwh == null) export_kwh = est.kwh;
      } else if (isToday && est && export_earnings_gbp == null) {
        export_earnings_gbp = est.gbp;
        export_source = "estimated";
      }
    }
    if (isToday) {
      // Prefer live daily-reset Powerwall export, then meter change.
      const opening = (() => {
        const pts = hourly.exportKwh.filter((p) => londonDate(p.start) === today);
        if (!pts.length) return null;
        const firstPt = pts[0];
        const startState = firstPt.state != null && firstPt.change != null ? firstPt.state - firstPt.change : firstPt.state;
        return startState ?? null;
      })();
      const meterToday =
        liveTotalExport != null && opening != null ? Math.max(0, liveTotalExport - opening) : pick(totalExp, date);
      export_kwh = first(livePwExport, meterToday, export_kwh);
      export_source = "estimated";
      const est = estimateExportForDay(date, hourly, eventSlots);
      if (est) {
        // Re-scale if live kWh differs slightly from hourly sum (LTS lag).
        if (export_kwh != null && est.kwh > 0.01) {
          export_earnings_gbp = est.gbp * (export_kwh / est.kwh);
        } else {
          export_earnings_gbp = est.gbp;
        }
      }
    }
    if (export_kwh == null) {
      export_kwh = first(pick(totalExp, date), isToday ? livePwExport : pick(pwExp, date));
    }
    if (export_earnings_gbp == null && export_kwh != null && export_kwh > 0) {
      // Last resort: apply the average settled Agile rate from nearby official days.
      const settled = [...officialExpC.entries()].filter(([, v]) => v != null && v > 0);
      const rateSamples: number[] = [];
      for (const [d, c] of settled) {
        const k = officialExpK.get(d);
        if (k && k > 0.05) rateSamples.push(c / k);
      }
      if (rateSamples.length) {
        const avg = rateSamples.reduce((a, b) => a + b, 0) / rateSamples.length;
        export_earnings_gbp = export_kwh * avg;
        export_source = "estimated";
      }
    }

    let peak_kwh = pick(officialPeakK, date);
    let peak_cost_gbp = pick(officialPeakC, date);
    let offpeak_kwh = pick(officialOffK, date);
    let offpeak_cost_gbp = pick(officialOffC, date);
    let peak_source: SourceKind | null =
      peak_kwh != null || offpeak_kwh != null ? "metered" : null;

    if (peak_source == null || isToday) {
      const split = estimatePeakSplit(date, hourly, peakGbp, offGbp);
      if (split && (peak_source == null || isToday)) {
        peak_kwh = split.peak_kwh;
        peak_cost_gbp = split.peak_cost_gbp;
        offpeak_kwh = split.offpeak_kwh;
        offpeak_cost_gbp = split.offpeak_cost_gbp;
        peak_source = "estimated";
      }
    }

    const solar_kwh = isToday && livePwSolar != null ? livePwSolar : pick(pwSolar, date);
    const load_kwh = isToday && livePwLoad != null ? livePwLoad : pick(pwLoad, date);
    const solar_exported_kwh = pick(pwSolarExp, date);
    const hourlySelf = estimateSelfConsumption(date, hourly);
    // Prefer hour-aligned solar minus grid export (night-time battery export
    // does not cancel daytime self-use). Fall back to daily solar exported.
    const self_consumption_kwh =
      hourlySelf != null
        ? hourlySelf
        : solar_exported_kwh != null && solar_kwh != null && solar_exported_kwh <= (solar_kwh + 0.5)
          ? Math.max(0, solar_kwh - solar_exported_kwh)
          : solar_kwh != null && export_kwh != null && export_kwh < solar_kwh
            ? solar_kwh - export_kwh
            : null;
    const self_consumption_value_gbp =
      self_consumption_kwh != null ? self_consumption_kwh * peakGbp : null;

    const net_cost_gbp =
      import_cost_gbp != null || export_earnings_gbp != null
        ? (import_cost_gbp || 0) - (export_earnings_gbp || 0)
        : null;

    if (import_cost_gbp == null && export_earnings_gbp == null && import_kwh == null) {
      // Skip completely empty leading days
      continue;
    }
    if (import_cost_gbp == null) gaps.push(`No metered import cost for ${date}`);
    if (export_earnings_gbp == null) gaps.push(`No export earnings for ${date}`);

    daily.push({
      date,
      import_kwh,
      import_cost_gbp,
      export_kwh,
      export_earnings_gbp,
      net_cost_gbp,
      standing_gbp: dayStanding,
      peak_kwh,
      peak_cost_gbp,
      offpeak_kwh,
      offpeak_cost_gbp,
      solar_kwh,
      load_kwh,
      solar_exported_kwh,
      self_consumption_kwh,
      self_consumption_value_gbp,
      predbat_savings_gbp: savingsMap.get(date) ?? null,
      import_source,
      export_source,
      peak_source,
    });
  }

  cache = { at: Date.now(), from: startDate, hourlyFrom: wantHourly, daily, standing, peakGbp, offGbp, gaps };
  return cache;
}

function totalsFor(rows: DailyFinancial[]): Totals {
  const import_cost_gbp = sum(rows.map((r) => r.import_cost_gbp));
  const export_earnings_gbp = sum(rows.map((r) => r.export_earnings_gbp));
  const import_kwh = sum(rows.map((r) => r.import_kwh));
  const export_kwh = sum(rows.map((r) => r.export_kwh));
  const standing_gbp = sum(rows.map((r) => r.standing_gbp));
  const unitImport = import_cost_gbp != null && standing_gbp != null ? import_cost_gbp - standing_gbp : import_cost_gbp;
  return {
    import_cost_gbp,
    export_earnings_gbp,
    net_cost_gbp:
      import_cost_gbp != null || export_earnings_gbp != null
        ? (import_cost_gbp || 0) - (export_earnings_gbp || 0)
        : null,
    import_kwh,
    export_kwh,
    standing_gbp,
    avg_import_p_kwh: unitImport != null && import_kwh && import_kwh > 0 ? (unitImport / import_kwh) * 100 : null,
    avg_export_p_kwh: export_earnings_gbp != null && export_kwh && export_kwh > 0 ? (export_earnings_gbp / export_kwh) * 100 : null,
    peak_kwh: sum(rows.map((r) => r.peak_kwh)),
    peak_cost_gbp: sum(rows.map((r) => r.peak_cost_gbp)),
    offpeak_kwh: sum(rows.map((r) => r.offpeak_kwh)),
    offpeak_cost_gbp: sum(rows.map((r) => r.offpeak_cost_gbp)),
    solar_kwh: sum(rows.map((r) => r.solar_kwh)),
    load_kwh: sum(rows.map((r) => r.load_kwh)),
    self_consumption_kwh: sum(rows.map((r) => r.self_consumption_kwh)),
    self_consumption_value_gbp: sum(rows.map((r) => r.self_consumption_value_gbp)),
    predbat_savings_gbp: sum(rows.map((r) => r.predbat_savings_gbp)),
    days_with_import: rows.filter((r) => r.import_cost_gbp != null).length,
    days_with_export: rows.filter((r) => r.export_earnings_gbp != null).length,
    import_source: rows.length ? sourceMix(rows, "import_source") : "metered",
    export_source: rows.length ? sourceMix(rows, "export_source") : "metered",
  };
}

function deltaPct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || Math.abs(prev) < 1e-9) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function gbp(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}£${Math.abs(n).toFixed(digits)}`;
}

function kwh(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} kWh`;
}

function buildAnalysis(
  windowDays: number,
  rows: DailyFinancial[],
  mtdRows: DailyFinancial[],
  cur: Totals,
  prev: Totals,
  today: string,
  standing: number,
  peakGbp: number,
): string[] {
  const lines: string[] = [];
  if (!rows.length) return ["No cost history is available for this window yet."];

  const complete = rows.filter((r) => r.date < today && r.net_cost_gbp != null);
  const hasToday = rows.some((r) => r.date === today);
  if (hasToday) {
    lines.push(
      windowDays === 1
        ? `Today so far the house has cost a net ${gbp(cur.net_cost_gbp)} (import ${gbp(cur.import_cost_gbp)} less export ${gbp(cur.export_earnings_gbp)}).`
        : `This ${windowDays}-day window includes today so far, and nets ${gbp(cur.net_cost_gbp)} after export earnings.`,
    );
  } else if (cur.net_cost_gbp != null) {
    lines.push(`Net cost over ${windowDays} days is ${gbp(cur.net_cost_gbp)}.`);
  }

  if (cur.peak_kwh != null && cur.import_kwh && cur.import_kwh > 0) {
    const kShare = (cur.peak_kwh / cur.import_kwh) * 100;
    const unit = (cur.import_cost_gbp || 0) - (cur.standing_gbp || 0);
    const cShare = cur.peak_cost_gbp != null && unit > 0 ? (cur.peak_cost_gbp / unit) * 100 : null;
    lines.push(
      cShare != null
        ? `Peak-rate import (${rateLabels().peak}, ${rateLabels().end}–${rateLabels().start}) was ${kShare.toFixed(0)}% of kWh but ${cShare.toFixed(0)}% of unit cost — most of the energy arrived in the cheap ${rateLabels().off} window.`
        : `Peak-rate import was ${kShare.toFixed(0)}% of imported kWh.`,
    );
  }

  const withNet = complete.filter((r) => r.net_cost_gbp != null);
  if (withNet.length) {
    const best = withNet.reduce((a, b) => ((a.net_cost_gbp ?? 0) <= (b.net_cost_gbp ?? 0) ? a : b));
    const worst = withNet.reduce((a, b) => ((a.net_cost_gbp ?? 0) >= (b.net_cost_gbp ?? 0) ? a : b));
    const fmtDay = (d: string) => {
      const dt = startOfLondonDay(d);
      return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(dt);
    };
    if (best.date !== worst.date) {
      lines.push(
        `Best completed day was ${fmtDay(best.date)} (net ${gbp(best.net_cost_gbp)}, export ${gbp(best.export_earnings_gbp)}). Worst was ${fmtDay(worst.date)} (net ${gbp(worst.net_cost_gbp)}, import ${kwh(worst.import_kwh)}).`,
      );
    }
  }

  if (cur.export_earnings_gbp != null && cur.import_cost_gbp && cur.import_cost_gbp > 0) {
    const cover = (cur.export_earnings_gbp / cur.import_cost_gbp) * 100;
    lines.push(`Export earnings covered ${cover.toFixed(0)}% of import cost in this window.`);
  }

  if (cur.standing_gbp != null && cur.standing_gbp > 0) {
    lines.push(
      `Standing charges added ${gbp(cur.standing_gbp)} (${gbp(standing, 3)}/day, already included in the Octopus import totals).`,
    );
  }

  if (cur.self_consumption_kwh != null && cur.self_consumption_kwh > 0) {
    lines.push(
      `Solar self-consumption was ${kwh(cur.self_consumption_kwh)}, worth about ${gbp(cur.self_consumption_value_gbp)} at the daytime ${rateLabels().peak} import rate (estimated avoided import).`,
    );
  }

  if (cur.predbat_savings_gbp != null && cur.predbat_savings_gbp !== 0) {
    lines.push(
      `Predbat’s own “vs no optimisation” saving over the days it reported was ${gbp(cur.predbat_savings_gbp)}. This is Predbat’s figure, not a meter reading.`,
    );
  }

  if (prev.net_cost_gbp != null && cur.net_cost_gbp != null && prev.days_with_import > 0) {
    const d = cur.net_cost_gbp - prev.net_cost_gbp;
    if (prev.net_cost_gbp <= 0 && cur.net_cost_gbp > 0) {
      lines.push(
        `The previous ${windowDays}-day period was a net ${gbp(Math.abs(prev.net_cost_gbp))} credit; this window is a net cost of ${gbp(cur.net_cost_gbp)}.`,
      );
    } else {
      const pct = deltaPct(cur.net_cost_gbp, prev.net_cost_gbp);
      const word = d < 0 ? "lower" : "higher";
      const pctBit = pct != null && Math.abs(prev.net_cost_gbp) >= 1 ? ` (${Math.abs(pct).toFixed(0)}%)` : "";
      lines.push(
        `Net cost is ${gbp(Math.abs(d))} ${word} than the previous ${windowDays}-day period${pctBit}.`,
      );
    }
  }

  const mtdNet = sum(mtdRows.map((r) => r.net_cost_gbp));
  const dim = daysInMonth(today);
  const dayNum = Number(today.slice(8));
  const fracToday = Math.min(1, Math.max(0.02, (Date.now() - startOfLondonDay(today).getTime()) / 86400000));
  const elapsed = dayNum - 1 + fracToday;
  if (mtdNet != null && elapsed > 0.2) {
    const projected = (mtdNet / elapsed) * dim;
    lines.push(
      `This month so far nets ${gbp(mtdNet)}. At that daily average, November would come in around ${gbp(projected)}.`,
    );
  } else if (cur.net_cost_gbp != null && rows.length) {
    const avg = cur.net_cost_gbp / Math.max(rows.length, 1);
    lines.push(`At this window’s daily average, a 30-day month would net about ${gbp(avg * 30)}.`);
  }

  const estimatedDays = rows.filter((r) => r.export_source === "estimated");
  if (estimatedDays.length) {
    const labels =
      estimatedDays.length > 6
        ? `${estimatedDays.length} days (${estimatedDays[0].date} to ${estimatedDays[estimatedDays.length - 1].date}, not all consecutive)`
        : estimatedDays.map((r) => r.date).join(", ");
    lines.push(
      `Export earnings on ${labels} are estimated from Agile Outgoing hourly rates × meter export; earlier days use Octopus settled figures.`,
    );
  }

  void peakGbp;
  return lines;
}

export function coverageFor(rows: DailyFinancial[], start: string, end: string): Coverage {
  const withData = rows.filter((r) => r.import_cost_gbp != null || r.export_earnings_gbp != null);
  const requested_days = daysBetweenIncl(start, end);
  const data_from = withData[0]?.date ?? null;
  const data_to = withData[withData.length - 1]?.date ?? null;
  const partial = withData.length < requested_days;
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(startOfLondonDay(d));
  let note: string | null = null;
  if (!withData.length) note = "No cost data in this period.";
  else if (partial) {
    const missing = requested_days - withData.length;
    note =
      data_from && data_from > start
        ? `Data from ${fmt(data_from)} — ${withData.length} of ${requested_days} days have cost data.`
        : `${withData.length} of ${requested_days} days have cost data (${missing} missing).`;
  }
  const expRows = rows.filter((r) => r.export_earnings_gbp != null);
  const impRows = rows.filter((r) => r.import_cost_gbp != null);
  if (withData.length && expRows.length < withData.length) {
    const ex = expRows.length
      ? `Export earnings only from ${fmt(expRows[0].date)} (${expRows.length} days); import cost on ${impRows.length} days.`
      : `No export earnings recorded in this period; import cost on ${impRows.length} days.`;
    note = note ? `${note} ${ex}` : ex;
  }
  return {
    requested_start: start, requested_end: end, requested_days, data_from, data_to, days_with_data: withData.length,
    export_days: expRows.length, import_days: impRows.length,
    partial: partial || expRows.length < withData.length, note,
  };
}

export function summarizeFinancials(
  series: SeriesCache,
  periodOrDays: Period | number,
  now = new Date(),
): FinancialsResponse {
  const period: Period = typeof periodOrDays === "number" ? parsePeriod({ days: periodOrDays }, now) : periodOrDays;
  const windowDays = period.days;
  const today = period.end;
  const realToday = londonDate(now);
  const start = period.start;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(windowDays - 1));

  const currentRows = series.daily.filter((r) => r.date >= start && r.date <= today);
  // For month projection, always use calendar month-to-date, not the selected window.
  const monthStart = today.slice(0, 8) + "01";
  const analysisRows = period.includes_today ? series.daily.filter((r) => r.date >= monthStart && r.date <= today) : [];
  const previousRows = series.daily.filter((r) => r.date >= prevStart && r.date <= prevEnd);

  const current = totalsFor(currentRows);
  const previous = totalsFor(previousRows);
  const deltas: Record<string, number | null> = {
    import_cost_gbp: deltaPct(current.import_cost_gbp, previous.import_cost_gbp),
    export_earnings_gbp: deltaPct(current.export_earnings_gbp, previous.export_earnings_gbp),
    net_cost_gbp: deltaPct(current.net_cost_gbp, previous.net_cost_gbp),
    import_kwh: deltaPct(current.import_kwh, previous.import_kwh),
    export_kwh: deltaPct(current.export_kwh, previous.export_kwh),
    avg_import_p_kwh: deltaPct(current.avg_import_p_kwh, previous.avg_import_p_kwh),
    avg_export_p_kwh: deltaPct(current.avg_export_p_kwh, previous.avg_export_p_kwh),
  };

  // A previous period with little data makes % changes meaningless (e.g. 12M vs a year before records began).
  if (windowDays > 1 && previous.days_with_import < Math.ceil(windowDays * 0.8)) {
    for (const k of Object.keys(deltas)) deltas[k] = null;
  }
  const windowGaps = series.gaps.filter((g) => {
    const d = g.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return d ? d >= start && d <= today : true;
  });

  // If previous window is short of days, note it.
  const gaps = [...windowGaps];
  const coverage = coverageFor(currentRows, start, today);
  const previous_coverage = coverageFor(previousRows, prevStart, prevEnd);
  if (previous.days_with_import < windowDays && windowDays > 1) {
    gaps.push(
      `Previous ${windowDays}-day comparison has ${previous.days_with_import} day(s) of import cost (of ${windowDays}).`,
    );
  }

  const sources: Record<string, string> = {
    import_cost:
      "Metered: Octopus current accumulative cost (daily long-term statistics), including the standing charge. Today uses the live sensor.",
    import_kwh: "Metered: Octopus current accumulative consumption (daily LTS / live sensor).",
    export_earnings:
      "Metered on settled days: Octopus export previous accumulative cost (integration statistics). Unsettled recent days, including today: estimated as meter export kWh × Agile Outgoing hourly rate.",
    export_kwh:
      "Metered on settled days: Octopus export previous accumulative consumption. Today: Powerwall daily grid export, cross-checked against the lifetime export meter.",
    peak_split:
      "Metered on settled days: Octopus previous accumulative peak / off-peak cost and consumption. Today and any missing days: estimated from hourly import × the configured peak / off-peak rates (off-peak window from Settings → Variables).",
    standing: `Octopus current standing charge sensor (${gbp(series.standing, 3)}/day), already included in import cost.`,
    self_consumption:
      "Daily solar generated minus solar exported (or minus grid export if that sensor is missing). Value is estimated at the configured daytime / peak import rate.",
    predbat_savings: "Predbat savings_yesterday_predbat history (pence), converted to pounds. This is Predbat’s estimate, not a meter.",
    solar_load: "Daily solar generated and home usage from the configured Powerwall energy sensors.",
  };

  return {
    days: windowDays,
    period: { key: period.key, label: period.label, start, end: today, days: windowDays, includes_today: period.includes_today },
    coverage,
    previous_coverage,
    timezone: TZ,
    generated: now.toISOString(),
    window: { start, end: today, inclusive: `${start} to ${today} (Europe/London${today === realToday ? ", today so far" : ""})` },
    previous_window: { start: prevStart, end: prevEnd },
    current,
    previous,
    deltas,
    daily: currentRows,
    analysis: buildAnalysis(
      windowDays,
      currentRows,
      analysisRows,
      current,
      previous,
      realToday,
      series.standing,
      series.peakGbp,
    ),
    sources,
    tariffs: {
      import_peak_p: series.peakGbp * 100,
      import_offpeak_p: series.offGbp * 100,
      offpeak_hours: "23:30–05:30 Europe/London",
      standing_gbp: series.standing,
      export: "Agile Outgoing (half-hourly / hourly history)",
    },
    gaps,
  };
}

export async function buildFinancials(ha: HaClient, periodOrDays: Period | number): Promise<FinancialsResponse> {
  const period: Period = typeof periodOrDays === "number" ? parsePeriod({ days: periodOrDays }) : periodOrDays;
  const prevStart = addDaysStr(period.start, -period.days);
  const series = await loadDailyFinancials(ha, false, prevStart, period.start);
  return summarizeFinancials(series, period);
}
