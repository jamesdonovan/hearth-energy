import type { HaClient, HaEntity } from "./ha.js";
import { getVariables } from "./variables.js";

export type PlanRow = {
  time: string;
  import_rate: number | null;
  export_rate: number | null;
  state: string;
  state_target: string;
  pv_forecast: number | null;
  load_forecast: number | null;
  soc_percent: number | null;
  soc_change: number | null;
  car_charging: number | null;
  cost_change: number | null;
  total_cost: number | null;
};

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildPlan(raw: Record<string, unknown> | undefined) {
  if (!raw || typeof raw !== "object") return null;
  const rowsIn = Array.isArray(raw.rows) ? (raw.rows as Record<string, unknown>[]) : [];
  const rows: PlanRow[] = rowsIn.map((r) => ({
    time: String(r.time ?? ""),
    import_rate: asNum(r.import_rate),
    export_rate: asNum(r.export_rate),
    state: String(r.state ?? ""),
    state_target: String(r.state_target ?? ""),
    pv_forecast: asNum(r.pv_forecast),
    load_forecast: asNum(r.load_forecast),
    soc_percent: asNum(r.soc_percent),
    soc_change: asNum(r.soc_change),
    car_charging: asNum(r.car_charging),
    cost_change: asNum(r.cost_change),
    total_cost: asNum(r.total_cost),
  }));

  const windows: { type: "charge" | "export" | "freeze"; start: string; end: string; target?: string }[] = [];
  let cur: (typeof windows)[0] | null = null;
  const kind = (state: string): "charge" | "export" | "freeze" | null => {
    const s = state.toLowerCase();
    if (s.startsWith("chrg") || s === "charge" || s.includes("charge") && !s.includes("freeze")) return "charge";
    if (s.startsWith("exp") || s === "export") return "export";
    if (s.includes("freeze") || s === "frz" || s === "hold") return "freeze";
    return null;
  };
  for (let i = 0; i < rows.length; i++) {
    const k = kind(rows[i].state);
    const t = rows[i].time;
    if (k) {
      if (cur && cur.type === k) {
        cur.end = t;
        if (rows[i].state_target) cur.target = rows[i].state_target;
      } else {
        if (cur) windows.push(cur);
        cur = { type: k, start: t, end: t, target: rows[i].state_target || undefined };
      }
    } else if (cur) {
      cur.end = t;
      windows.push(cur);
      cur = null;
    }
  }
  if (cur) {
    // last window: extend one half-hour beyond the final row
    const last = new Date(rows[rows.length - 1].time);
    if (!Number.isNaN(last.getTime())) {
      last.setMinutes(last.getMinutes() + 30);
      cur.end = last.toISOString();
    }
    windows.push(cur);
  }

  const totals = (raw.totals ?? {}) as Record<string, unknown>;
  return {
    generated: raw.timestamp ?? null,
    mode: raw.mode ?? null,
    soc: asNum(raw.soc),
    soc_max: asNum(raw.soc_max),
    reserve: asNum(raw.reserve),
    forecast_minutes: raw.forecast_minutes ?? null,
    import_cost_threshold: asNum(raw.import_cost_threshold),
    export_cost_threshold: asNum(raw.export_cost_threshold),
    totals: {
      total_cost: asNum(totals.total_cost),
      pv_forecast: asNum(totals.pv_forecast),
      load_forecast: asNum(totals.load_forecast),
      car_charging: asNum(totals.car_charging),
      soc_percent: asNum(totals.soc_percent),
    },
    rows,
    windows,
  };
}

export function ratesFromEntity(ent: HaEntity | undefined): { t: string; v: number }[] {
  const results = ent?.attributes?.results;
  if (!results || typeof results !== "object") return [];
  return Object.entries(results as Record<string, unknown>)
    .map(([t, v]) => ({ t, v: Number(v) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => a.t.localeCompare(b.t));
}

export function eventRates(ent: HaEntity | undefined): { start: string; end: string; value: number }[] {
  const rates = ent?.attributes?.rates;
  if (!Array.isArray(rates)) return [];
  return rates
    .map((r: Record<string, unknown>) => ({
      start: String(r.start ?? ""),
      end: String(r.end ?? ""),
      value: Number(r.value_inc_vat ?? r.value ?? r.rate),
    }))
    .filter((r) => r.start && Number.isFinite(r.value));
}

export async function loadPlan(ha: HaClient) {
  const rawEnt = await ha.getRawState(getVariables().predbat.plan_html);
  const raw = (rawEnt?.attributes as Record<string, unknown> | undefined)?.raw as
    | Record<string, unknown>
    | undefined;
  return buildPlan(raw);
}
