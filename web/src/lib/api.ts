export type HaEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
};

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

export type PlanData = {
  plan: {
    generated: string | null;
    mode: string | null;
    soc: number | null;
    soc_max: number | null;
    reserve: number | null;
    forecast_minutes: number | null;
    import_cost_threshold: number | null;
    export_cost_threshold: number | null;
    totals: Record<string, number | null>;
    rows: PlanRow[];
    windows: { type: "charge" | "export" | "freeze"; start: string; end: string; target?: string }[];
  } | null;
  predbat: {
    importRates: { t: string; v: number }[];
    exportRates: { t: string; v: number }[];
    socBest: { t: string; v: number }[];
    chargeLimit: { t: string; v: number }[];
    exportLimit: { t: string; v: number }[];
  };
  octopus: {
    import: { start: string; end: string; value: number }[];
    export: { start: string; end: string; value: number }[];
  };
};


export type FinancialsTotals = {
  import_cost_gbp: number | null;
  export_earnings_gbp: number | null;
  net_cost_gbp: number | null;
  import_kwh: number | null;
  export_kwh: number | null;
  standing_gbp: number | null;
  avg_import_p_kwh: number | null;
  avg_export_p_kwh: number | null;
  peak_kwh: number | null;
  peak_cost_gbp: number | null;
  offpeak_kwh: number | null;
  offpeak_cost_gbp: number | null;
  solar_kwh: number | null;
  load_kwh: number | null;
  self_consumption_kwh: number | null;
  self_consumption_value_gbp: number | null;
  predbat_savings_gbp: number | null;
  days_with_import: number;
  days_with_export: number;
  import_source: "metered" | "estimated" | "mixed";
  export_source: "metered" | "estimated" | "mixed";
};

export type FinancialsDay = {
  date: string;
  import_kwh: number | null;
  import_cost_gbp: number | null;
  export_kwh: number | null;
  export_earnings_gbp: number | null;
  net_cost_gbp: number | null;
  standing_gbp: number | null;
  peak_kwh: number | null;
  peak_cost_gbp: number | null;
  offpeak_kwh: number | null;
  offpeak_cost_gbp: number | null;
  solar_kwh: number | null;
  load_kwh: number | null;
  self_consumption_kwh: number | null;
  self_consumption_value_gbp: number | null;
  predbat_savings_gbp: number | null;
  import_source: "metered" | "estimated" | "mixed";
  export_source: "metered" | "estimated" | "mixed";
};

export type FinancialsData = {
  days: number;
  period: { key: PeriodKey; label: string; start: string; end: string; days: number; includes_today: boolean };
  coverage: Coverage;
  previous_coverage: Coverage;
  timezone: string;
  generated: string;
  window: { start: string; end: string; inclusive: string };
  previous_window: { start: string; end: string };
  current: FinancialsTotals;
  previous: FinancialsTotals;
  deltas: Record<string, number | null>;
  daily: FinancialsDay[];
  analysis: string[];
  sources: Record<string, string>;
  tariffs: {
    import_peak_p: number;
    import_offpeak_p: number;
    offpeak_hours: string;
    standing_gbp: number;
    export: string;
  };
  gaps: string[];
};

export function deviceName(): string {
  let d = localStorage.getItem("hearth-device");
  if (!d) {
    const ua = navigator.userAgent;
    d = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Browser";
    localStorage.setItem("hearth-device", d);
  }
  return d;
}

export function setDeviceName(name: string) {
  localStorage.setItem("hearth-device", name.slice(0, 60));
}

function headers(extra: Record<string, string> = {}) {
  return { "X-Hearth-Device": deviceName(), ...extra };
}

export async function sendJson<T>(url: string, method: string, body: unknown = {}): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json as { error?: string }).error || `${r.status} ${url}`);
  return json as T;
}
export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  return sendJson<T>(url, "POST", body);
}
export async function putJson<T>(url: string, body: unknown = {}): Promise<T> {
  return sendJson<T>(url, "PUT", body);
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `${r.status} ${url}`);
  }
  return r.json() as Promise<T>;
}

export function fetchState() {
  return getJson<{ connected: boolean; entities: Record<string, HaEntity> }>("/api/state");
}

export function fetchPlan() {
  return getJson<PlanData>("/api/plan");
}

export type PlanSlotState = "charge" | "export" | "hold" | "discharge" | "idle";
export type PlanSlot = {
  start: string;
  end: string;
  day: string;
  state: PlanSlotState;
  predbat_state: string;
  target_pct: number | null;
  import_p: number | null;
  export_p: number | null;
  band: "cheap" | "mid" | "peak";
  soc_pct: number | null;
  soc_end_pct: number | null;
  battery_kwh: number | null;
  pv_kwh: number | null;
  load_kwh: number | null;
  car_kwh: number | null;
  cars: { tesla: number | null; ev9: number | null; iog: boolean };
  cost_gbp: number | null;
  total_gbp: number | null;
  is_now: boolean;
  past: boolean;
};
export type PlanWindow = { start: string; end: string; slots: number };
export type PlanCarSummary = {
  name: string;
  slots: { start: string; end: string; kwh: number | null; cost_p: number | null; rate_p: number | null }[];
  planned_kwh: number | null;
  planned_cost_p: number | null;
  soc_now: number | null;
  soc_morning: number | null;
  iog_planned?: { start: string; end: string; kwh: number | null; source: string | null }[];
};
export type PlanViewData = {
  generated: string | null;
  now: string;
  mode: string | null;
  soc_max_kwh: number | null;
  reserve_pct: number | null;
  thresholds: { cheap_import_p: number; peak_import_p: number };
  slots: PlanSlot[];
  summary: {
    today: { date: string; actual_gbp: number | null; predicted_gbp: number | null; plan_total_gbp: number | null };
    tomorrow: { date: string; until: string; cost_gbp: number; complete: boolean } | null;
    horizon_end: string | null;
    battery_empty: { at: string; reserve_pct: number | null; refill_at: string | null } | null;
    soc_now_pct: number | null;
    overnight_charge: { start: string; end: string; windows: PlanWindow[]; grid_kwh: number; target_pct: number | null; avg_rate_p: number | null } | null;
    charge_windows: PlanWindow[];
    export_windows: PlanWindow[];
    cheapest_import: { rate_p: number; windows: PlanWindow[] } | null;
    pv_kwh: number;
    load_kwh: number;
    cars: { tesla?: PlanCarSummary | null; ev9?: PlanCarSummary | null };
  };
  sources: string[];
};

export function fetchPlanView() {
  return getJson<PlanViewData>("/api/planview");
}

export type PPFeatures = { duration_min: number; kwh: number; peak_kw: number; plateau_kw: number; spikes: number; duty: number; start_min: number; baseline_kw: number; car_overlap: number };
export type PPStatus = "new" | "confirmed" | "auto" | "unsure" | "not_appliance";
export type PPEvent = {
  id: string;
  start: number;
  end: number;
  features: PPFeatures;
  profile: number[];
  series: number[];
  cost_gbp: number;
  peak_kwh: number;
  open: boolean;
  layer?: "single" | "base" | "top";
  peak_min?: number;
  cost_effective_gbp?: number;
  actual_gbp?: number;
  sources?: PPSources;
  status: PPStatus;
  labels: string[];
  labelled_at?: string;
  suggestion?: { key: string; labels: string[]; confidence: number; n: number; why: string; source: "learned" | "hint" } | null;
};
export type PPSources = { solar_kwh: number; battery_kwh: number; grid_kwh: number; grid_peak_kwh?: number; cost_actual_gbp?: number; solar_forgone_gbp?: number; battery_rate_p?: number | null; method?: "power" | "none" };
export type PPCosts = { kwh: number; cost_gbp: number; actual_gbp: number; saving_gbp: number; solar_forgone_gbp: number; sources: PPSources };
export type PPStat = PPCosts & { id: string; name: string; color?: string; icon?: string; today_gbp: number; today_actual_gbp: number; today_runs: number; avg_actual_gbp: number | null; runs: number; kwh: number; cost_gbp: number; avg_cost_gbp: number | null; typical_start_min: number | null; peak_share: number | null; confirmed: number };
export type PPAppliance = { id: string; name: string; color?: string; icon?: string; rate_override_p?: number | null; shiftable?: boolean };
export type PPNudge = { appliance: string; name: string; runs_at_peak: number; runs: number; peak_hours: number; peak_kwh: number; saving_gbp: number; text: string };
export type PowerPrintData = {
  appliances: PPAppliance[];
  nudges: PPNudge[];
  options: { colors: string[]; icons: string[] };
  events: PPEvent[];
  inbox: number;
  inbox_total: number;
  stats: PPStat[];
  month: string;
  last_run: string | null;
  last_error: string | null;
  settings: { auto_confidence: number; auto_min_confirmations: number; window_hours: number; threshold_kw: number; min_on_min: number; merge_gap_min: number };
};
export const fetchPowerPrint = (days = 30) => getJson<PowerPrintData>(`/api/powerprint?days=${days}`);
export const labelPowerPrint = (id: string, body: { labels?: string[]; other?: string; status: PPStatus }) => postJson<{ ok: boolean; error?: string }>(`/api/powerprint/events/${encodeURIComponent(id)}/label`, body);
export const manageAppliance = (body: Record<string, unknown>) => postJson<{ ok: boolean; error?: string }>("/api/powerprint/appliances", body);
export type PPBreakdown = { start: string; end: string; appliances: (PPCosts & { id: string; name: string; color: string; runs: number })[]; total: PPCosts; unlabelled: PPCosts & { runs: number }; data_from: string | null };
export const fetchPowerPrintBreakdown = (start: string, end: string) => getJson<PPBreakdown>(`/api/powerprint/breakdown?start=${start}&end=${end}`);
export const detectPowerPrint = () => postJson<{ ok: boolean }>("/api/powerprint/detect");

export function fetchStats() {
  return getJson<Record<string, unknown>>("/api/stats");
}

export type PeriodKey = "1d" | "4d" | "14d" | "30d" | "6m" | "12m" | "custom";
export type PeriodSel = { key: PeriodKey; start?: string; end?: string };
export type Coverage = {
  requested_start: string;
  requested_end: string;
  requested_days: number;
  data_from: string | null;
  data_to: string | null;
  days_with_data: number;
  partial: boolean;
  note: string | null;
};
export function periodQuery(p: PeriodSel): string {
  const q = new URLSearchParams({ period: p.key });
  if (p.key === "custom" && p.start && p.end) {
    q.set("start", p.start);
    q.set("end", p.end);
  }
  return q.toString();
}
export function fetchFinancials(p: PeriodSel) {
  return getJson<FinancialsData>(`/api/financials?${periodQuery(p)}`);
}

export function fetchHistory(entityIds: string[], start: string, end: string) {
  const q = new URLSearchParams({ entity_ids: entityIds.join(","), start, end });
  return getJson<{ series: { entity_id: string; points: { t: string; v: number | string }[] }[] }>(
    `/api/history?${q.toString()}`,
  );
}

export async function postAction(payload: {
  domain: string;
  service: string;
  entity_id: string;
  option?: string;
  value?: number;
  dry_run?: boolean;
}) {
  // Only ever called from a ConfirmDialog's confirm handler; the server rejects unconfirmed calls.
  return postJson<{ ok: boolean; dry_run: boolean }>("/api/action", { ...payload, confirmed: true });
}

export function subscribeEvents(onEvent: (ev: { type: string; entities?: Record<string, HaEntity>; variables?: VariablesConfig } & Partial<AlertsData>) => void) {
  const es = new EventSource("/api/events");
  const handler = (type: string) => (e: MessageEvent) => {
    try {
      onEvent({ type, ...(JSON.parse(e.data) as object) });
    } catch {
      /* ignore */
    }
  };
  es.addEventListener("snapshot", handler("snapshot"));
  es.addEventListener("state", handler("state"));
  es.addEventListener("connected", handler("connected"));
  es.addEventListener("disconnected", handler("disconnected"));
  es.addEventListener("alerts", handler("alerts"));
  es.addEventListener("variables", handler("variables"));
  es.onerror = () => {
    /* EventSource retries itself */
  };
  return () => es.close();
}

// ---------- v3 types ----------
export type PlannedSlot = { start: string; end: string; kwh: number | null; cost_p: number | null; rate_p: number | null };
export type CarPlan = {
  car: string;
  name: string;
  slot_active: boolean;
  slots: PlannedSlot[];
  planned_kwh: number | null;
  planned_cost_p: number | null;
  avg_rate_p: number | null;
  next_start: string | null;
  soc_now: number | null;
  soc_predbat_now: number | null;
  soc_morning: number | null;
  morning_at: string;
};
export type Dispatch = { start: string; end: string; kwh: number | null; source: string | null };
export type CarNight = {
  car: string;
  name: string;
  plan_recorded: boolean;
  planned_slots: PlannedSlot[];
  planned_kwh: number | null;
  planned_cost_p: number | null;
  planned_morning_soc: number | null;
  actual_kwh: number;
  actual_cost_gbp: number;
  actual_cheap_share: number | null;
  actual_first_on: string | null;
  actual_last_on: string | null;
  energy_source: string;
  soc_start: number | null;
  soc_end: number | null;
  soc_gain_kwh: number | null;
};
export type CarsData = {
  plan: { tesla?: CarPlan | null; ev9?: CarPlan | null; vehicles?: Record<string, CarPlan> };
  iog: { active: boolean; planned: Dispatch[]; completed: Dispatch[] };
  last_night: { window: { date: string; start: string; end: string; complete: boolean; plan_at: string }; tesla?: CarNight | null; ev9?: CarNight | null; vehicles?: Record<string, CarNight> };
};
export type PwWindow = { type: "charge" | "export" | "freeze"; start: string; end: string; target?: string; import_rate_p: number | null; export_rate_p: number | null };
export type TonightData = {
  generated: string;
  until: string;
  powerwall: {
    soc_now: number | null;
    soc_morning: number | null;
    soc_min: number | null;
    soc_min_at: string | null;
    windows: PwWindow[];
    charge_kwh: number;
    charge_cost_p: number;
    export_kwh: number;
    export_earn_p: number;
    plan_generated: string | null;
  } | null;
  tesla?: (CarPlan & { iog_planned: Dispatch[]; iog_extra: Dispatch[]; iog_active: boolean }) | null;
  ev9?: CarPlan | null;
  vehicles?: Record<string, CarPlan>;
};
export type CostPeriod = {
  label: string;
  start: string;
  end: string;
  tesla?: { kwh: number; cost_gbp: number; cheap_share: number | null; miles: number | null; p_per_mile: number | null } | null;
  ev9?: { kwh: number; cost_gbp: number; cheap_share: number | null; miles: number | null; p_per_mile: number | null; mi_per_kwh: number | null } | null;
  cars?: Record<string, { kwh: number; cost_gbp: number; cheap_share: number | null; miles: number | null; p_per_mile: number | null; mi_per_kwh?: number | null }>;
  total_gbp: number;
};
export type CarCosts = { generated: string; this_month: CostPeriod; last_month: CostPeriod; method: string[]; data_status?: Record<string, import("../components/CarData").CarDataStatus> };
export type SolarRow = { date: string; forecast_morning: number | null; forecast_final: number | null; actual: number | null; error_kwh: number | null; accuracy_pct: number | null; complete: boolean };
export type SolarData = {
  days: number;
  rows: SolarRow[];
  summary: { days_compared: number; forecast_kwh: number | null; actual_kwh: number | null; bias_pct: number | null; mean_abs_error_kwh: number | null; mean_accuracy_pct: number | null; wape_accuracy_pct: number | null };
  method: string;
};
export type RuleId = "planned_charge_missed" | "iog_extra_slot" | "pw_low" | "export_spike" | "car_data_lost" | "daily_cost" | "powerprint_confirm";
export type Alert = {
  id: string;
  key: string;
  rule: RuleId;
  severity: "info" | "warning";
  title: string;
  body: string;
  url: string;
  raised_at: string;
  updated_at: string;
  resolved_at?: string | null;
  acked_at?: string | null;
  notified?: { push?: { sent: number; failed: number } | null; telegram?: string | null; suppressed?: string | null };
};
export type AlertsData = { active: Alert[]; acked: Alert[]; history: Alert[]; last_run: string | null; last_error: string | null };
export type Thresholds = {
  export_spike_p: number;
  pw_low_pct: number;
  pw_morning_min_pct: number;
  charge_min_fraction: number;
  cooldown_min: number;
  max_per_hour: number;
  car_lost_min: number;
  daily_cost_gbp: number;
  daily_cost_step_gbp: number;
  quiet_hours: string;
};
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
export const fetchDayCost = () => getJson<DayCost>("/api/daycost");
export type SettingsData = {
  rules: Record<RuleId, boolean>;
  thresholds: Thresholds;
  webpush: { enabled: boolean; types: Record<RuleId, boolean> };
  telegram: { enabled: boolean; chat_id: string; types: Record<RuleId, boolean>; bot_token_set: boolean; bot_token_masked: string | null };
  updated_at: string | null;
  rule_labels: Record<RuleId, string>;
  data_writable: boolean;
};
export type AuditEntry = {
  at: string;
  kind: string;
  ok: boolean;
  dry_run?: boolean;
  summary: string;
  detail?: Record<string, unknown>;
  error?: string;
  who: { user: string | null; device: string | null; ip: string | null; ua: string | null };
};

export const fetchTonight = () => getJson<TonightData>("/api/tonight");
export const fetchCars = () => getJson<CarsData>("/api/cars");
export const fetchCarCosts = () => getJson<CarCosts>("/api/cars/costs");
export const fetchSolar = (days = 14) => getJson<SolarData>(`/api/solar?days=${days}`);
export const fetchAlerts = () => getJson<AlertsData & { enabled: boolean; rule_labels: Record<RuleId, string> }>("/api/alerts");
export const ackAlert = (id: string) => postJson(`/api/alerts/${encodeURIComponent(id)}/ack`);
export const fetchSettings = () => getJson<SettingsData>("/api/settings");
export const saveSettings = (patch: Record<string, unknown>) =>
  postJson<{ ok: boolean; changed: string[]; settings: SettingsData }>("/api/settings", { patch, confirmed: true });
export const fetchAudit = (limit = 200) => getJson<{ entries: AuditEntry[]; persisted: boolean }>(`/api/audit?limit=${limit}`);

export type CounterfactualData = {
  days: number;
  period: FinancialsData["period"];
  coverage: Coverage;
  tariff_days: { rate_stat: number; billed: number; default: number };
  calibrated_dispatch_kwh: number;
  window: { start: string; end: string; covered_until: string | null; elapsed_days: number; covered_days: number };
  counterfactual: {
    total_gbp: number; energy_gbp: number; standing_gbp: number; load_kwh: number; avg_rate_p: number | null;
    peak_kwh: number; offpeak_kwh: number; dispatch_kwh: number;
  };
  actual: { net_gbp: number; import_gbp: number; export_gbp: number; standing_gbp: number };
  saving: { gbp: number; pct: number | null };
  breakdown: {
    solar_self_consumption_gbp: number; solar_self_consumption_kwh: number;
    battery_time_shift_gbp: number; battery_to_home_kwh: number; battery_to_home_value_gbp: number;
    battery_grid_charge_kwh: number; battery_grid_charge_cost_gbp: number;
    export_income_gbp: number; other_gbp: number; import_model_gbp: number; import_metered_gbp: number;
  };
  projection: { per_day_gbp: number | null; per_month_gbp: number | null; per_year_gbp: number | null; based_on_days: number };
  daily: {
    date: string; load_kwh: number; pw_home_usage_kwh: number | null; counterfactual_gbp: number;
    actual_net_gbp: number | null; saving_gbp: number | null; import_kwh: number;
    import_model_gbp: number; import_metered_gbp: number | null; avg_cf_rate_p: number | null;
  }[];
  method: string[];
};
export const fetchCounterfactual = (p: PeriodSel) => getJson<CounterfactualData>(`/api/financials/counterfactual?${periodQuery(p)}`);


// ---------- variables ----------
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

export type SiteConfig = Record<string, string | number>;
export type TariffConfig = Record<string, string | number | OfficialStats> & { official: OfficialStats };
export type PredbatConfig = Record<string, string>;
export type ChargerKind = "ohme" | "tesla" | "other";
export type VehicleKind = "tesla_iog" | "kia" | "other";

export type ChargerConfig = {
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

export type VehicleConfig = {
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

export type VariablesConfig = {
  version: number;
  updated_at: string | null;
  site: SiteConfig;
  tariff: TariffConfig;
  predbat: PredbatConfig;
  vehicles: VehicleConfig[];
  chargers: ChargerConfig[];
  extra_subscribe: string[];
};

export type VariablesSchema = {
  site: FieldMeta[];
  tariff: FieldMeta[];
  official: FieldMeta[];
  predbat: FieldMeta[];
  vehicle: FieldMeta[];
  charger: FieldMeta[];
};

export type ValidationIssue = { path: string; message: string; level: "error" | "warning" };

export type VariablesResponse = {
  variables: VariablesConfig;
  schema: VariablesSchema;
  data_writable: boolean;
  ok?: boolean;
  warnings?: string[];
  issues?: ValidationIssue[];
  error?: string;
};

export type EntityHint = {
  entity_id: string;
  domain: string;
  friendly_name: string | null;
  state: string | null;
  unit: string | null;
  device_class: string | null;
};

export const fetchVariables = () => getJson<VariablesResponse>("/api/variables");
export const saveVariables = (variables: VariablesConfig) =>
  putJson<VariablesResponse>("/api/variables", { variables, confirmed: true });
export const importVariables = (payload: unknown) =>
  postJson<VariablesResponse>("/api/variables/import", { ...(typeof payload === "object" && payload ? payload : {}), confirmed: true });
export const resetVariables = () => postJson<VariablesResponse>("/api/variables/reset", { confirmed: true });
export const searchEntities = (q = "", domain = "", limit = 200) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (domain) p.set("domain", domain);
  p.set("limit", String(limit));
  return getJson<{ entities: EntityHint[]; connected: boolean }>(`/api/ha/entities?${p}`);
};
