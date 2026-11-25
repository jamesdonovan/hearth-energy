import { getVariables, kiaLike, teslaLike } from "./variables.js";
import type { HaClient } from "./ha.js";
import { num } from "./ha.js";
import { loadPlan } from "./plan.js";
import { carPlan, iogDispatches, isExtraIogSlot, morningTarget } from "./cars.js";

type PlanT = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

/** Tonight = now → the next morning target (Predbat car plan time, default 07:00 London). */
export async function buildTonight(ha: HaClient, now = new Date()) {
  const plan = await loadPlan(ha).catch(() => null);
  const until = morningTarget(ha, now);
  const pw = powerwallTonight(plan, now, until, num(ha.get(getVariables().predbat.soc_max_calculated)) ?? plan?.soc_max ?? getVariables().site.pw_capacity_kwh);
  const iog = iogDispatches(ha);
  const extra = iog.planned.filter((d) => isExtraIogSlot(d.start, d.end));
  const tesla = teslaLike();
  const kia = kiaLike();
  const vehicles: Record<string, ReturnType<typeof carPlan>> = {};
  for (const v of getVariables().vehicles) vehicles[v.id] = carPlan(ha, v.id, now);
  return {
    generated: now.toISOString(),
    from: now.toISOString(),
    until: until.toISOString(),
    powerwall: pw,
    tesla: tesla ? { ...carPlan(ha, tesla.id, now), iog_planned: iog.planned, iog_extra: extra, iog_active: iog.active } : null,
    ev9: kia ? carPlan(ha, kia.id, now) : null,
    vehicles,
  };
}

function powerwallTonight(plan: PlanT | null, now: Date, until: Date, socMaxKwh: number) {
  if (!plan) return null;
  const rows = plan.rows.filter((r) => {
    const t = Date.parse(r.time);
    return t >= now.getTime() - 30 * 60000 && t < until.getTime();
  });
  const kindOf = (state: string): "charge" | "export" | "freeze" | null => {
    const x = state.toLowerCase();
    if (x.includes("frz") || x.includes("freeze") || x === "hold") return "freeze";
    if (x.startsWith("chrg") || x === "charge") return "charge";
    if (x.startsWith("exp") || x === "export") return "export";
    return null;
  };
  type Win = { type: "charge" | "export" | "freeze"; start: string; end: string; target?: string; rates: number[]; exportRates: number[] };
  const merged: Win[] = [];
  const all = plan.rows;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const t = Date.parse(r.time);
    if (t >= until.getTime()) break;
    const nextT = i + 1 < all.length ? Date.parse(all[i + 1].time) : t + 30 * 60000;
    if (nextT <= now.getTime()) continue;
    const k = kindOf(r.state);
    if (!k) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === k && Date.parse(last.end) === t) {
      last.end = new Date(nextT).toISOString();
      if (r.state_target) last.target = r.state_target;
      if (r.import_rate != null) last.rates.push(r.import_rate);
      if (r.export_rate != null) last.exportRates.push(r.export_rate);
    } else {
      merged.push({ type: k, start: new Date(t).toISOString(), end: new Date(nextT).toISOString(), target: r.state_target || undefined, rates: r.import_rate != null ? [r.import_rate] : [], exportRates: r.export_rate != null ? [r.export_rate] : [] });
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const windowsOut = merged.map(({ rates, exportRates, ...w }) => ({ ...w, import_rate_p: avg(rates), export_rate_p: avg(exportRates) }));
  let chargeKwh = 0;
  let chargeCostP = 0;
  let exportKwh = 0;
  let exportEarnP = 0;
  for (const r of rows) {
    const s = r.state.toLowerCase();
    const d = r.soc_change ?? 0;
    if ((s.startsWith("chrg") || s === "charge") && d > 0) {
      chargeKwh += d;
      chargeCostP += d * (r.import_rate ?? 0);
    }
    if (s.startsWith("exp") && d < 0) {
      exportKwh += -d;
      exportEarnP += -d * (r.export_rate ?? 0);
    }
  }
  const atMorning = [...plan.rows].reverse().find((r) => Date.parse(r.time) <= until.getTime());
  const minRow = rows.reduce<(typeof rows)[0] | null>((a, r) => (r.soc_percent != null && (!a || (a.soc_percent ?? 101) > r.soc_percent) ? r : a), null);
  return {
    soc_now: plan.soc != null && socMaxKwh ? (plan.soc / socMaxKwh) * 100 : null,
    soc_morning: atMorning?.soc_percent ?? null,
    soc_min: minRow?.soc_percent ?? null,
    soc_min_at: minRow?.time ?? null,
    windows: windowsOut,
    charge_kwh: Math.round(chargeKwh * 100) / 100,
    charge_cost_p: Math.round(chargeCostP * 10) / 10,
    export_kwh: Math.round(exportKwh * 100) / 100,
    export_earn_p: Math.round(exportEarnP * 10) / 10,
    plan_generated: plan.generated,
  };
}
