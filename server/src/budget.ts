import { getVariables } from "./variables.js";
/**
 * Predicted net electricity cost for today (Europe/London day), from Predbat.
 *
 * - Actual so far: predbat.cost_today (p). Predbat's own running cost for today: import − export,
 *   and because apps.yaml sets metric_standing_charge to the Octopus standing-charge sensor, it
 *   already includes today's standing charge (its results series starts at 00:00 with that amount).
 * - Predicted day total: predbat.best_metric attribute `today` (p) — Predbat's cumulative cost of the
 *   plan it is executing, from 00:00 to midnight (actual so far + predicted remainder, net of export,
 *   incl. standing charge). Fallback: the last point of best_metric.results before London midnight.
 * - Remaining = predicted − actual.
 */
import type { HaClient } from "./ha.js";
import { num } from "./ha.js";
import { londonDate, londonInstant, addDays } from "./time.js";
import { getSettings } from "./settings.js";

const standingId = () => getVariables().tariff.standing_charge;

export type DayCost = {
  date: string;
  actual_gbp: number | null;
  predicted_gbp: number | null;
  remaining_gbp: number | null;
  budget_gbp: number;
  step_gbp: number;
  over: boolean;
  over_by_gbp: number | null;
  standing_gbp: number | null;
  standing_included: boolean;
  source: string;
  updated: string | null;
};

const asNum = (v: unknown) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};

export function dayCost(ha: HaClient, now = new Date()): DayCost {
  const t = getSettings().thresholds;
  const actualEnt = ha.get(getVariables().predbat.cost_today);
  const best = ha.get(getVariables().predbat.best_metric);
  const actualP = num(actualEnt);
  let predictedP = asNum(best?.attributes?.today);
  let source = "predbat.best_metric · today";
  if (predictedP == null) {
    const results = best?.attributes?.results as Record<string, unknown> | undefined;
    if (results && typeof results === "object") {
      const midnight = londonInstant(addDays(londonDate(now), 1), 0, 0).getTime();
      let last: number | null = null;
      for (const [k, v] of Object.entries(results)) {
        const ts = Date.parse(k);
        if (Number.isFinite(ts) && ts <= midnight && asNum(v) != null) last = asNum(v);
      }
      if (last != null) {
        predictedP = last;
        source = "predbat.best_metric · results at midnight";
      }
    }
  }
  const g = (p: number | null) => (p == null ? null : Math.round(p) / 100);
  const predicted = g(predictedP);
  const budget = t.daily_cost_gbp;
  return {
    date: londonDate(now),
    actual_gbp: g(actualP),
    predicted_gbp: predicted,
    remaining_gbp: predictedP != null && actualP != null ? g(predictedP - actualP) : null,
    budget_gbp: budget,
    step_gbp: t.daily_cost_step_gbp,
    over: predicted != null && predicted > budget,
    over_by_gbp: predicted != null ? Math.round((predicted - budget) * 100) / 100 : null,
    standing_gbp: num(ha.get(standingId())),
    standing_included: true,
    source,
    updated: best?.last_updated || null,
  };
}
