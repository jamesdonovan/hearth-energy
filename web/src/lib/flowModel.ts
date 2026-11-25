/**
 * Live power flow model: turns the Powerwall's signed power readings into source → sink flows.
 *
 * Sign conventions, checked against live HA data (hourly means balance exactly:
 * load = solar + battery + grid):
 *   solar power     kW, ≥ 0
 *   load power      kW, ≥ 0, whole home including car chargers
 *   battery power   kW, + discharging / − charging
 *   grid power      kW, + importing / − exporting
 *   car charger power(s)  kW, ≥ 0 (part of load)
 *
 * Allocation (the Powerwall doesn't report per-path flows, so this is the usual priority split):
 *   solar   → home first, then battery, then grid
 *   battery → home first, then grid (forced export)
 *   grid    → home first, then battery (grid charging)
 */
export const FLOW_MIN_KW = 0.02; // lines under ~20 W are idle

export type FlowInput = {
  solar: number | null | undefined;
  load: number | null | undefined;
  battery: number | null | undefined; // + discharge / − charge
  grid: number | null | undefined; // + import / − export
  tesla?: number | null;
  ev9?: number | null;
};

export type FlowEdgeId =
  | "solar_home"
  | "solar_battery"
  | "solar_grid"
  | "battery_home"
  | "battery_grid"
  | "grid_home"
  | "grid_battery"
  | "home_tesla"
  | "home_ev9";

export type Flow = { id: FlowEdgeId; from: string; to: string; kw: number };

export type FlowModel = {
  solar: number;
  load: number;
  house: number; // home load excluding the car chargers
  batteryCharge: number;
  batteryDischarge: number;
  gridImport: number;
  gridExport: number;
  tesla: number;
  ev9: number;
  flows: Flow[]; // only active flows (≥ FLOW_MIN_KW), each from source to sink
};

const pos = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v : 0);

export function flowModel(i: FlowInput): FlowModel {
  const S = pos(i.solar);
  const L = pos(i.load);
  const b = i.battery != null && Number.isFinite(i.battery) ? i.battery : 0;
  const g = i.grid != null && Number.isFinite(i.grid) ? i.grid : 0;
  const Bd = b > 0 ? b : 0;
  const Bc = b < 0 ? -b : 0;
  const Gi = g > 0 ? g : 0;
  const Ge = g < 0 ? -g : 0;
  const tesla = pos(i.tesla);
  const ev9 = pos(i.ev9);

  // Sources to the home load
  const s2h = Math.min(S, L);
  let need = L - s2h;
  const b2h = Math.min(Bd, need);
  need -= b2h;
  const g2h = Math.min(Gi, need);
  // Leftovers to battery charging / export
  let sLeft = S - s2h;
  let bLeft = Bd - b2h;
  let gLeft = Gi - g2h;
  const s2b = Math.min(sLeft, Bc);
  sLeft -= s2b;
  const g2b = Math.min(gLeft, Bc - s2b);
  gLeft -= g2b;
  const s2g = Math.min(sLeft, Ge);
  const b2g = Math.min(bLeft, Ge - s2g);
  bLeft -= b2g;

  const all: Flow[] = [
    { id: "solar_home", from: "solar", to: "home", kw: s2h },
    { id: "solar_battery", from: "solar", to: "battery", kw: s2b },
    { id: "solar_grid", from: "solar", to: "grid", kw: s2g },
    { id: "battery_home", from: "battery", to: "home", kw: b2h },
    { id: "battery_grid", from: "battery", to: "grid", kw: b2g },
    { id: "grid_home", from: "grid", to: "home", kw: g2h },
    { id: "grid_battery", from: "grid", to: "battery", kw: g2b },
    { id: "home_tesla", from: "home", to: "tesla", kw: tesla },
    { id: "home_ev9", from: "home", to: "ev9", kw: ev9 },
  ];
  void gLeft;
  return {
    solar: S,
    load: L,
    house: Math.max(0, L - tesla - ev9),
    batteryCharge: Bc,
    batteryDischarge: Bd,
    gridImport: Gi,
    gridExport: Ge,
    tesla,
    ev9,
    flows: all.filter((f) => f.kw >= FLOW_MIN_KW),
  };
}

/** Dev fixtures (also used by the unit test and the /dev/flow page). Values in kW, HA sign conventions. */
export const FLOW_FIXTURES: Record<string, { title: string; input: FlowInput }> = {
  grid_charging: { title: "Night: grid charging the Powerwall and a car", input: { solar: 0, load: 7.6, battery: -5, grid: 12.6, tesla: 7.2, ev9: 0 } },
  solar_charging: { title: "Sunny: solar powering home and charging", input: { solar: 4.2, load: 0.8, battery: -3.4, grid: 0, tesla: 0, ev9: 0 } },
  discharging: { title: "Evening: Powerwall powering the home", input: { solar: 0, load: 0.62, battery: 0.62, grid: 0, tesla: 0, ev9: 0 } },
  solar_export: { title: "Sunny: solar exporting surplus", input: { solar: 5, load: 0.7, battery: 0, grid: -4.3, tesla: 0, ev9: 0 } },
  battery_export: { title: "Peak: Powerwall force-exporting", input: { solar: 0, load: 0.5, battery: 5, grid: -4.5, tesla: 0, ev9: 0 } },
  idle_noise: { title: "Idle (10 W noise ignored)", input: { solar: 0.01, load: 0.4, battery: 0.39, grid: 0.01, tesla: 0, ev9: 0 } },
};
