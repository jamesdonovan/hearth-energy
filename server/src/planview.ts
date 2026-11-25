/**
 * Plan page model: Predbat's plan (predbat.plan_html raw rows) as clean 30-minute slots, with each car's
 * planned charging, rate bands, running cost and a summary. Read-only: HA state reads only.
 */
import type { HaClient } from "./ha.js";
import { loadPlan, type PlanRow } from "./plan.js";
import { carPlan, iogDispatches } from "./cars.js";
import { kiaLike, teslaLike } from "./variables.js";
import { dayCost } from "./budget.js";

const TZ = "Europe/London";
const SLOT = 30 * 60 * 1000;

export type SlotState = "charge" | "export" | "hold" | "discharge" | "idle";

export type PlanSlot = {
  start: string;
  end: string;
  day: string; // London date
  state: SlotState;
  predbat_state: string;
  target_pct: number | null;
  import_p: number | null;
  export_p: number | null;
  band: "cheap" | "mid" | "peak";
  soc_pct: number | null; // at slot start
  soc_end_pct: number | null;
  battery_kwh: number | null; // + into battery / − out of battery during the slot
  pv_kwh: number | null;
  load_kwh: number | null;
  car_kwh: number | null; // Predbat's car charging for the slot
  cars: { tesla: number | null; ev9: number | null; iog: boolean };
  cost_gbp: number | null; // this slot
  total_gbp: number | null; // running total at slot end (Predbat's, continues from today's actual)
  is_now: boolean;
  past: boolean;
};

const londonDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

function slotState(r: PlanRow): SlotState {
  const s = r.state.toLowerCase();
  if (s.includes("frz") || s.includes("freeze") || s.includes("hold")) return "hold";
  if (s.startsWith("chrg") || s.includes("charge")) return "charge";
  if (s.startsWith("exp") || s.includes("export") || s.includes("dis")) return "export";
  if ((r.soc_change ?? 0) < -0.05) return "discharge";
  return "idle";
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function groupWindows(slots: PlanSlot[], pred: (s: PlanSlot) => boolean) {
  const out: { start: string; end: string; slots: number }[] = [];
  for (const s of slots) {
    if (!pred(s)) continue;
    const last = out[out.length - 1];
    if (last && last.end === s.start) {
      last.end = s.end;
      last.slots++;
    } else out.push({ start: s.start, end: s.end, slots: 1 });
  }
  return out;
}

export async function planView(ha: HaClient, now = new Date()) {
  const plan = await loadPlan(ha);
  const nowMs = now.getTime();
  const rows = plan?.rows ?? [];
  const cheapP = plan?.import_cost_threshold != null && plan.import_cost_threshold > 0 ? plan.import_cost_threshold + 0.5 : 10;
  const tesla = carPlan(ha, teslaLike()?.id || "car_1", now);
  const ev9 = carPlan(ha, kiaLike()?.id || "car_2", now);
  const iog = iogDispatches(ha);
  const carSpans = (slots: { start: string; end: string; kwh: number | null }[]) =>
    slots.map((s) => ({ a: Date.parse(s.start), b: Date.parse(s.end), kwh: s.kwh })).filter((s) => Number.isFinite(s.a) && Number.isFinite(s.b) && s.b > s.a);
  const tSpans = carSpans(tesla.slots);
  const eSpans = carSpans(ev9.slots);
  const iogSpans = carSpans(iog.planned);
  const socMax = plan?.soc_max ?? null;

  const slots: PlanSlot[] = rows.map((r, i) => {
    const a = Date.parse(r.time);
    const next = rows[i + 1] ? Date.parse(rows[i + 1].time) : a + SLOT;
    const b = Number.isFinite(next) && next > a ? next : a + SLOT;
    const share = (spans: { a: number; b: number; kwh: number | null }[]) => {
      let k = 0;
      let any = false;
      for (const s of spans) {
        const o = overlap(a, b, s.a, s.b);
        if (o > 0) {
          any = true;
          k += (s.kwh ?? 0) * (o / (s.b - s.a));
        }
      }
      return any ? Math.round(k * 100) / 100 : null;
    };
    const imp = r.import_rate;
    const band: PlanSlot["band"] = imp == null ? "mid" : imp <= cheapP ? "cheap" : imp >= 30 ? "peak" : "mid";
    const nextSoc = rows[i + 1]?.soc_percent ?? (r.soc_percent != null && r.soc_change != null && socMax ? Math.round(r.soc_percent + (r.soc_change / socMax) * 100) : null);
    return {
      start: new Date(a).toISOString(),
      end: new Date(b).toISOString(),
      day: londonDate(a),
      state: slotState(r),
      predbat_state: r.state,
      target_pct: r.state_target !== "" && Number.isFinite(Number(r.state_target)) ? Number(r.state_target) : null,
      import_p: imp,
      export_p: r.export_rate,
      band,
      soc_pct: r.soc_percent,
      soc_end_pct: nextSoc,
      battery_kwh: r.soc_change,
      pv_kwh: r.pv_forecast,
      load_kwh: r.load_forecast,
      car_kwh: r.car_charging,
      cars: { tesla: share(tSpans), ev9: share(eSpans), iog: iogSpans.some((s) => overlap(a, b, s.a, s.b) > 0) },
      cost_gbp: r.cost_change,
      total_gbp: rows[i + 1]?.total_cost ?? (r.total_cost != null ? Math.round((r.total_cost + (r.cost_change ?? 0)) * 100) / 100 : null),
      is_now: a <= nowMs && nowMs < b,
      past: b <= nowMs,
    };
  });

  // ---- summary
  const today = londonDate(nowMs);
  const dc = dayCost(ha, now);
  const lastToday = [...slots].reverse().find((s) => s.day === today);
  const lastSlot = slots[slots.length - 1];
  const tomorrowSlots = slots.filter((s) => s.day > today);
  const firstTomorrow = tomorrowSlots[0];
  const startOfTomorrowTotal = firstTomorrow && firstTomorrow.total_gbp != null && firstTomorrow.cost_gbp != null ? firstTomorrow.total_gbp - firstTomorrow.cost_gbp : null;
  const reservePct = plan?.reserve != null && socMax ? Math.round((plan.reserve / socMax) * 100) : null;
  const future = slots.filter((s) => !s.past);
  const empty = future.find((s) => s.soc_end_pct != null && reservePct != null && s.soc_end_pct <= reservePct + 0.5 && (s.soc_pct ?? 100) > reservePct + 0.5);
  const emptyRefill = empty ? future.find((s) => Date.parse(s.start) > Date.parse(empty.start) && s.state === "charge") : null;
  const chargeWins = groupWindows(future, (s) => s.state === "charge");
  const exportWins = groupWindows(future, (s) => s.state === "export");
  // cheapest upcoming import windows (merged runs of the lowest rate)
  const minRate = future.reduce((m, s) => (s.import_p != null && s.import_p < m ? s.import_p : m), Infinity);
  const cheapest = Number.isFinite(minRate) ? groupWindows(future, (s) => s.import_p != null && s.import_p <= minRate + 0.01) : [];
  const sum = (arr: PlanSlot[], f: (s: PlanSlot) => number | null) => Math.round(arr.reduce((a, s) => a + (f(s) ?? 0), 0) * 100) / 100;
  const firstOvernight = chargeWins[0] ?? null;
  const overnight = firstOvernight
    ? (() => {
        const ws = chargeWins.filter((w) => Date.parse(w.start) - Date.parse(firstOvernight.start) < 8 * 3600e3);
        const inWin = future.filter((s) => ws.some((w) => s.start >= w.start && s.end <= w.end));
        return {
          start: ws[0].start,
          end: ws[ws.length - 1].end,
          windows: ws,
          grid_kwh: Math.round(inWin.reduce((a, s) => a + Math.max(0, s.battery_kwh ?? 0), 0) * 10) / 10,
          target_pct: inWin.reduce((m, s) => (s.target_pct != null && s.target_pct > m ? s.target_pct : m), 0) || null,
          avg_rate_p: inWin.length ? Math.round((inWin.reduce((a, s) => a + (s.import_p ?? 0), 0) / inWin.length) * 10) / 10 : null,
        };
      })()
    : null;

  return {
    generated: plan?.generated ?? null,
    now: now.toISOString(),
    mode: plan?.mode ?? null,
    soc_max_kwh: socMax,
    reserve_pct: reservePct,
    thresholds: { cheap_import_p: cheapP, peak_import_p: 30 },
    slots,
    summary: {
      today: {
        date: today,
        actual_gbp: dc.actual_gbp,
        predicted_gbp: dc.predicted_gbp ?? (lastToday?.total_gbp ?? null),
        plan_total_gbp: lastToday?.total_gbp ?? null,
      },
      tomorrow: (() => {
        if (!firstTomorrow) return null;
        const ts = slots.filter((x) => x.day === firstTomorrow.day);
        const last = ts[ts.length - 1];
        const endTotal = last.total_gbp;
        if (startOfTomorrowTotal == null || endTotal == null) return null;
        return {
          date: firstTomorrow.day,
          until: last.end,
          cost_gbp: Math.round((endTotal - startOfTomorrowTotal) * 100) / 100,
          complete: londonDate(Date.parse(last.end)) !== firstTomorrow.day,
        };
      })(),
      horizon_end: lastSlot?.end ?? null,
      battery_empty: empty ? { at: empty.end, reserve_pct: reservePct, refill_at: emptyRefill?.start ?? null } : null,
      soc_now_pct: future[0]?.soc_pct ?? null,
      overnight_charge: overnight,
      charge_windows: chargeWins,
      export_windows: exportWins,
      cheapest_import: cheapest.length ? { rate_p: minRate, windows: cheapest.slice(0, 4) } : null,
      pv_kwh: sum(future, (s) => s.pv_kwh),
      load_kwh: sum(future, (s) => s.load_kwh),
      cars: {
        tesla: { name: tesla.name, slots: tesla.slots, planned_kwh: tesla.planned_kwh, planned_cost_p: tesla.planned_cost_p, soc_now: tesla.soc_now, soc_morning: tesla.soc_morning, iog_planned: iog.planned },
        ev9: { name: ev9.name, slots: ev9.slots, planned_kwh: ev9.planned_kwh, planned_cost_p: ev9.planned_cost_p, soc_now: ev9.soc_now, soc_morning: ev9.soc_morning },
      },
    },
    sources: [
      "predbat.plan_html (raw rows): state, target, import/export rate, PV and load forecast, SoC, car charging, cost per slot and running total",
      "Predbat per-car charging slot sensors (planned attribute); Octopus intelligent_dispatching planned_dispatches for an Intelligent Octopus Go vehicle",
      "predbat.cost_today + predbat.best_metric (today) for today's predicted cost",
    ],
  };
}
