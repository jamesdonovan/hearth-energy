/** Financials period selection: presets (1D…12M) or a custom inclusive date range, Europe/London days. */
const TZ = "Europe/London";
export type PeriodKey = "1d" | "4d" | "14d" | "30d" | "6m" | "12m" | "custom";
export type Period = { key: PeriodKey; label: string; start: string; end: string; days: number; today: string; includes_today: boolean };

const PRESET_DAYS: Record<Exclude<PeriodKey, "custom">, number> = { "1d": 1, "4d": 4, "14d": 14, "30d": 30, "6m": 183, "12m": 365 };
const LABEL: Record<PeriodKey, string> = { "1d": "1D", "4d": "4D", "14d": "14D", "30d": "30D", "6m": "6M", "12m": "12M", custom: "Custom" };
export const MAX_CUSTOM_DAYS = 731;

export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDaysStr(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export function daysBetweenIncl(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;
}
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Accepts ?period=6m, ?period=custom&start=&end=, or the legacy ?days=14. Throws on a bad custom range. */
export function parsePeriod(q: Record<string, unknown>, now = new Date()): Period {
  const today = londonToday(now);
  let key = String(q.period ?? "").toLowerCase() as PeriodKey;
  if (!key && q.days != null) {
    const d = Number(q.days);
    key = (({ 1: "1d", 4: "4d", 14: "14d", 30: "30d" }) as Record<number, PeriodKey>)[d] ?? "14d";
  }
  if (key === "custom") {
    const s = q.start, e = q.end;
    if (!isDate(s) || !isDate(e)) throw new Error("custom range needs start and end as YYYY-MM-DD");
    const end = e > today ? today : e;
    if (s > end) throw new Error("start must be on or before end");
    const days = daysBetweenIncl(s, end);
    if (days > MAX_CUSTOM_DAYS) throw new Error(`custom range is limited to ${MAX_CUSTOM_DAYS} days`);
    return { key, label: `${s} – ${end}`, start: s, end, days, today, includes_today: end === today };
  }
  if (!(key in PRESET_DAYS)) key = "14d";
  const days = PRESET_DAYS[key as Exclude<PeriodKey, "custom">];
  return { key, label: LABEL[key], start: addDaysStr(today, -(days - 1)), end: today, days, today, includes_today: true };
}
export const periodCacheKey = (p: Period) => `${p.key}:${p.start}:${p.end}`;
