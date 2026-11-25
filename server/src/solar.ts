import type { HaClient, StatisticPoint } from "./ha.js";
import { addDays, londonDate, londonParts } from "./time.js";
import { getVariables } from "./variables.js";

const pvForecast = () => getVariables().predbat.pv_today;
const pvActual = () => getVariables().site.pw_solar_generated;

let cache: { at: number; days: number; data: unknown } | null = null;

/**
 * Forecast vs actual per day.
 * - morning forecast: Predbat/Solcast "PV today" as it stood at 06:00 London (what the night plan was built on)
 * - final forecast: the same sensor's last value of the day (after intra-day recalibration)
 * - actual: Powerwall solar generated (daily change in long-term statistics)
 */
export async function solarAccuracy(ha: HaClient, days = 14) {
  if (cache && cache.days === days && Date.now() - cache.at < 15 * 60000) return cache.data as ReturnType<typeof shape>;
  const now = new Date();
  const start = new Date(now.getTime() - (days + 1) * 86400000);
  const [hourly, daily] = await Promise.all([
    ha.statisticsDuringPeriod([pvForecast()], start.toISOString(), now.toISOString(), "hour"),
    ha.statisticsDuringPeriod([pvActual()], start.toISOString(), now.toISOString(), "day"),
  ]);
  const data = shape(hourly[pvForecast()] || [], daily[pvActual()] || [], now, days);
  cache = { at: Date.now(), days, data };
  return data;
}

function shape(fc: StatisticPoint[], act: StatisticPoint[], now: Date, days: number) {
  const morning = new Map<string, number>();
  const final = new Map<string, number>();
  for (const p of fc) {
    const v = p.mean;
    if (v == null || !Number.isFinite(v)) continue;
    const d = londonDate(p.start);
    const { hour } = londonParts(p.start);
    if (hour === 6) morning.set(d, v);
    // Last full hour that belongs to this day; skip the midnight hour (still carries yesterday's value briefly)
    if (hour >= 1) final.set(d, v);
  }
  const actual = new Map<string, number>();
  for (const p of act) {
    const v = p.change;
    if (v == null || !Number.isFinite(v)) continue;
    actual.set(londonDate(p.start), v);
  }
  const today = londonDate(now);
  const rows: {
    date: string;
    forecast_morning: number | null;
    forecast_final: number | null;
    actual: number | null;
    error_kwh: number | null;
    accuracy_pct: number | null;
    complete: boolean;
  }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const fm = morning.get(d) ?? null;
    const ff = final.get(d) ?? null;
    const a = actual.get(d) ?? null;
    const f = fm ?? ff;
    const complete = d < today;
    const acc = complete && f != null && a != null && (a > 0.2 || f > 0.2) ? Math.max(0, 100 - (Math.abs(f - a) / Math.max(a, f, 0.5)) * 100) : null;
    rows.push({
      date: d,
      forecast_morning: round(fm),
      forecast_final: round(ff),
      actual: round(a),
      error_kwh: complete && f != null && a != null ? round(f - a) : null,
      accuracy_pct: acc == null ? null : Math.round(acc),
      complete,
    });
  }
  const done = rows.filter((r) => r.complete && r.actual != null && r.forecast_morning != null);
  const sumA = done.reduce((s, r) => s + (r.actual || 0), 0);
  const sumF = done.reduce((s, r) => s + (r.forecast_morning || 0), 0);
  const mae = done.length ? done.reduce((s, r) => s + Math.abs((r.forecast_morning || 0) - (r.actual || 0)), 0) / done.length : null;
  const accs = rows.filter((r) => r.accuracy_pct != null).map((r) => r.accuracy_pct!);
  return {
    days,
    rows,
    summary: {
      days_compared: done.length,
      forecast_kwh: round(sumF),
      actual_kwh: round(sumA),
      bias_pct: sumA > 0 ? Math.round(((sumF - sumA) / sumA) * 100) : null,
      mean_abs_error_kwh: round(mae),
      mean_accuracy_pct: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
      wape_accuracy_pct: sumA > 0 && mae != null ? Math.max(0, Math.round(100 - ((mae * done.length) / sumA) * 100)) : null,
    },
    method:
      "Forecast = Predbat's Solcast-based PV-today figure at 06:00 London (the one the overnight plan used). Actual = Powerwall solar generated. Daily accuracy = 100 − |forecast − actual| ÷ max(forecast, actual).",
  };
}

function round(v: number | null | undefined, dp = 2) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
