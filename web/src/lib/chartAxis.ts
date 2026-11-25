/**
 * Shared x-axis helpers so every chart gets a readable timeline at any width:
 * a tick budget from the chart's real width, ticks on round London-time boundaries,
 * short labels ("14:00", "Tue", "12 Nov", "Nov"), and full-detail tooltip labels.
 */
import { useCallback, useEffect, useState } from "react";

const TZ = "Europe/London";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Width of the element the callback ref is attached to (ResizeObserver). */
export function useWidth<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(() => (typeof window !== "undefined" ? Math.min(window.innerWidth, 1200) : 800));
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w];
}

/** How many x labels fit: ~1 per 56px, 4 minimum on a phone, 10 max on a big screen. */
export function tickBudget(width: number, labelPx = 56): number {
  return Math.max(3, Math.min(10, Math.floor(width / labelPx)));
}

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function londonParts(ms: number) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
/** UTC ms for a London wall-clock time. */
function londonMs(y: number, mo: number, d: number, h = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  const p = londonParts(guess);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return guess - (asUtc - guess);
}

const STEPS: { ms: number; kind: "h" | "d" | "m"; n: number }[] = [
  { ms: HOUR, kind: "h", n: 1 },
  { ms: 2 * HOUR, kind: "h", n: 2 },
  { ms: 3 * HOUR, kind: "h", n: 3 },
  { ms: 6 * HOUR, kind: "h", n: 6 },
  { ms: 12 * HOUR, kind: "h", n: 12 },
  { ms: DAY, kind: "d", n: 1 },
  { ms: 2 * DAY, kind: "d", n: 2 },
  { ms: 7 * DAY, kind: "d", n: 7 },
  { ms: 14 * DAY, kind: "d", n: 14 },
  { ms: 30 * DAY, kind: "m", n: 1 },
  { ms: 91 * DAY, kind: "m", n: 3 },
  { ms: 182 * DAY, kind: "m", n: 6 },
];

export type TimeTicks = { ticks: number[]; stepMs: number; spanMs: number };

/** Round London-time ticks between min and max, at most `max` of them. */
export function timeTicks(min: number, max: number, max_ = 6): TimeTicks {
  const span = Math.max(1, max - min);
  const step = STEPS.find((s) => span / s.ms <= max_) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  const a = londonParts(min);
  if (step.kind === "h") {
    for (let t = londonMs(a.y, a.mo, a.d, 0); t <= max + 1 && out.length < 200; t += HOUR) {
      if (t < min) continue;
      const p = londonParts(t);
      if (p.mi === 0 && p.h % step.n === 0) out.push(t);
    }
  } else if (step.kind === "d") {
    for (let i = 0; i < 800; i++) {
      const dt = new Date(Date.UTC(a.y, a.mo - 1, a.d + i));
      const t = londonMs(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (t > max + 1) break;
      if (t < min) continue;
      const dayNo = Math.round(dt.getTime() / DAY);
      // weekly ticks land on Mondays; 2-day/14-day on an even day count
      const ok = step.n === 7 ? dt.getUTCDay() === 1 : step.n === 14 ? dt.getUTCDay() === 1 && Math.floor(dayNo / 7) % 2 === 0 : dayNo % step.n === 0;
      if (ok) out.push(t);
    }
  } else {
    for (let i = 0; i < 40; i++) {
      const dt = new Date(Date.UTC(a.y, a.mo - 1 + i, 1));
      const t = londonMs(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
      if (t > max + 1) break;
      if (t >= min && dt.getUTCMonth() % step.n === 0) out.push(t);
    }
  }
  return { ticks: out, stepMs: step.ms, spanMs: span };
}

const fHM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fWd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
const fDM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const fMon = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "short" });
const fFull = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Short tick label for a time axis with the given tick step. */
export function fmtTimeTick(ms: number, stepMs: number, spanMs: number): string {
  if (stepMs < DAY) {
    const p = londonParts(ms);
    return p.h === 0 && p.mi === 0 ? fWd.format(ms) : fHM.format(ms);
  }
  if (stepMs < 28 * DAY) return spanMs <= 8 * DAY ? fWd.format(ms) : fDM.format(ms);
  const p = londonParts(ms);
  return p.mo === 1 ? `Jan ${String(p.y).slice(2)}` : fMon.format(ms);
}

/** Full tooltip label: "Mon 23 Nov, 14:05". */
export const fmtTimeFull = (v: unknown) => {
  const ms = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(ms) ? fFull.format(ms) : String(v ?? "");
};

/** Everything a numeric time XAxis needs. Spread onto <XAxis>. */
export function timeAxisProps(min: number, max: number, width: number) {
  const tt = timeTicks(min, max, tickBudget(width));
  return {
    type: "number" as const,
    scale: "time" as const,
    domain: [min, max] as [number, number],
    ticks: tt.ticks,
    tickFormatter: (v: number) => fmtTimeTick(v, tt.stepMs, tt.spanMs),
    interval: 0 as const,
    minTickGap: 4,
    tickMargin: 6,
    tick: { fill: "var(--muted)", fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: "var(--line)" },
    allowDataOverflow: true,
  };
}

/**
 * For a categorical axis whose categories are times (ISO strings, evenly spaced like plan slots):
 * pick the first category at/after each round tick so labels sit on round times.
 */
export function categoryTimeAxisProps(cats: string[], width: number) {
  const ms = cats.map((c) => Date.parse(c));
  const min = ms[0];
  const max = ms[ms.length - 1];
  const tt = timeTicks(min, max, tickBudget(width));
  const ticks: string[] = [];
  let j = 0;
  for (const t of tt.ticks) {
    while (j < ms.length && ms[j] < t) j++;
    if (j < ms.length && ms[j] - t < tt.stepMs / 2 && !ticks.includes(cats[j])) ticks.push(cats[j]);
  }
  return {
    ticks,
    interval: 0 as const,
    tickFormatter: (v: string) => fmtTimeTick(Date.parse(v), tt.stepMs, tt.spanMs),
    tickMargin: 6,
    tick: { fill: "var(--muted)", fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: "var(--line)" },
  };
}

/**
 * For a categorical axis of dates ("YYYY-MM-DD"), weeks (Monday date) or months ("YYYY-MM"):
 * evenly spaced ticks that always include the latest category, with short labels.
 */
export function dateCategoryAxisProps(keys: string[], width: number, grain: "day" | "week" | "month" = "day") {
  const n = keys.length;
  const budget = tickBudget(width, grain === "month" ? 48 : 64);
  const step = Math.max(1, Math.ceil(n / budget));
  const ticks: string[] = [];
  for (let i = n - 1; i >= 0; i -= step) ticks.unshift(keys[i]);
  const span = n;
  return {
    ticks,
    interval: 0 as const,
    tickFormatter: (k: string) => fmtDateKeyShort(k, grain, span),
    tickMargin: 6,
    tick: { fill: "var(--muted)", fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: "var(--line)" },
  };
}

const keyMs = (k: string) => Date.parse(k.length === 7 ? `${k}-15T12:00:00Z` : `${k}T12:00:00Z`);
const uDM = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const uWd = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });
const uMon = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const uFullDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const uMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

export function fmtDateKeyShort(k: string, grain: "day" | "week" | "month", count: number): string {
  const ms = keyMs(k);
  if (!Number.isFinite(ms)) return k;
  if (grain === "month") {
    const d = new Date(ms);
    return d.getUTCMonth() === 0 ? `Jan ${String(d.getUTCFullYear()).slice(2)}` : uMon.format(ms);
  }
  if (grain === "day" && count <= 7) return uWd.format(ms);
  return uDM.format(ms);
}

export function fmtDateKeyFull(k: unknown, grain: "day" | "week" | "month" = "day"): string {
  const s = String(k ?? "");
  const ms = keyMs(s);
  if (!Number.isFinite(ms)) return s;
  if (grain === "month") return uMonthYear.format(ms);
  if (grain === "week") return `Week of ${uFullDay.format(ms)}`;
  return uFullDay.format(ms);
}
