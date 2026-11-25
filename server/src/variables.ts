/**
 * Role-based Home Assistant entity map and tunables.
 *
 * Defaults are generic, commented examples for common UK integrations
 * (Tesla Powerwall, Tesla Fleet, Kia UVO, Ohme, Octopus Energy, Predbat).
 * Replace the placeholder entity ids in Settings → Variables before going live.
 * Overrides live in DATA_DIR/variables.json and survive container rebuilds.
 * The HA token is never stored here.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, dataWritable, readJson, writeJson } from "./storage.js";
import type { ActionSpec } from "./whitelist.js";

export const FILE = "variables.json";
export const BAK = "variables.json.bak";

export const ENTITY_RE = /^[a-z][a-z0-9_]*\.[a-zA-Z0-9_]+$/;
export const STAT_RE = /^[a-z][a-z0-9_]+:[a-z0-9_]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type FieldMeta = {
  key: string;
  label: string;
  kind: "entity" | "number" | "time" | "string" | "stat" | "select";
  domains?: string[];
  units?: string[];
  hint?: string;
  optional?: boolean;
  group: string;
  options?: { value: string; label: string }[];
};

export type OfficialStats = {
  import_cost: string;
  import_cost_peak: string;
  import_cost_off_peak: string;
  import_kwh: string;
  import_kwh_peak: string;
  import_kwh_off_peak: string;
  export_cost: string;
  export_kwh: string;
};

export type Site = {
  pw_soc: string;
  pw_batt_power: string;
  pw_grid_power: string;
  pw_load_power: string;
  pw_solar_power: string;
  pw_grid_status: string;
  pw_grid_imported: string;
  pw_grid_exported: string;
  pw_solar_generated: string;
  pw_solar_exported: string;
  pw_home_usage: string;
  pw_batt_charged: string;
  pw_batt_discharged: string;
  pw_batt_from_grid: string;
  pw_batt_from_solar: string;
  pw_version: string;
  pw_operation_mode: string;
  pw_allow_export: string;
  pw_backup_reserve: string;
  pw_allow_charging_from_grid: string;
  pw_storm_watch: string;
  pw_storm_watch_active: string;
  pw_capacity_kwh: number;
  home_max_kw: number;
  flow_min_kw: number;
  pp_threshold_kw: number;
  pp_tail_kw: number;
  pp_min_on_min: number;
  pp_merge_gap_min: number;
  pp_min_kwh: number;
};


export type Tariff = {
  import_prefix: string;
  export_prefix: string;
  import_rate: string;
  import_next_rate: string;
  import_previous_rate: string;
  standing_charge: string;
  off_peak: string;
  import_accumulative_consumption: string;
  import_accumulative_cost: string;
  import_previous_accumulative_consumption: string;
  import_previous_accumulative_cost: string;
  import_total_consumption: string;
  import_total_export: string;
  export_current_rate: string;
  export_next_rate: string;
  export_previous_accumulative_consumption: string;
  export_previous_accumulative_cost: string;
  import_current_day_rates: string;
  import_next_day_rates: string;
  export_current_day_rates: string;
  export_next_day_rates: string;
  export_previous_day_rates: string;
  official: OfficialStats;
  off_peak_start: string;
  off_peak_end: string;
  peak_gbp: number;
  offpeak_gbp: number;
  standing_gbp: number;
  cheap_rate_gbp: number;
};

export type Predbat = {
  status: string;
  mode: string;
  set_read_only: string;
  best_soc_keep: string;
  set_reserve_min: string;
  manual_charge: string;
  manual_export: string;
  manual_freeze_charge: string;
  manual_freeze_export: string;
  plan_html: string;
  rates: string;
  rates_export: string;
  soc_kw_h0: string;
  soc_kw_best: string;
  soc_kw: string;
  soc_kw_best_h1: string;
  soc_kw_best_h8: string;
  soc_kw_best_h12: string;
  best_soc_min_kwh: string;
  best_battery_hours_left: string;
  best_charge_limit: string;
  best_charge_limit_kw: string;
  best_charge_start: string;
  best_charge_end: string;
  best_export_limit: string;
  best_export_limit_kw: string;
  best_export_start: string;
  best_export_end: string;
  cost_today: string;
  cost_today_import: string;
  cost_today_export: string;
  cost_yesterday: string;
  savings_yesterday_predbat: string;
  savings_yesterday_pvbat: string;
  savings_total_predbat: string;
  best_metric: string;
  import_energy_h0: string;
  export_energy_h0: string;
  pv_energy_h0: string;
  load_energy_h0: string;
  import_energy: string;
  export_energy: string;
  best_import_energy: string;
  best_export_energy: string;
  best_pv_energy: string;
  best_load_energy: string;
  best_import_energy_battery: string;
  best_import_energy_house: string;
  battery_cycle: string;
  battery_cycle_best: string;
  pv_power: string;
  pv_power_best: string;
  inverter_config: string;
  soc_max_calculated: string;
  pv_today: string;
  pv_tomorrow: string;
  pv_d2: string;
  pv_d3: string;
  pv_d4: string;
  pv_d5: string;
  pv_d6: string;
  pv_forecast_h0: string;
  pv_forecast_h0_uncalibrated: string;
  version: string;
  low_rate_start: string;
  low_rate_end: string;
  low_rate_cost: string;
  high_rate_export_start: string;
  high_rate_export_end: string;
  high_rate_export_cost: string;
  low_rate_slot: string;
  high_rate_export_slot: string;
  control_failures: string;
  control_failures_total: string;
  car_charging_plan_time: string;
};

export type ChargerKind = "ohme" | "tesla" | "other";
export type VehicleKind = "tesla_iog" | "kia" | "other";

export type Charger = {
  id: string;
  name: string;
  kind: ChargerKind;
  status: string | null;
  power: string | null;
  target: string | null;
  mode: string | null;
  energy: string | null;
  slots: string | null;
  vehicle_battery: string | null;
  target_time: string | null;
};

export type Vehicle = {
  id: string;
  name: string;
  kind: VehicleKind;
  charger_id: string | null;
  predbat_index: number | null;
  idle_min: number;
  soc: string;
  soc_last_known: string | null;
  range: string | null;
  range_last_known: string | null;
  charge_limit: string | null;
  charge_limit_last_known: string | null;
  plugged: string | null;
  charging: string | null;
  charging_power: string | null;
  charge_switch: string | null;
  charge_rate: string | null;
  time_to_full: string | null;
  energy_added: string | null;
  location: string | null;
  status: string | null;
  as_of: string | null;
  last_scanned: string | null;
  odometer: string | null;
  capacity: string | null;
  economy: string | null;
  charge_duration: string | null;
  boost: string | null;
  predbat_slot: string | null;
  predbat_soc: string | null;
  predbat_start: string | null;
  predbat_soc_best: string | null;
  predbat_rate: string | null;
  iog_dispatching: string | null;
  iog_state: string | null;
  iog_soc: string | null;
  iog_charge_target: string | null;
  iog_target_time: string | null;
  iog_smart_charge: string | null;
  iog_bump_charge: string | null;
};

export type Variables = {
  version: 1;
  updated_at: string | null;
  site: Site;
  tariff: Tariff;
  predbat: Predbat;
  vehicles: Vehicle[];
  chargers: Charger[];
  extra_subscribe: string[];
};

export type EntityHint = {
  entity_id: string;
  domain: string;
  friendly_name: string | null;
  state: string | null;
  unit: string | null;
  device_class: string | null;
};


/**
 * Example Octopus Energy entity prefixes.
 *
 * In Home Assistant these are:
 *   sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_…
 *   sensor.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_…
 *   event.octopus_energy_electricity_<MPAN>_<SERIAL>_…
 *   octopus_energy:electricity_<MPAN>_<SERIAL>_…   (statistics)
 *
 * Replace the `mpan`, `serial` and `export_serial` tokens below with your
 * actual MPAN and meter serials (Settings → Variables, or edit variables.json).
 * Do not commit real MPANs or serials to git.
 *
 * Intelligent Octopus Go devices look like:
 *   binary_sensor.octopus_energy_<ACCOUNT_UUID>_intelligent_dispatching
 */
const IMP = "sensor.octopus_energy_electricity_mpan_serial";
const EXP = "sensor.octopus_energy_electricity_mpan_export_serial_export";
const EVT_IMP = "event.octopus_energy_electricity_mpan_serial";
const EVT_EXP = "event.octopus_energy_electricity_mpan_export_serial_export";
const STAT_IMP = "octopus_energy:electricity_mpan_serial";
const STAT_EXP = "octopus_energy:electricity_mpan_export_serial";
const IOG = "octopus_energy_account_uuid_intelligent";

export function defaultChargerOhme(): Charger {
  // Example Ohme ePod entities (official Ohme integration, device named ePod).
  return {
    id: "ohme_epod",
    name: "Ohme ePod",
    kind: "ohme",
    status: "sensor.ohme_epod_status",
    power: "sensor.ohme_epod_power",
    target: "number.ohme_epod_target_percentage",
    mode: "select.ohme_epod_charge_mode",
    energy: "sensor.ohme_epod_energy",
    slots: "sensor.ohme_epod_charge_slots",
    vehicle_battery: "sensor.ohme_epod_vehicle_battery",
    target_time: "time.ohme_epod_target_time",
  };
}

export function defaultChargerTesla(): Charger {
  return {
    id: "tesla_charger",
    name: "Tesla charger (Fleet)",
    kind: "tesla",
    status: null,
    power: "sensor.tesla_charger_power",
    target: null,
    mode: null,
    energy: null,
    slots: null,
    vehicle_battery: null,
    target_time: null,
  };
}

export function emptyCharger(id: string, name = "Charger"): Charger {
  return {
    id, name, kind: "other",
    status: null, power: null, target: null, mode: null,
    energy: null, slots: null, vehicle_battery: null, target_time: null,
  };
}

export function defaultVehicleTesla(): Vehicle {
  // Example Tesla Fleet / Tesla custom-component entities. Replace `tesla` with your vehicle prefix.
  return {
    id: "car_1",
    name: "Car 1",
    kind: "tesla_iog",
    charger_id: "tesla_charger",
    predbat_index: 0,
    idle_min: 60,
    soc: "sensor.tesla_battery_level",
    soc_last_known: null,
    range: "sensor.tesla_battery_range",
    range_last_known: null,
    charge_limit: "number.tesla_charge_limit",
    charge_limit_last_known: null,
    plugged: "binary_sensor.tesla_charge_cable",
    charging: "sensor.tesla_charging",
    charging_power: "sensor.tesla_charger_power",
    charge_switch: "switch.tesla_charge",
    charge_rate: "sensor.tesla_charge_rate",
    time_to_full: "sensor.tesla_time_to_full_charge",
    energy_added: "sensor.tesla_charge_energy_added",
    location: "device_tracker.tesla_location",
    status: "binary_sensor.tesla_status",
    as_of: null,
    last_scanned: null,
    odometer: null,
    capacity: null,
    economy: null,
    charge_duration: null,
    boost: null,
    predbat_slot: "binary_sensor.predbat_car_charging_slot",
    predbat_soc: "predbat.car_soc",
    predbat_start: "predbat.car_charging_start",
    predbat_soc_best: "predbat.car_soc_best",
    predbat_rate: "input_number.predbat_car_charging_rate",
    iog_dispatching: `binary_sensor.${IOG}_dispatching`,
    iog_state: `sensor.${IOG}_state`,
    iog_soc: `sensor.${IOG}_state_of_charge`,
    iog_charge_target: `number.${IOG}_charge_target`,
    iog_target_time: `select.${IOG}_target_time`,
    iog_smart_charge: `switch.${IOG}_smart_charge`,
    iog_bump_charge: `switch.${IOG}_bump_charge`,
  };
}

export function defaultVehicleEv9(): Vehicle {
  // Example Kia UVO (kia_uvo) entities. Replace `kia` with your vehicle prefix.
  // *_last_known sensors are optional template helpers — see docs/INTEGRATIONS.md.
  return {
    id: "car_2",
    name: "Car 2",
    kind: "kia",
    charger_id: "ohme_epod",
    predbat_index: 1,
    idle_min: 60,
    soc: "sensor.kia_ev_battery_level",
    soc_last_known: "sensor.kia_ev_battery_level_last_known",
    range: "sensor.kia_ev_range",
    range_last_known: "sensor.kia_ev_range_last_known",
    charge_limit: "number.kia_ac_charging_limit",
    charge_limit_last_known: "sensor.kia_ac_charging_limit_last_known",
    plugged: "binary_sensor.kia_ev_battery_plug",
    charging: "switch.kia_ev_charging",
    charging_power: "sensor.kia_ev_charging_power",
    charge_switch: "switch.kia_ev_charging",
    charge_rate: null,
    time_to_full: null,
    energy_added: null,
    location: "device_tracker.kia_location",
    status: null,
    as_of: "sensor.kia_last_updated_at",
    last_scanned: "sensor.kia_last_scanned_at",
    odometer: "sensor.kia_odometer",
    capacity: "sensor.kia_ev_battery_capacity",
    economy: "sensor.kia_average_fuel_economy_accumulated",
    charge_duration: "sensor.kia_estimated_charge_duration",
    boost: "input_boolean.car_2_boost",
    predbat_slot: "binary_sensor.predbat_car_charging_slot_1",
    predbat_soc: "predbat.car_soc_1",
    predbat_start: "predbat.car_charging_start_1",
    predbat_soc_best: "predbat.car_soc_best_1",
    predbat_rate: "input_number.predbat_car_charging_rate_1",
    iog_dispatching: null,
    iog_state: null,
    iog_soc: null,
    iog_charge_target: null,
    iog_target_time: null,
    iog_smart_charge: null,
    iog_bump_charge: null,
  };
}

export function emptyVehicle(id: string, name = "Vehicle"): Vehicle {
  const base = defaultVehicleEv9();
  for (const k of Object.keys(base) as (keyof Vehicle)[]) {
    if (k === "id" || k === "name" || k === "kind" || k === "idle_min" || k === "predbat_index" || k === "charger_id") continue;
    if (typeof base[k] === "number") continue;
    (base as unknown as Record<string, unknown>)[k] = k === "soc" ? "" : null;
  }
  base.id = id;
  base.name = name;
  base.kind = "other";
  base.charger_id = null;
  base.predbat_index = null;
  base.idle_min = 60;
  base.soc = "";
  return base;
}


export function defaultVariables(): Variables {
  return {
    version: 1,
    updated_at: null,
    site: {
      // Example Tesla Powerwall entity ids. The official integration often uses {site_name}_percentage_charged, etc.
      pw_soc: "sensor.powerwall_percentage_charged",
      pw_batt_power: "sensor.powerwall_battery_power",
      pw_grid_power: "sensor.powerwall_grid_power",
      pw_load_power: "sensor.powerwall_load_power",
      pw_solar_power: "sensor.powerwall_solar_power",
      pw_grid_status: "sensor.powerwall_grid_status",
      pw_grid_imported: "sensor.powerwall_grid_imported",
      pw_grid_exported: "sensor.powerwall_grid_exported",
      pw_solar_generated: "sensor.powerwall_solar_generated",
      pw_solar_exported: "sensor.powerwall_solar_exported",
      pw_home_usage: "sensor.powerwall_home_usage",
      pw_batt_charged: "sensor.powerwall_battery_charged",
      pw_batt_discharged: "sensor.powerwall_battery_discharged",
      pw_batt_from_grid: "sensor.powerwall_battery_imported_from_grid",
      pw_batt_from_solar: "sensor.powerwall_battery_imported_from_solar",
      pw_version: "sensor.powerwall_version",
      pw_operation_mode: "select.powerwall_operation_mode",
      pw_allow_export: "select.powerwall_allow_export",
      pw_backup_reserve: "number.powerwall_backup_reserve",
      pw_allow_charging_from_grid: "switch.powerwall_allow_charging_from_grid",
      pw_storm_watch: "switch.powerwall_storm_watch",
      pw_storm_watch_active: "binary_sensor.powerwall_storm_watch_active",
      pw_capacity_kwh: 13.5,
      home_max_kw: 11.5,
      flow_min_kw: 0.02,
      pp_threshold_kw: 0.7,
      pp_tail_kw: 0.2,
      pp_min_on_min: 10,
      pp_merge_gap_min: 25,
      pp_min_kwh: 0.3,
    },
    tariff: {
      // Example Octopus Go cheap window and fallback rates (£). Edit to match your tariff.
      import_prefix: IMP,
      export_prefix: EXP,
      import_rate: `${IMP}_current_rate`,
      import_next_rate: `${IMP}_next_rate`,
      import_previous_rate: `${IMP}_previous_rate`,
      standing_charge: `${IMP}_current_standing_charge`,
      off_peak: `binary_sensor.octopus_energy_electricity_mpan_serial_off_peak`,
      import_accumulative_consumption: `${IMP}_current_accumulative_consumption`,
      import_accumulative_cost: `${IMP}_current_accumulative_cost`,
      import_previous_accumulative_consumption: `${IMP}_previous_accumulative_consumption`,
      import_previous_accumulative_cost: `${IMP}_previous_accumulative_cost`,
      import_total_consumption: `${IMP}_current_total_consumption`,
      import_total_export: `${IMP}_current_total_export`,
      export_current_rate: `${EXP}_current_rate`,
      export_next_rate: `${EXP}_next_rate`,
      export_previous_accumulative_consumption: `${EXP}_previous_accumulative_consumption`,
      export_previous_accumulative_cost: `${EXP}_previous_accumulative_cost`,
      import_current_day_rates: `${EVT_IMP}_current_day_rates`,
      import_next_day_rates: `${EVT_IMP}_next_day_rates`,
      export_current_day_rates: `${EVT_EXP}_current_day_rates`,
      export_next_day_rates: `${EVT_EXP}_next_day_rates`,
      export_previous_day_rates: `${EVT_EXP}_previous_day_rates`,
      official: {
        import_cost: `${STAT_IMP}_previous_accumulative_cost`,
        import_cost_peak: `${STAT_IMP}_previous_accumulative_cost_peak`,
        import_cost_off_peak: `${STAT_IMP}_previous_accumulative_cost_off_peak`,
        import_kwh: `${STAT_IMP}_previous_accumulative_consumption`,
        import_kwh_peak: `${STAT_IMP}_previous_accumulative_consumption_peak`,
        import_kwh_off_peak: `${STAT_IMP}_previous_accumulative_consumption_off_peak`,
        export_cost: `${STAT_EXP}_previous_accumulative_cost`,
        export_kwh: `${STAT_EXP}_previous_accumulative_consumption`,
      },
      off_peak_start: "23:30",
      off_peak_end: "05:30",
      peak_gbp: 0.30,
      offpeak_gbp: 0.07,
      standing_gbp: 0.60,
      cheap_rate_gbp: 0.10,
    },
    predbat: {
      status: "predbat.status",
      mode: "select.predbat_mode",
      set_read_only: "switch.predbat_set_read_only",
      best_soc_keep: "input_number.predbat_best_soc_keep",
      set_reserve_min: "input_number.predbat_set_reserve_min",
      manual_charge: "select.predbat_manual_charge",
      manual_export: "select.predbat_manual_export",
      manual_freeze_charge: "select.predbat_manual_freeze_charge",
      manual_freeze_export: "select.predbat_manual_freeze_export",
      plan_html: "predbat.plan_html",
      rates: "predbat.rates",
      rates_export: "predbat.rates_export",
      soc_kw_h0: "predbat.soc_kw_h0",
      soc_kw_best: "predbat.soc_kw_best",
      soc_kw: "predbat.soc_kw",
      soc_kw_best_h1: "predbat.soc_kw_best_h1",
      soc_kw_best_h8: "predbat.soc_kw_best_h8",
      soc_kw_best_h12: "predbat.soc_kw_best_h12",
      best_soc_min_kwh: "predbat.best_soc_min_kwh",
      best_battery_hours_left: "predbat.best_battery_hours_left",
      best_charge_limit: "predbat.best_charge_limit",
      best_charge_limit_kw: "predbat.best_charge_limit_kw",
      best_charge_start: "predbat.best_charge_start",
      best_charge_end: "predbat.best_charge_end",
      best_export_limit: "predbat.best_export_limit",
      best_export_limit_kw: "predbat.best_export_limit_kw",
      best_export_start: "predbat.best_export_start",
      best_export_end: "predbat.best_export_end",
      cost_today: "predbat.cost_today",
      cost_today_import: "predbat.cost_today_import",
      cost_today_export: "predbat.cost_today_export",
      cost_yesterday: "predbat.cost_yesterday",
      savings_yesterday_predbat: "predbat.savings_yesterday_predbat",
      savings_yesterday_pvbat: "predbat.savings_yesterday_pvbat",
      savings_total_predbat: "predbat.savings_total_predbat",
      best_metric: "predbat.best_metric",
      import_energy_h0: "predbat.import_energy_h0",
      export_energy_h0: "predbat.export_energy_h0",
      pv_energy_h0: "predbat.pv_energy_h0",
      load_energy_h0: "predbat.load_energy_h0",
      import_energy: "predbat.import_energy",
      export_energy: "predbat.export_energy",
      best_import_energy: "predbat.best_import_energy",
      best_export_energy: "predbat.best_export_energy",
      best_pv_energy: "predbat.best_pv_energy",
      best_load_energy: "predbat.best_load_energy",
      best_import_energy_battery: "predbat.best_import_energy_battery",
      best_import_energy_house: "predbat.best_import_energy_house",
      battery_cycle: "predbat.battery_cycle",
      battery_cycle_best: "predbat.battery_cycle_best",
      pv_power: "predbat.pv_power",
      pv_power_best: "predbat.pv_power_best",
      inverter_config: "sensor.predbat_inverter_config",
      soc_max_calculated: "sensor.predbat_soc_max_calculated",
      pv_today: "sensor.predbat_pv_today",
      pv_tomorrow: "sensor.predbat_pv_tomorrow",
      pv_d2: "sensor.predbat_pv_d2",
      pv_d3: "sensor.predbat_pv_d3",
      pv_d4: "sensor.predbat_pv_d4",
      pv_d5: "sensor.predbat_pv_d5",
      pv_d6: "sensor.predbat_pv_d6",
      pv_forecast_h0: "sensor.predbat_pv_forecast_h0",
      pv_forecast_h0_uncalibrated: "sensor.predbat_pv_forecast_h0_uncalibrated",
      version: "update.predbat_version",
      low_rate_start: "predbat.low_rate_start",
      low_rate_end: "predbat.low_rate_end",
      low_rate_cost: "predbat.low_rate_cost",
      high_rate_export_start: "predbat.high_rate_export_start",
      high_rate_export_end: "predbat.high_rate_export_end",
      high_rate_export_cost: "predbat.high_rate_export_cost",
      low_rate_slot: "binary_sensor.predbat_low_rate_slot",
      high_rate_export_slot: "binary_sensor.predbat_high_rate_export_slot",
      control_failures: "predbat.control_failures",
      control_failures_total: "predbat.control_failures_total",
      car_charging_plan_time: "select.predbat_car_charging_plan_time",
    },
    vehicles: [defaultVehicleTesla(), defaultVehicleEv9()],
    chargers: [defaultChargerTesla(), defaultChargerOhme()],
    extra_subscribe: [],
  };
}


const E = (key: string, label: string, group: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({
  key, label, kind: "entity", group, ...extra,
});
const N = (key: string, label: string, group: string, hint?: string, optional?: boolean): FieldMeta => ({
  key, label, kind: "number", group, hint, optional,
});

export const SITE_FIELDS: FieldMeta[] = [
  E("pw_soc", "Powerwall SoC", "Powerwall", { domains: ["sensor", "number"], units: ["%"] }),
  E("pw_batt_power", "Battery power", "Powerwall", { domains: ["sensor"], units: ["kW", "W"], hint: "Signed: + discharging, − charging." }),
  E("pw_batt_charged", "Battery charged (energy)", "Powerwall", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_batt_discharged", "Battery discharged (energy)", "Powerwall", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_batt_from_grid", "Battery charged from grid", "Powerwall", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_batt_from_solar", "Battery charged from solar", "Powerwall", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_backup_reserve", "Backup reserve", "Powerwall", { domains: ["number"], units: ["%"], optional: true }),
  E("pw_operation_mode", "Operation mode", "Powerwall", { domains: ["select"], optional: true }),
  E("pw_allow_export", "Allow export", "Powerwall", { domains: ["select"], optional: true }),
  E("pw_allow_charging_from_grid", "Allow charging from grid", "Powerwall", { domains: ["switch"], optional: true }),
  E("pw_storm_watch", "Storm Watch", "Powerwall", { domains: ["switch"], optional: true }),
  E("pw_storm_watch_active", "Storm Watch active", "Powerwall", { domains: ["binary_sensor"], optional: true }),
  E("pw_version", "Powerwall version", "Powerwall", { domains: ["sensor"], optional: true }),
  N("pw_capacity_kwh", "Usable capacity", "Powerwall", "kWh. Used as the PowerPrint battery-pot cap and the tonight fallback."),
  E("pw_solar_power", "Solar power", "Solar", { domains: ["sensor"], units: ["kW", "W"] }),
  E("pw_solar_generated", "Solar generated (energy)", "Solar", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_solar_exported", "Solar exported (energy)", "Solar", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_load_power", "Home load power", "Home consumption", { domains: ["sensor"], units: ["kW", "W"], hint: "Whole-home load, including car chargers." }),
  E("pw_home_usage", "Home usage (energy)", "Home consumption", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  N("home_max_kw", "Home wallbox max", "Home consumption", "kW. Sessions above this are treated as DC / away charging and ignored in home car costs."),
  N("flow_min_kw", "Flow diagram idle threshold", "Home consumption", "kW. Lines below this are hidden on the live flow."),
  E("pw_grid_power", "Grid power", "Export", { domains: ["sensor"], units: ["kW", "W"], hint: "Signed: + import, − export." }),
  E("pw_grid_imported", "Grid imported (energy)", "Export", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_grid_exported", "Grid exported (energy)", "Export", { domains: ["sensor"], units: ["kWh", "Wh"] }),
  E("pw_grid_status", "Grid status", "Export", { domains: ["sensor", "binary_sensor"], optional: true }),
  N("pp_threshold_kw", "PowerPrint start threshold", "PowerPrint detection", "kW above baseline to start a run."),
  N("pp_tail_kw", "PowerPrint end threshold", "PowerPrint detection", "kW above baseline to end a run."),
  N("pp_min_on_min", "PowerPrint minimum run", "PowerPrint detection", "Minutes."),
  N("pp_merge_gap_min", "PowerPrint merge gap", "PowerPrint detection", "Minutes. Nearby runs are merged."),
  N("pp_min_kwh", "PowerPrint minimum energy", "PowerPrint detection", "kWh."),
];

export const TARIFF_FIELDS: FieldMeta[] = [
  { key: "import_prefix", label: "Import entity prefix", kind: "string", group: "Prefixes", hint: "A hint when the meter or MPAN changes. Each rate entity below can still be set on its own." },
  { key: "export_prefix", label: "Export entity prefix", kind: "string", group: "Prefixes" },
  E("import_rate", "Import rate (now)", "Import rates", { domains: ["sensor"] }),
  E("import_next_rate", "Import rate (next)", "Import rates", { domains: ["sensor"], optional: true }),
  E("import_previous_rate", "Import rate (previous)", "Import rates", { domains: ["sensor"], optional: true }),
  E("standing_charge", "Standing charge", "Import rates", { domains: ["sensor"] }),
  E("off_peak", "Off-peak binary sensor", "Import rates", { domains: ["binary_sensor"] }),
  E("import_accumulative_cost", "Today's accumulative import cost", "Import meters", { domains: ["sensor"] }),
  E("import_accumulative_consumption", "Today's accumulative import energy", "Import meters", { domains: ["sensor"] }),
  E("import_previous_accumulative_cost", "Yesterday's import cost", "Import meters", { domains: ["sensor"], optional: true }),
  E("import_previous_accumulative_consumption", "Yesterday's import energy", "Import meters", { domains: ["sensor"], optional: true }),
  E("import_total_consumption", "Total import (lifetime)", "Import meters", { domains: ["sensor"], optional: true }),
  E("import_total_export", "Total export on import meter", "Import meters", { domains: ["sensor"], optional: true }),
  E("import_current_day_rates", "Import day rates (event)", "Rate events", { domains: ["event"] }),
  E("import_next_day_rates", "Import next-day rates (event)", "Rate events", { domains: ["event"], optional: true }),
  E("export_current_rate", "Export rate (now)", "Export rates", { domains: ["sensor"] }),
  E("export_next_rate", "Export rate (next)", "Export rates", { domains: ["sensor"], optional: true }),
  E("export_previous_accumulative_cost", "Yesterday's export earnings", "Export meters", { domains: ["sensor"], optional: true }),
  E("export_previous_accumulative_consumption", "Yesterday's export energy", "Export meters", { domains: ["sensor"], optional: true }),
  E("export_current_day_rates", "Export day rates (event)", "Rate events", { domains: ["event"] }),
  E("export_next_day_rates", "Export next-day rates (event)", "Rate events", { domains: ["event"], optional: true }),
  E("export_previous_day_rates", "Export previous-day rates (event)", "Rate events", { domains: ["event"], optional: true }),
  { key: "off_peak_start", label: "Off-peak start", kind: "time", group: "Window & fallbacks", hint: "London wall clock, HH:MM. Wraps midnight if start is later than end (Intelligent Octopus Go is 23:30–05:30)." },
  { key: "off_peak_end", label: "Off-peak end", kind: "time", group: "Window & fallbacks" },
  N("peak_gbp", "Fallback peak rate", "Window & fallbacks", "£/kWh, used when the live rate sensor has a gap."),
  N("offpeak_gbp", "Fallback off-peak rate", "Window & fallbacks", "£/kWh."),
  N("standing_gbp", "Fallback standing charge", "Window & fallbacks", "£/day."),
  N("cheap_rate_gbp", "Cheap-rate cutoff", "Window & fallbacks", "£/kWh. Slots at or below this count as cheap in car-cost and counterfactual logic."),
];

export const OFFICIAL_FIELDS: FieldMeta[] = [
  { key: "import_cost", label: "Official import cost", kind: "stat", group: "Official Octopus statistics", hint: "Recorder statistic id (octopus_energy:…), not a live entity." },
  { key: "import_cost_peak", label: "Official import cost (peak)", kind: "stat", group: "Official Octopus statistics" },
  { key: "import_cost_off_peak", label: "Official import cost (off-peak)", kind: "stat", group: "Official Octopus statistics" },
  { key: "import_kwh", label: "Official import energy", kind: "stat", group: "Official Octopus statistics" },
  { key: "import_kwh_peak", label: "Official import energy (peak)", kind: "stat", group: "Official Octopus statistics" },
  { key: "import_kwh_off_peak", label: "Official import energy (off-peak)", kind: "stat", group: "Official Octopus statistics" },
  { key: "export_cost", label: "Official export earnings", kind: "stat", group: "Official Octopus statistics" },
  { key: "export_kwh", label: "Official export energy", kind: "stat", group: "Official Octopus statistics" },
];


const P = (key: string, label: string, group: string, optional = true, extra: Partial<FieldMeta> = {}): FieldMeta =>
  E(key, label, group, { optional, ...extra });

export const PREDBAT_FIELDS: FieldMeta[] = [
  P("status", "Status", "Control", false),
  P("mode", "Mode", "Control", false, { domains: ["select"] }),
  P("set_read_only", "Read-only switch", "Control", false, { domains: ["switch"] }),
  P("best_soc_keep", "Best SoC keep", "Control", false, { domains: ["input_number"], units: ["%"] }),
  P("set_reserve_min", "Reserve min", "Control", true, { domains: ["input_number"] }),
  P("manual_charge", "Manual charge", "Control", true, { domains: ["select"] }),
  P("manual_export", "Manual export", "Control", true, { domains: ["select"] }),
  P("manual_freeze_charge", "Manual freeze charge", "Control", true, { domains: ["select"] }),
  P("manual_freeze_export", "Manual freeze export", "Control", true, { domains: ["select"] }),
  P("car_charging_plan_time", "Car ready time", "Control", false, { domains: ["select"], hint: "Shared Predbat ready-by time for all cars." }),
  P("plan_html", "Plan HTML", "Plan", false),
  P("rates", "Import rates series", "Plan", false),
  P("rates_export", "Export rates series", "Plan", false),
  P("soc_kw_h0", "SoC now (kWh)", "Plan", false),
  P("soc_kw_best", "SoC plan series", "Plan", false),
  P("soc_kw", "SoC series", "Plan"),
  P("soc_kw_best_h1", "SoC plan +1h", "Plan"),
  P("soc_kw_best_h8", "SoC plan +8h", "Plan"),
  P("soc_kw_best_h12", "SoC plan +12h", "Plan"),
  P("best_soc_min_kwh", "Best SoC min", "Plan"),
  P("best_battery_hours_left", "Hours of battery left", "Plan"),
  P("best_charge_limit", "Charge limit series", "Plan"),
  P("best_charge_limit_kw", "Charge limit (kW)", "Plan"),
  P("best_charge_start", "Next charge start", "Plan"),
  P("best_charge_end", "Next charge end", "Plan"),
  P("best_export_limit", "Export limit series", "Plan"),
  P("best_export_limit_kw", "Export limit (kW)", "Plan"),
  P("best_export_start", "Next export start", "Plan"),
  P("best_export_end", "Next export end", "Plan"),
  P("soc_max_calculated", "Calculated SoC max", "Plan", true, { domains: ["sensor"] }),
  P("inverter_config", "Inverter config", "Plan", true, { domains: ["sensor"] }),
  P("version", "Predbat version", "Plan", true, { domains: ["update"] }),
  P("cost_today", "Cost today", "Costs", false),
  P("cost_today_import", "Cost today (import)", "Costs"),
  P("cost_today_export", "Cost today (export)", "Costs"),
  P("cost_yesterday", "Cost yesterday", "Costs"),
  P("savings_yesterday_predbat", "Savings yesterday (Predbat)", "Costs", false),
  P("savings_yesterday_pvbat", "Savings yesterday (PV+battery)", "Costs"),
  P("savings_total_predbat", "Savings total", "Costs"),
  P("best_metric", "Best metric (predicted day)", "Costs", false),
  P("import_energy_h0", "Import energy today", "Energy"),
  P("export_energy_h0", "Export energy today", "Energy"),
  P("pv_energy_h0", "PV energy today", "Energy"),
  P("load_energy_h0", "Load energy today", "Energy"),
  P("import_energy", "Import energy series", "Energy"),
  P("export_energy", "Export energy series", "Energy"),
  P("best_import_energy", "Best import energy", "Energy"),
  P("best_export_energy", "Best export energy", "Energy"),
  P("best_pv_energy", "Best PV energy", "Energy"),
  P("best_load_energy", "Best load energy", "Energy"),
  P("best_import_energy_battery", "Best import to battery", "Energy"),
  P("best_import_energy_house", "Best import to house", "Energy"),
  P("battery_cycle", "Battery cycle", "Energy"),
  P("battery_cycle_best", "Battery cycle (plan)", "Energy"),
  P("pv_power", "PV power", "Forecast"),
  P("pv_power_best", "PV power (plan)", "Forecast"),
  P("pv_today", "PV forecast today", "Forecast", false, { domains: ["sensor"] }),
  P("pv_tomorrow", "PV forecast tomorrow", "Forecast", true, { domains: ["sensor"] }),
  P("pv_d2", "PV forecast +2 days", "Forecast", true, { domains: ["sensor"] }),
  P("pv_d3", "PV forecast +3 days", "Forecast", true, { domains: ["sensor"] }),
  P("pv_d4", "PV forecast +4 days", "Forecast", true, { domains: ["sensor"] }),
  P("pv_d5", "PV forecast +5 days", "Forecast", true, { domains: ["sensor"] }),
  P("pv_d6", "PV forecast +6 days", "Forecast", true, { domains: ["sensor"] }),
  P("pv_forecast_h0", "PV forecast now", "Forecast", true, { domains: ["sensor"] }),
  P("pv_forecast_h0_uncalibrated", "PV forecast now (uncalibrated)", "Forecast", true, { domains: ["sensor"] }),
  P("low_rate_start", "Low-rate start", "Slots"),
  P("low_rate_end", "Low-rate end", "Slots"),
  P("low_rate_cost", "Low-rate cost", "Slots"),
  P("low_rate_slot", "Low-rate slot", "Slots", true, { domains: ["binary_sensor"] }),
  P("high_rate_export_start", "High export start", "Slots"),
  P("high_rate_export_end", "High export end", "Slots"),
  P("high_rate_export_cost", "High export cost", "Slots"),
  P("high_rate_export_slot", "High export slot", "Slots", true, { domains: ["binary_sensor"] }),
  P("control_failures", "Control failures", "Slots"),
  P("control_failures_total", "Control failures total", "Slots"),
];

export const VEHICLE_FIELDS: FieldMeta[] = [
  { key: "name", label: "Name", kind: "string", group: "Vehicle" },
  { key: "kind", label: "Kind", kind: "select", group: "Vehicle", options: [
    { value: "tesla_iog", label: "Tesla on Intelligent Octopus Go" },
    { value: "kia", label: "Kia (or similar) with its own car SoC" },
    { value: "other", label: "Other" },
  ] },
  { key: "charger_id", label: "Linked charger", kind: "select", group: "Vehicle", optional: true, hint: "Assign a charger defined below. The charger's power is subtracted from house load. Its reported vehicle battery is never used as this car's SoC." },
  N("predbat_index", "Predbat car index", "Vehicle", "0 for the first Predbat car, 1 for the second, and so on.", true),
  N("idle_min", "Idle after (minutes)", "Vehicle", "When there is no connectivity sensor, the car is shown as idle after this many minutes without a fresh update."),
  E("soc", "State of charge", "Battery", { domains: ["sensor", "number"], units: ["%"], hint: "The car's own SoC only. Do not use a charger's reported vehicle battery — Ohme's is unreliable and Hearth will refuse to use it as SoC." }),
  E("soc_last_known", "SoC (last known)", "Last known", { domains: ["sensor"], units: ["%"], optional: true, hint: "Optional HA trigger-based last-known sensor. Hearth also keeps its own last-known cache." }),
  E("range", "Range", "Battery", { domains: ["sensor"], optional: true }),
  E("range_last_known", "Range (last known)", "Last known", { domains: ["sensor"], optional: true }),
  E("charge_limit", "Charge limit", "Charging", { domains: ["number", "sensor"], units: ["%"], optional: true, hint: "A percentage SoC target (e.g. number.kia_ac_charging_limit). A *charging_current_limit sensor is usually an amps cap, not a SoC limit — do not use it here." }),
  E("charge_limit_last_known", "Charge limit (last known)", "Last known", { domains: ["sensor", "number"], units: ["%"], optional: true }),
  E("plugged", "Plugged in", "Charging", { domains: ["binary_sensor"], optional: true }),
  E("charging", "Charging state", "Charging", { domains: ["sensor", "switch", "binary_sensor"], optional: true }),
  E("charging_power", "Car charging power (fallback)", "Charging", { domains: ["sensor"], units: ["kW", "W"], optional: true, hint: "Instantaneous; never held when the car goes unknown. Prefer the linked charger's power when present." }),
  E("charge_switch", "Charge switch", "Charging", { domains: ["switch"], optional: true, hint: "If set, Overview can turn this on or off (a predefined control role)." }),
  E("charge_rate", "Charge rate", "Charging", { domains: ["sensor", "number"], optional: true }),
  E("time_to_full", "Time to full", "Charging", { domains: ["sensor"], optional: true }),
  E("energy_added", "Energy added", "Charging", { domains: ["sensor"], optional: true }),
  E("charge_duration", "Estimated charge duration", "Charging", { domains: ["sensor"], optional: true }),
  E("boost", "Boost helper", "Charging", { domains: ["input_boolean"], optional: true }),
  E("status", "Connectivity / online", "Other", { domains: ["binary_sensor"], optional: true, hint: "On = the car is awake / online. Used to tell asleep from data-lost (Tesla Fleet)." }),
  E("as_of", "Last updated at", "Other", { domains: ["sensor"], optional: true }),
  E("last_scanned", "Last scanned at", "Other", { domains: ["sensor"], optional: true }),
  E("location", "Location (home / away only)", "Other", { domains: ["device_tracker"], optional: true, hint: "Hearth only keeps the home / not_home state. Coordinates never leave the server." }),
  E("odometer", "Odometer", "Other", { domains: ["sensor"], optional: true }),
  E("capacity", "Battery capacity", "Battery", { domains: ["sensor"], units: ["kWh"], optional: true }),
  E("economy", "Efficiency / economy", "Other", { domains: ["sensor"], optional: true }),
  E("predbat_slot", "Predbat charge slot", "Predbat", { domains: ["binary_sensor"], optional: true }),
  E("predbat_soc", "Predbat car SoC", "Predbat", { optional: true }),
  E("predbat_start", "Predbat charge start", "Predbat", { optional: true }),
  E("predbat_soc_best", "Predbat car SoC plan", "Predbat", { optional: true }),
  E("predbat_rate", "Predbat charge rate", "Predbat", { domains: ["input_number"], optional: true }),
  E("iog_dispatching", "IOG dispatching", "Intelligent Octopus", { domains: ["binary_sensor"], optional: true }),
  E("iog_state", "IOG state", "Intelligent Octopus", { domains: ["sensor"], optional: true }),
  E("iog_soc", "IOG state of charge", "Intelligent Octopus", { domains: ["sensor"], units: ["%"], optional: true }),
  E("iog_charge_target", "IOG charge target", "Intelligent Octopus", { domains: ["number"], units: ["%"], optional: true }),
  E("iog_target_time", "IOG target time", "Intelligent Octopus", { domains: ["select"], optional: true }),
  E("iog_smart_charge", "IOG smart charge", "Intelligent Octopus", { domains: ["switch"], optional: true }),
  E("iog_bump_charge", "IOG bump charge", "Intelligent Octopus", { domains: ["switch"], optional: true }),
];

export const CHARGER_FIELDS: FieldMeta[] = [
  { key: "name", label: "Name", kind: "string", group: "Charger" },
  { key: "kind", label: "Kind", kind: "select", group: "Charger", options: [
    { value: "ohme", label: "Ohme" },
    { value: "tesla", label: "Tesla / onboard" },
    { value: "other", label: "Other" },
  ] },
  E("status", "Status", "Charger", { domains: ["sensor"], optional: true }),
  E("power", "Power", "Charger", { domains: ["sensor"], units: ["kW", "W"], optional: true, hint: "Subtracted from house load in PowerPrint and the live flow." }),
  E("target", "Target percentage", "Charger", { domains: ["number"], units: ["%"], optional: true, hint: "The charger's own target. This is not automatically the Predbat / car charge limit." }),
  E("mode", "Charge mode", "Charger", { domains: ["select"], optional: true, hint: "If set, Overview can change the mode (a predefined control role)." }),
  E("energy", "Energy", "Charger", { domains: ["sensor"], optional: true }),
  E("slots", "Charge slots", "Charger", { domains: ["sensor"], optional: true }),
  E("target_time", "Target time", "Charger", { domains: ["time"], optional: true }),
  E("vehicle_battery", "Charger-reported vehicle battery", "Charger", { domains: ["sensor"], units: ["%"], optional: true, hint: "Display only. Hearth never uses this as the car's SoC (Ohme is unreliable)." }),
];


const LISTENERS = new Set<() => void>();
export function onVariablesApplied(fn: () => void) {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

let cache: Variables | null = null;
let applyHook: ((v: Variables) => void) | null = null;

/** Called from index once whitelist.applyAllowLists is available, avoiding a circular import at module load. */
export function setApplyHook(fn: (v: Variables) => void) {
  applyHook = fn;
  if (cache) fn(cache);
}

function notify(v: Variables) {
  applyHook?.(v);
  for (const fn of LISTENERS) {
    try { fn(); }
    catch (err) { console.error("onVariablesApplied listener failed:", (err as Error).message); }
  }
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeObj<T extends Record<string, unknown>>(def: T, saved: unknown): T {
  const out = { ...def };
  if (!isPlain(saved)) return out;
  for (const key of Object.keys(def) as (keyof T)[]) {
    const sv = saved[key as string];
    if (sv === undefined) continue;
    const dv = def[key];
    if (isPlain(dv) && isPlain(sv)) out[key] = mergeObj(dv as Record<string, unknown>, sv) as T[keyof T];
    else out[key] = sv as T[keyof T];
  }
  return out;
}

export function mergeVariables(saved: unknown): Variables {
  const d = defaultVariables();
  if (!isPlain(saved)) return d;
  const site = mergeObj(d.site as unknown as Record<string, unknown>, saved.site) as unknown as Site;
  const tariffRaw = isPlain(saved.tariff) ? saved.tariff : {};
  const official = mergeObj(d.tariff.official as unknown as Record<string, unknown>, tariffRaw.official) as unknown as OfficialStats;
  const tariff = mergeObj(d.tariff as unknown as Record<string, unknown>, { ...tariffRaw, official }) as unknown as Tariff;
  const predbat = mergeObj(d.predbat as unknown as Record<string, unknown>, saved.predbat) as unknown as Predbat;

  const defV = new Map(d.vehicles.map((v) => [v.id, v]));
  const vehicles: Vehicle[] = Array.isArray(saved.vehicles)
    ? saved.vehicles.map((row, i) => {
        const rec = isPlain(row) ? row : {};
        const id = typeof rec.id === "string" && rec.id ? rec.id : `car_${i + 1}`;
        const base = defV.get(id) || emptyVehicle(id, typeof rec.name === "string" ? rec.name : "Vehicle");
        return mergeObj(base as unknown as Record<string, unknown>, { ...rec, id }) as unknown as Vehicle;
      })
    : d.vehicles;

  const defC = new Map(d.chargers.map((c) => [c.id, c]));
  const chargers: Charger[] = Array.isArray(saved.chargers)
    ? saved.chargers.map((row, i) => {
        const rec = isPlain(row) ? row : {};
        const id = typeof rec.id === "string" && rec.id ? rec.id : `charger_${i + 1}`;
        const base = defC.get(id) || emptyCharger(id, typeof rec.name === "string" ? rec.name : "Charger");
        return mergeObj(base as unknown as Record<string, unknown>, { ...rec, id }) as unknown as Charger;
      })
    : d.chargers;

  const extra = Array.isArray(saved.extra_subscribe)
    ? saved.extra_subscribe.filter((x): x is string => typeof x === "string")
    : d.extra_subscribe;

  return {
    version: 1,
    updated_at: typeof saved.updated_at === "string" ? saved.updated_at : null,
    site, tariff, predbat, vehicles, chargers, extra_subscribe: extra,
  };
}

export function collectEntityIds(v: Variables): string[] {
  const out = new Set<string>();
  const add = (s: unknown) => { if (typeof s === "string" && ENTITY_RE.test(s)) out.add(s); };
  const walk = (o: unknown) => {
    if (typeof o === "string") return add(o);
    if (Array.isArray(o)) return o.forEach(walk);
    if (isPlain(o)) {
      for (const [k, val] of Object.entries(o)) {
        if (k === "official" || k === "import_prefix" || k === "export_prefix") continue;
        walk(val);
      }
    }
  };
  walk(v.site);
  walk({ ...v.tariff, official: undefined });
  walk(v.predbat);
  v.vehicles.forEach(walk);
  v.chargers.forEach(walk);
  v.extra_subscribe.forEach(add);
  return [...out].sort();
}

export function collectStatIds(v: Variables): string[] {
  return Object.values(v.tariff.official).filter((s) => typeof s === "string" && STAT_RE.test(s));
}

/** Chargers' vehicle_battery values — never valid as a car SoC. */
export function chargerSocIds(v: Variables): Set<string> {
  const s = new Set<string>();
  for (const c of v.chargers) if (c.vehicle_battery) s.add(c.vehicle_battery);
  return s;
}

export function chargerPowerIds(v: Variables): string[] {
  return v.chargers.map((c) => c.power).filter((x): x is string => !!x);
}

export function vehicleById(v: Variables, id: string): Vehicle | undefined {
  return v.vehicles.find((c) => c.id === id);
}

/** First Tesla / Intelligent Octopus Go vehicle (id tesla, car_1, or kind tesla_iog). */
export function teslaLike(v: Variables = getVariables()): Vehicle | undefined {
  return v.vehicles.find((x) => x.id === "tesla" || x.id === "car_1" || x.kind === "tesla_iog");
}

/** First Kia / second car (id ev9, car_2, or kind kia), otherwise the first vehicle that is not teslaLike. */
export function kiaLike(v: Variables = getVariables()): Vehicle | undefined {
  const t = teslaLike(v);
  return v.vehicles.find((x) => x.id === "ev9" || x.id === "car_2" || x.kind === "kia")
    || v.vehicles.find((x) => x.id !== t?.id);
}

export function chargerById(v: Variables, id: string | null | undefined): Charger | undefined {
  if (!id) return undefined;
  return v.chargers.find((c) => c.id === id);
}

/** Power used for energy/cost: linked charger power, else the car's own charging_power. Never charger vehicle_battery. */
export function vehiclePowerId(v: Variables, car: Vehicle): string | null {
  const ch = chargerById(v, car.charger_id);
  return ch?.power || car.charging_power || null;
}

/** Instantaneous fallback (not held). */
export function vehiclePowerFallback(v: Variables, car: Vehicle): string | undefined {
  const ch = chargerById(v, car.charger_id);
  if (ch?.power && car.charging_power && car.charging_power !== ch.power) return car.charging_power;
  return undefined;
}

export function teslaVehicle(v: Variables): Vehicle | undefined {
  return v.vehicles.find((c) => c.id === "tesla") || v.vehicles.find((c) => c.kind === "tesla_iog");
}

export function ev9Vehicle(v: Variables): Vehicle | undefined {
  return v.vehicles.find((c) => c.id === "ev9") || v.vehicles.find((c) => c.kind === "kia");
}

export function iogDispatchId(v: Variables): string | null {
  return teslaVehicle(v)?.iog_dispatching || null;
}

export function parseHhMm(s: string): number | null {
  if (!HHMM.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function isOffPeakMins(mins: number, start = "23:30", end = "05:30"): boolean {
  const a = parseHhMm(start);
  const b = parseHhMm(end);
  if (a == null || b == null || a === b) return false;
  if (a < b) return mins >= a && mins < b;
  return mins >= a || mins < b;
}

export type ValidationIssue = { path: string; message: string; level: "error" | "warning" };

function domainOf(id: string) {
  return id.split(".")[0] || "";
}

function checkEntity(
  path: string,
  id: string | null | undefined,
  meta: FieldMeta | undefined,
  catalogue: Map<string, EntityHint> | null,
  issues: ValidationIssue[],
  optional: boolean,
) {
  if (id == null || id === "") {
    if (!optional) issues.push({ path, message: "This field is required.", level: "error" });
    return;
  }
  if (!ENTITY_RE.test(id)) {
    issues.push({ path, message: `"${id}" is not a valid entity id (domain.object_id).`, level: "error" });
    return;
  }
  if (meta?.domains?.length && !meta.domains.includes(domainOf(id))) {
    issues.push({ path, message: `Expected a ${meta.domains.join(" / ")} entity, got ${domainOf(id)}.`, level: "error" });
  }
  if (catalogue) {
    const hint = catalogue.get(id);
    if (!hint) issues.push({ path, message: `${id} was not found in Home Assistant. You can still save, but Hearth will not have a live value until it appears.`, level: "warning" });
    else if (meta?.units?.length && hint.unit && !meta.units.some((u) => u.toLowerCase() === hint.unit!.toLowerCase())) {
      issues.push({ path, message: `${id} reports unit “${hint.unit}”, expected ${meta.units.join(" or ")}. Check this is the right sensor (for example amps vs %).`, level: "warning" });
    }
  }
}


export function validateVariables(v: Variables, catalogue?: EntityHint[] | null): { errors: string[]; warnings: string[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const cat = catalogue ? new Map(catalogue.map((e) => [e.entity_id, e])) : null;
  const bannedSoc = chargerSocIds(v);

  const ids = new Set<string>();
  for (const car of v.vehicles) {
    if (!car.id || !/^[a-z][a-z0-9_]{0,40}$/.test(car.id)) issues.push({ path: `vehicles.${car.id || "?"}.id`, message: "Vehicle id must be a short slug (letters, numbers, underscore).", level: "error" });
    if (ids.has(car.id)) issues.push({ path: `vehicles.${car.id}.id`, message: "Duplicate vehicle id.", level: "error" });
    ids.add(car.id);
    if (!car.name?.trim()) issues.push({ path: `vehicles.${car.id}.name`, message: "Name is required.", level: "error" });
    if (car.charger_id && !v.chargers.some((c) => c.id === car.charger_id)) {
      issues.push({ path: `vehicles.${car.id}.charger_id`, message: `No charger with id “${car.charger_id}”.`, level: "error" });
    }
    if (car.soc && bannedSoc.has(car.soc)) {
      issues.push({ path: `vehicles.${car.id}.soc`, message: `${car.soc} is a charger's reported vehicle battery. Hearth will not use this as the car's SoC (Ohme is unreliable). Use the car's own SoC sensor.`, level: "error" });
    }
    if (car.charge_limit && /charging_current_limit/.test(car.charge_limit)) {
      issues.push({ path: `vehicles.${car.id}.charge_limit`, message: `${car.charge_limit} looks like a current (amps) cap, not a SoC percentage limit.`, level: "warning" });
    }
    for (const meta of VEHICLE_FIELDS) {
      if (meta.kind !== "entity") continue;
      checkEntity(`vehicles.${car.id}.${meta.key}`, (car as unknown as Record<string, unknown>)[meta.key] as string | null, meta, cat, issues, !!meta.optional || meta.key !== "soc");
    }
    if (!car.soc) issues.push({ path: `vehicles.${car.id}.soc`, message: "State of charge is required.", level: "error" });
  }

  const cids = new Set<string>();
  for (const ch of v.chargers) {
    if (!ch.id || !/^[a-z][a-z0-9_]{0,40}$/.test(ch.id)) issues.push({ path: `chargers.${ch.id || "?"}.id`, message: "Charger id must be a short slug.", level: "error" });
    if (cids.has(ch.id)) issues.push({ path: `chargers.${ch.id}.id`, message: "Duplicate charger id.", level: "error" });
    cids.add(ch.id);
    if (!ch.name?.trim()) issues.push({ path: `chargers.${ch.id}.name`, message: "Name is required.", level: "error" });
    for (const meta of CHARGER_FIELDS) {
      if (meta.kind !== "entity") continue;
      checkEntity(`chargers.${ch.id}.${meta.key}`, (ch as unknown as Record<string, unknown>)[meta.key] as string | null, meta, cat, issues, true);
    }
  }

  for (const meta of SITE_FIELDS) {
    if (meta.kind === "entity") checkEntity(`site.${meta.key}`, (v.site as unknown as Record<string, unknown>)[meta.key] as string, meta, cat, issues, !!meta.optional);
    if (meta.kind === "number") {
      const n = (v.site as unknown as Record<string, unknown>)[meta.key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) issues.push({ path: `site.${meta.key}`, message: "Must be a number ≥ 0.", level: "error" });
    }
  }
  for (const meta of TARIFF_FIELDS) {
    if (meta.kind === "entity") checkEntity(`tariff.${meta.key}`, (v.tariff as unknown as Record<string, unknown>)[meta.key] as string, meta, cat, issues, !!meta.optional);
    if (meta.kind === "time") {
      const s = String((v.tariff as unknown as Record<string, unknown>)[meta.key] ?? "");
      if (!HHMM.test(s)) issues.push({ path: `tariff.${meta.key}`, message: "Use HH:MM (24-hour).", level: "error" });
    }
    if (meta.kind === "number") {
      const n = (v.tariff as unknown as Record<string, unknown>)[meta.key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) issues.push({ path: `tariff.${meta.key}`, message: "Must be a number ≥ 0.", level: "error" });
    }
  }
  for (const meta of OFFICIAL_FIELDS) {
    const s = (v.tariff.official as unknown as Record<string, unknown>)[meta.key];
    if (typeof s !== "string" || !STAT_RE.test(s)) issues.push({ path: `tariff.official.${meta.key}`, message: "Must be a recorder statistic id such as octopus_energy:electricity_….", level: "error" });
  }
  for (const meta of PREDBAT_FIELDS) {
    if (meta.kind === "entity") checkEntity(`predbat.${meta.key}`, (v.predbat as unknown as Record<string, unknown>)[meta.key] as string, meta, cat, issues, !!meta.optional);
  }
  for (const [i, id] of v.extra_subscribe.entries()) {
    if (id && !ENTITY_RE.test(id)) issues.push({ path: `extra_subscribe.${i}`, message: `"${id}" is not a valid entity id.`, level: "error" });
    else if (id && cat && !cat.has(id)) issues.push({ path: `extra_subscribe.${i}`, message: `${id} was not found in Home Assistant.`, level: "warning" });
  }

  const errors = issues.filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`);
  const warnings = issues.filter((i) => i.level === "warning").map((i) => `${i.path}: ${i.message}`);
  return { errors, warnings, issues };
}

export function deriveActions(v: Variables): ActionSpec[] {
  const out: ActionSpec[] = [];
  for (const car of v.vehicles) {
    if (car.boost) {
      for (const service of ["turn_on", "turn_off", "toggle"] as const) {
        out.push({ domain: "input_boolean", service, entityId: car.boost });
      }
    }
    if (car.charge_switch) {
      out.push({ domain: "switch", service: "turn_on", entityId: car.charge_switch });
      out.push({ domain: "switch", service: "turn_off", entityId: car.charge_switch });
    }
  }
  for (const ch of v.chargers) {
    if (ch.mode) {
      out.push({
        domain: "select",
        service: "select_option",
        entityId: ch.mode,
        optionFromEntity: true,
        allowedOptions: ch.kind === "ohme" ? ["smart_charge", "max_charge", "paused"] : undefined,
      });
    }
  }
  const p = v.predbat;
  out.push({
    domain: "select",
    service: "select_option",
    entityId: p.mode,
    optionFromEntity: true,
    allowedOptions: ["Monitor", "Control SOC only", "Control charge", "Control charge & discharge"],
  });
  out.push({ domain: "switch", service: "turn_on", entityId: p.set_read_only });
  out.push({ domain: "switch", service: "turn_off", entityId: p.set_read_only });
  out.push({ domain: "input_number", service: "set_value", entityId: p.best_soc_keep, numberRange: { min: 0, max: 100, step: 0.1 } });
  for (const id of [p.manual_charge, p.manual_export, p.manual_freeze_charge, p.manual_freeze_export]) {
    out.push({ domain: "select", service: "select_option", entityId: id, optionFromEntity: true });
  }
  return out;
}

function backupExisting() {
  const src = path.join(DATA_DIR, FILE);
  const dest = path.join(DATA_DIR, BAK);
  try {
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  } catch (err) {
    console.error("Could not write variables.json.bak:", (err as Error).message);
  }
}

export function getVariables(): Variables {
  if (cache) return cache;
  const saved = readJson<unknown>(FILE, null);
  cache = mergeVariables(saved);
  return cache;
}

export function publicVariables() {
  const v = getVariables();
  return {
    variables: v,
    data_writable: dataWritable(),
    schema: {
      site: SITE_FIELDS,
      tariff: TARIFF_FIELDS,
      official: OFFICIAL_FIELDS,
      predbat: PREDBAT_FIELDS,
      vehicle: VEHICLE_FIELDS,
      charger: CHARGER_FIELDS,
    },
  };
}

export function applyVariables(v: Variables) {
  cache = v;
  notify(v);
}

function persist(v: Variables): string[] {
  const errors: string[] = [];
  if (!dataWritable()) {
    errors.push("Variables could not be saved: data directory is not writable");
    return errors;
  }
  backupExisting();
  if (!writeJson(FILE, v)) errors.push("Variables could not be saved: write failed");
  return errors;
}

export function saveVariables(next: unknown, catalogue?: EntityHint[] | null): { ok: boolean; errors: string[]; warnings: string[]; issues: ValidationIssue[]; variables: Variables } {
  const v = mergeVariables(next);
  const { errors, warnings, issues } = validateVariables(v, catalogue);
  if (errors.length) return { ok: false, errors, warnings, issues, variables: getVariables() };
  v.updated_at = new Date().toISOString();
  const writeErr = persist(v);
  if (writeErr.length) return { ok: false, errors: writeErr, warnings, issues, variables: getVariables() };
  applyVariables(v);
  return { ok: true, errors: [], warnings, issues, variables: v };
}

export function resetVariables(catalogue?: EntityHint[] | null) {
  const v = defaultVariables();
  return saveVariables(v, catalogue);
}

export function slugId(name: string, used: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "item";
  if (!/^[a-z]/.test(base)) base = `v_${base}`;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  return id;
}

/** Drop the in-memory cache (tests). */
export function _resetCache() {
  cache = null;
}
