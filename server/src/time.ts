import { getVariables, isOffPeakMins } from "./variables.js";

/** Europe/London time helpers (server runs with TZ unset in some containers, so never rely on local time). */
export const TZ = "Europe/London";

export function londonDate(input: Date | number | string = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function londonParts(input: Date | number = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function londonMinutes(input: Date | number = new Date()): number {
  const p = londonParts(input);
  return p.hour * 60 + p.minute;
}

function offsetMs(instant: Date): number {
  const p = londonParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant for a London wall-clock time. */
export function londonInstant(dateStr: string, hour = 0, minute = 0): Date {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const first = new Date(guess.getTime() - offsetMs(guess));
  // Re-check across DST edges
  return new Date(guess.getTime() - offsetMs(first));
}

export function addDays(dateStr: string, n: number): string {
  const mid = londonInstant(dateStr, 12, 0);
  return londonDate(new Date(mid.getTime() + n * 86400000));
}

/** Next occurrence (strictly after `from`) of HH:MM London. */
export function nextLondon(hour: number, minute: number, from = new Date()): Date {
  const today = londonDate(from);
  let t = londonInstant(today, hour, minute);
  if (t.getTime() <= from.getTime()) t = londonInstant(addDays(today, 1), hour, minute);
  return t;
}

/** Predbat car slot times look like "11-24 05:30:00" (London wall clock, no year). */
export function parsePredbatLocal(s: unknown, ref = new Date()): Date | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  const refP = londonParts(ref);
  let year = refP.year;
  const month = Number(m[1]);
  if (refP.month === 12 && month === 1) year += 1;
  if (refP.month === 1 && month === 12) year -= 1;
  const dateStr = `${year}-${m[1]}-${m[2]}`;
  return londonInstant(dateStr, Number(m[3]), Number(m[4]));
}

/** Off-peak window from Variables (default 23:30–05:30 London). */
export function isOffPeakMinute(mins: number) {
  const t = getVariables().tariff;
  return isOffPeakMins(mins, t.off_peak_start, t.off_peak_end);
}


export function fmtHM(d: Date | number | string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
