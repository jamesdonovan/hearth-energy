/** Financials / reconciliation period selection: presets or a custom inclusive date range, Europe/London days. */
const TZ = "Europe/London";
export type PeriodKey =
  | "1d"
  | "4d"
  | "7d"
  | "14d"
  | "30d"
  | "6m"
  | "12m"
  | "this_month"
  | "last_month"
  | "custom";
export type Period = { key: PeriodKey; label: string; start: string; end: string; days: number; today: string; includes_today: boolean };

const PRESET_DAYS: Record<string, number> = { "1d": 1, "4d": 4, "7d": 7, "14d": 14, "30d": 30, "6m": 183, "12m": 365 };
const LABEL: Record<PeriodKey, string> = {
  "1d": "1D",
  "4d": "4D",
  "7d": "7D",
  "14d": "14D",
  "30d": "30D",
  "6m": "6M",
  "12m": "12M",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};
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
export function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}
export function prevMonthStart(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}
export function lastDayOfMonth(monthStartStr: string): string {
  const [y, m] = monthStartStr.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDaysStr(next, -1);
}
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function calendarPeriod(key: "this_month" | "last_month", today: string): Period {
  if (key === "this_month") {
    const start = monthStart(today);
    return { key, label: LABEL[key], start, end: today, days: daysBetweenIncl(start, today), today, includes_today: true };
  }
  const start = prevMonthStart(today);
  const end = lastDayOfMonth(start);
  return { key, label: LABEL[key], start, end, days: daysBetweenIncl(start, end), today, includes_today: end === today };
}

function isKnownKey(key: string): key is PeriodKey {
  return key === "custom" || key === "this_month" || key === "last_month" || key in PRESET_DAYS;
}

/** Accepts ?period=6m, ?period=last_month, ?period=custom&start=&end=, or the legacy ?days=14. Throws on a bad custom range. */
export function parsePeriod(q: Record<string, unknown>, now = new Date(), fallback: PeriodKey = "14d"): Period {
  const today = londonToday(now);
  let key = String(q.period ?? "").toLowerCase();
  if (!key && q.days != null) {
    const d = Number(q.days);
    key = ({ 1: "1d", 4: "4d", 7: "7d", 14: "14d", 30: "30d" } as Record<number, string>)[d] ?? fallback;
  }
  if (key === "custom") {
    const s = q.start, e = q.end;
    if (!isDate(s) || !isDate(e)) throw new Error("custom range needs start and end as YYYY-MM-DD");
    const end = e > today ? today : e;
    if (s > end) throw new Error("start must be on or before end");
    const days = daysBetweenIncl(s, end);
    if (days > MAX_CUSTOM_DAYS) throw new Error(`custom range is limited to ${MAX_CUSTOM_DAYS} days`);
    return { key: "custom", label: `${s} – ${end}`, start: s, end, days, today, includes_today: end === today };
  }
  if (!isKnownKey(key) || key === "custom") key = isKnownKey(fallback) && fallback !== "custom" ? fallback : "14d";
  if (key === "this_month" || key === "last_month") return calendarPeriod(key, today);
  const n = PRESET_DAYS[key] ?? 14;
  const resolved = (key in PRESET_DAYS ? key : "14d") as PeriodKey;
  return { key: resolved, label: LABEL[resolved], start: addDaysStr(today, -(n - 1)), end: today, days: n, today, includes_today: true };
}
export const periodCacheKey = (p: Period) => `${p.key}:${p.start}:${p.end}`;
