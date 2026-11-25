import type { ChargerConfig, VariablesConfig, VehicleConfig, VehicleKind, ChargerKind } from "./api";
import { num, type FlowIds } from "./derived";
import type { HaEntity } from "./api";

export function vehicleOf(v: VariablesConfig | null | undefined, id: string): VehicleConfig | undefined {
  return v?.vehicles.find((x) => x.id === id);
}

export function teslaOf(v: VariablesConfig | null | undefined) {
  if (!v) return undefined;
  return vehicleOf(v, "tesla") || vehicleOf(v, "car_1") || v.vehicles.find((x) => x.kind === "tesla_iog");
}

export function ev9Of(v: VariablesConfig | null | undefined) {
  if (!v) return undefined;
  const t = teslaOf(v);
  return vehicleOf(v, "ev9") || vehicleOf(v, "car_2") || v.vehicles.find((x) => x.kind === "kia") || v.vehicles.find((x) => x.id !== t?.id);
}

export function chargerOf(v: VariablesConfig | null | undefined, id: string | null | undefined) {
  if (!v || !id) return undefined;
  return v.chargers.find((c) => c.id === id);
}

export function chargerForVehicle(v: VariablesConfig | null | undefined, car: VehicleConfig | undefined) {
  return chargerOf(v, car?.charger_id);
}

/** Prefer the linked charger's power; fall back to the car's own charging power. */
export function vehiclePower(entities: Record<string, HaEntity>, v: VariablesConfig | null | undefined, car: VehicleConfig | undefined): number | null {
  if (!car) return null;
  const ch = chargerForVehicle(v, car);
  const chargerP = ch?.power ? num(entities, ch.power) : null;
  const carP = car.charging_power ? num(entities, car.charging_power) : null;
  if (chargerP != null && chargerP > 0.05) return chargerP;
  return carP ?? chargerP;
}

export function siteId(v: VariablesConfig | null | undefined, key: string, fallback = ""): string {
  const val = v?.site?.[key];
  return typeof val === "string" && val ? val : fallback;
}

export function tariffId(v: VariablesConfig | null | undefined, key: string, fallback = ""): string {
  const val = v?.tariff?.[key];
  return typeof val === "string" && val ? val : fallback;
}

export function predbatId(v: VariablesConfig | null | undefined, key: string, fallback = ""): string {
  const val = v?.predbat?.[key];
  return typeof val === "string" && val ? val : fallback;
}

export function slugId(name: string, used: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "item";
  if (!/^[a-z]/.test(base)) base = `v_${base}`;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  return id;
}

export function blankVehicle(name: string, kind: VehicleKind, used: Set<string>): VehicleConfig {
  return {
    id: slugId(name, used),
    name,
    kind,
    charger_id: null,
    predbat_index: null,
    idle_min: 60,
    soc: "",
    soc_last_known: null,
    range: null,
    range_last_known: null,
    charge_limit: null,
    charge_limit_last_known: null,
    plugged: null,
    charging: null,
    charging_power: null,
    charge_switch: null,
    charge_rate: null,
    time_to_full: null,
    energy_added: null,
    location: null,
    status: null,
    as_of: null,
    last_scanned: null,
    odometer: null,
    capacity: null,
    economy: null,
    charge_duration: null,
    boost: null,
    predbat_slot: null,
    predbat_soc: null,
    predbat_start: null,
    predbat_soc_best: null,
    predbat_rate: null,
    iog_dispatching: null,
    iog_state: null,
    iog_soc: null,
    iog_charge_target: null,
    iog_target_time: null,
    iog_smart_charge: null,
    iog_bump_charge: null,
  };
}

export function blankCharger(name: string, kind: ChargerKind, used: Set<string>): ChargerConfig {
  return {
    id: slugId(name, used),
    name,
    kind,
    status: null,
    power: null,
    target: null,
    mode: null,
    energy: null,
    slots: null,
    vehicle_battery: null,
    target_time: null,
  };
}

export function flowIdsFrom(v: VariablesConfig | null | undefined): FlowIds {
  const tesla = teslaOf(v);
  const ev9 = ev9Of(v);
  return {
    solar: siteId(v, "pw_solar_power") || undefined,
    load: siteId(v, "pw_load_power") || undefined,
    battery: siteId(v, "pw_batt_power") || undefined,
    grid: siteId(v, "pw_grid_power") || undefined,
    tesla: chargerForVehicle(v, tesla)?.power || tesla?.charging_power || undefined,
    ev9: chargerForVehicle(v, ev9)?.power || ev9?.charging_power || undefined,
  };
}
