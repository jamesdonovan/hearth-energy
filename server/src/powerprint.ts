/**
 * PowerPrint: detects appliance runs in the house load (Powerwall load minus both car chargers), stores them in
 * DATA_DIR/appliances.json, prices each run at the import rate in effect, and learns labels the user confirms.
 * Read-only towards Home Assistant (recorder statistics only).
 */
import type { HaClient, StatisticPoint } from "./ha.js";
import { readJson, writeJson } from "./storage.js";
import { iogDispatches } from "./cars.js";
import { londonDate, londonMinutes, isOffPeakMinute } from "./time.js";
import { DEFAULTS, attributeSources, batteryCostSeries, classify, detectRuns, hint, type DetectedRun, type Labelled, type Sample, type Suggestion } from "./powerprint-core.js";
import { chargerPowerIds, getVariables } from "./variables.js";

const FILE = "appliances.json";
function ppIds() {
  const v = getVariables();
  const { site: s, tariff: t } = v;
  const chargers = chargerPowerIds(v);
  return {
    load: s.pw_load_power,
    rate: t.import_rate,
    exportRate: t.export_current_rate,
    solar: s.pw_solar_power,
    batt: s.pw_batt_power,
    grid: s.pw_grid_power,
    chargers,
    PEAK: t.peak_gbp,
    OFF: t.offpeak_gbp,
    capacity: s.pw_capacity_kwh,
    detect: {
      thresholdKw: s.pp_threshold_kw,
      tailKw: s.pp_tail_kw,
      minOnMin: s.pp_min_on_min,
      mergeGapMin: s.pp_merge_gap_min,
      minKwh: s.pp_min_kwh,
    },
  };
}
const WINDOW_H = 48;
const BACKFILL_D = 10; // HA keeps 5-minute statistics for ~10 days
const PAD_MS = 3 * 3600e3; // baseline context either side
const AUTO_CONF = 0.8;
const AUTO_MIN_N = 3;

export type EventStatus = "new" | "confirmed" | "auto" | "unsure" | "not_appliance";
export type Appliance = { id: string; name: string; created: string; color?: string; icon?: string; rate_override_p?: number | null; shiftable?: boolean };
export const PP_COLORS = ["#c4b5fd", "#22d3ee", "#f0b429", "#3ddc97", "#f07167", "#5b9cff", "#f472b6", "#a3e635", "#fb923c", "#94a3b8"];
export const PP_ICONS = ["washing-machine", "utensils", "wind", "heater", "bath", "plug", "zap", "flame", "fan", "refrigerator", "microwave", "car"];
const DEFAULT_LOOK: Record<string, { color: string; icon: string; shiftable: boolean }> = {
  "washing-machine": { color: "#5b9cff", icon: "washing-machine", shiftable: true },
  dishwasher: { color: "#22d3ee", icon: "utensils", shiftable: true },
  "tumble-dryer": { color: "#f0b429", icon: "wind", shiftable: true },
  "electric-heater": { color: "#f07167", icon: "heater", shiftable: false },
  "hot-tub": { color: "#c4b5fd", icon: "bath", shiftable: true },
};
export type StoredEvent = DetectedRun & {
  id: string;
  status: EventStatus;
  labels: string[];
  labelled_at?: string;
  suggestion?: (Suggestion & { source: "learned" | "hint"; labels: string[] }) | null;
  detected_at: string;
  notified_at?: string;
};
type Store = { version: 1; appliances: Appliance[]; events: StoredEvent[]; last_run: string | null; last_error: string | null; backfilled: boolean };

const DEFAULT_APPLIANCES = ["Washing Machine", "Dishwasher", "Tumble Dryer", "Electric Heater", "Hot Tub"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "appliance";

let store: Store | null = null;
function load(): Store {
  if (store) return store;
  const s = readJson<Store | null>(FILE, null);
  store = s && s.version === 1 ? s : { version: 1, appliances: DEFAULT_APPLIANCES.map((n) => ({ id: slug(n), name: n, created: new Date().toISOString() })), events: [], last_run: null, last_error: null, backfilled: false };
  store.appliances.forEach((a, i) => {
    const d = DEFAULT_LOOK[a.id];
    a.color ||= d?.color ?? PP_COLORS[i % PP_COLORS.length];
    a.icon ||= d?.icon ?? "plug";
    if (a.shiftable == null) a.shiftable = d?.shiftable ?? true;
    if (a.rate_override_p === undefined) a.rate_override_p = null;
  });
  return store;
}
function save() {
  if (store) writeJson(FILE, store);
}

function byStart(stats: StatisticPoint[] | undefined) {
  const m = new Map<number, StatisticPoint>();
  for (const p of stats || []) m.set(p.start, p);
  return m;
}

async function fetchSamples(ha: HaClient, from: number, to: number): Promise<Sample[]> {
  const IDS = ppIds();
  const statIds = [IDS.load, IDS.rate, IDS.exportRate, IDS.solar, IDS.batt, IDS.grid, ...IDS.chargers];
  const st = await ha.statisticsDuringPeriod(statIds, new Date(from).toISOString(), new Date(to).toISOString(), "5minute");
  const chargerMaps = IDS.chargers.map((id) => byStart(st[id]));
  const r = byStart(st[IDS.rate]);
  const xr = byStart(st[IDS.exportRate]);
  const so = byStart(st[IDS.solar]);
  const ba = byStart(st[IDS.batt]);
  const gr = byStart(st[IDS.grid]);
  const m = (mp: Map<number, StatisticPoint>, t: number) => {
    const v = mp.get(t)?.mean;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return (st[IDS.load] || [])
    .filter((p) => p.mean != null)
    .map((p) => {
      const car = chargerMaps.reduce((s, mp) => s + (mp.get(p.start)?.mean ?? 0), 0);
      const mean = p.mean as number;
      const max = (p.max ?? mean) as number;
      return {
        t: p.start,
        kw: Math.max(0, mean - car),
        max: Math.max(0, max - car),
        car,
        rate: (r.get(p.start)?.mean as number | null | undefined) ?? null,
        exportRate: m(xr, p.start),
        solar: m(so, p.start),
        batt: m(ba, p.start),
        grid: m(gr, p.start),
        load: mean,
      };
    });
}

function training(s: Store): Labelled[] {
  return s.events.filter((e) => e.status === "confirmed" && e.labels.length).map((e) => ({ key: [...e.labels].sort().join("+"), features: e.features, profile: e.profile }));
}

function suggest(s: Store, e: StoredEvent, train: Labelled[]) {
  const c = classify(e.features, e.profile, train);
  if (c && c.confidence >= 0.5) return { ...c, source: "learned" as const, labels: c.key.split("+") };
  const h = hint(e.features);
  const a = h && s.appliances.find((x) => x.name.toLowerCase() === h.name.toLowerCase());
  return a ? { key: a.id, labels: [a.id], confidence: 0.3, distance: 0, n: 0, why: `rule of thumb: ${h!.why}`, source: "hint" as const } : null;
}

function refreshSuggestions(s: Store) {
  const train = training(s);
  for (const e of s.events) {
    if (e.status !== "new" && e.status !== "auto") continue;
    const sug = suggest(s, e, train);
    e.suggestion = sug;
    const ok = sug && sug.source === "learned" && sug.confidence >= AUTO_CONF && sug.n >= AUTO_MIN_N && !e.open;
    if (e.status === "new" && ok) {
      e.status = "auto";
      e.labels = sug!.labels;
    } else if (e.status === "auto" && !ok) {
      e.status = "new";
      e.labels = [];
    } else if (e.status === "auto" && ok) e.labels = sug!.labels;
  }
}

function merge(s: Store, runs: DetectedRun[], windowFrom: number, windowTo: number) {
  const now = new Date().toISOString();
  const keep = s.events.filter((e) => e.end <= windowFrom || e.start >= windowTo || e.status !== "new");
  const fresh: StoredEvent[] = [];
  const lk = (x: { layer?: string }) => (x.layer === "top" ? "top" : "main");
  for (const r of runs) {
    const over = keep.filter((e) => e.start < r.end && r.start < e.end && lk(e) === lk(r));
    const labelled = over.find((e) => e.status !== "new");
    if (labelled) {
      // a labelled run that was still open grows with the new data; otherwise the user's version stands
      if (labelled.open) Object.assign(labelled, { ...r, id: labelled.id, status: labelled.status, labels: labelled.labels, labelled_at: labelled.labelled_at });
      continue;
    }
    const prev = s.events.find((e) => e.status === "new" && e.start < r.end && r.start < e.end && lk(e) === lk(r) && !fresh.some((f) => f.id === e.id));
    const id = prev?.id ?? `ev-${r.start}${r.layer === "top" ? "-top" : ""}`;
    if (fresh.some((f) => f.id === id)) continue;
    fresh.push({ ...r, id, notified_at: prev?.notified_at, status: "new", labels: [], suggestion: null, detected_at: prev?.detected_at ?? now });
  }
  const cutoff = Date.now() - 120 * 86400e3;
  s.events = [...keep, ...fresh].filter((e) => e.end > cutoff).sort((a, b) => a.start - b.start);
}

let running: Promise<void> | null = null;
let afterDetect: (() => Promise<void>) | null = null;
export function onDetected(fn: () => Promise<void>) {
  afterDetect = fn;
}
export function detectNow(ha: HaClient, hours = WINDOW_H): Promise<void> {
  if (running) return running;
  running = (async () => {
    const s = load();
    try {
      const { PEAK, OFF, detect, capacity } = ppIds();
      const to = Date.now();
      const backfill = !s.backfilled;
      const from = to - (backfill ? BACKFILL_D * 24 : hours) * 3600e3;
      const samples = await fetchSamples(ha, from - PAD_MS, to);
      const dispatch = [...iogDispatches(ha).completed, ...iogDispatches(ha).planned]
        .map((d) => [Date.parse(d.start), Date.parse(d.end)] as [number, number])
        .filter(([a, b]) => Number.isFinite(a) && b > a);
      const runs = detectRuns(samples, {
        ...DEFAULTS,
        ...detect,
        londonMinute: (t) => londonMinutes(t),
        rateFallback: (t) => (isOffPeakMinute(londonMinutes(t)) || dispatch.some(([a, b]) => t >= a && t < b) ? OFF : PEAK),
      }).filter((r) => r.start >= from);
      merge(s, runs, from, to);
      // runs stored before v10 (or re-detected without power data) get their sources from the same 5-minute data
      const missing = s.events.filter((e) => !e.sources || e.sources.method === "none");
      if (missing.length) {
        const oldest = Math.min(...missing.map((e) => e.start));
        const extra = oldest < from - PAD_MS ? await fetchSamples(ha, Math.max(oldest - 12 * 3600e3, to - 11 * 86400e3), to) : samples;
        const fb = (t: number) => (isOffPeakMinute(londonMinutes(t)) || dispatch.some(([a, b]) => t >= a && t < b) ? OFF : PEAK);
        const bc = batteryCostSeries(extra, fb, OFF, capacity);
        const idx = new Map(extra.map((x, i) => [x.t, i]));
        for (const e of missing) {
          const i0 = idx.get(e.start);
          if (i0 == null) continue;
          e.sources = attributeSources(extra, i0, e.series, bc, fb);
        }
      }
      refreshSuggestions(s);
      if (!backfill) {
        // a backfill would flood the chat; only runs detected by the regular pass are offered
      } else for (const e of s.events) e.notified_at ||= "backfill";
      s.backfilled = true;
      s.last_run = new Date().toISOString();
      s.last_error = null;
    } catch (err) {
      s.last_error = err instanceof Error ? err.message : String(err);
    } finally {
      save();
      running = null;
    }
    if (afterDetect) await afterDetect().catch((err) => console.error("powerprint notify:", (err as Error).message));
  })();
  return running;
}

let timer: NodeJS.Timeout | null = null;
export function startPowerPrint(ha: HaClient, everyMin = Number(process.env.POWERPRINT_INTERVAL_MIN || 5)) {
  if (timer) return;
  setTimeout(() => detectNow(ha).catch(() => {}), 20000);
  timer = setInterval(() => detectNow(ha).catch(() => {}), Math.max(2, everyMin) * 60000);
}

// ------------------------------------------------------------------ API helpers

export function labelEvent(id: string, body: { labels?: unknown; other?: unknown; status?: unknown }): { ok: boolean; error?: string; event?: StoredEvent; created?: Appliance } {
  const s = load();
  const e = s.events.find((x) => x.id === id);
  if (!e) return { ok: false, error: "event not found" };
  const status = String(body.status ?? "confirmed") as EventStatus;
  if (!["confirmed", "unsure", "not_appliance", "new"].includes(status)) return { ok: false, error: "bad status" };
  let labels = Array.isArray(body.labels) ? (body.labels as unknown[]).map(String) : [];
  let created: Appliance | undefined;
  const other = typeof body.other === "string" ? body.other.trim().slice(0, 40) : "";
  if (other) {
    const found = s.appliances.find((a) => a.name.toLowerCase() === other.toLowerCase());
    if (found) labels.push(found.id);
    else {
      let id = slug(other);
      while (s.appliances.some((a) => a.id === id)) id += "-2";
      created = { id, name: other, created: new Date().toISOString() };
      s.appliances.push(created);
      labels.push(id);
    }
  }
  labels = [...new Set(labels)].filter((l) => s.appliances.some((a) => a.id === l));
  if (status === "confirmed" && !labels.length) return { ok: false, error: "pick at least one appliance" };
  e.status = status;
  e.labels = status === "confirmed" ? labels : [];
  e.labelled_at = new Date().toISOString();
  refreshSuggestions(s);
  save();
  return { ok: true, event: e, created };
}

const peakP = () => ppIds().PEAK * 100;
const offP = () => ppIds().OFF * 100;

export type CostPart = { id: string; kwh: number; cost: number; actual: number; forgone: number; solar_kwh: number; battery_kwh: number; grid_kwh: number; grid_peak_kwh: number; peak_kwh: number; peak_min: number };

/**
 * Costs of an event split over its labels. `cost` = every kWh at the import rate in effect ("cost (electricity)");
 * `actual` = grid share at that rate + battery share at what the stored energy cost + solar free ("cost with energy shift").
 * An appliance with a rate override is priced at that flat rate for both.
 */
export function eventCosts(e: StoredEvent, apps: Appliance[]): CostPart[] {
  const labels = e.status === "confirmed" || e.status === "auto" ? e.labels : [];
  const peakMin = e.peak_min ?? (e.features.kwh > 0 ? Math.round((e.peak_kwh / e.features.kwh) * e.features.duration_min) : 0);
  const src = e.sources;
  const ids = labels.length ? labels : [""];
  const sh = 1 / ids.length;
  return ids.map((l) => {
    const ov = l ? apps.find((x) => x.id === l)?.rate_override_p : null;
    const kwh = e.features.kwh * sh;
    if (ov != null) {
      const c = (kwh * ov) / 100;
      return { id: l, kwh, cost: c, actual: c, forgone: 0, solar_kwh: 0, battery_kwh: 0, grid_kwh: kwh, grid_peak_kwh: 0, peak_kwh: 0, peak_min: peakMin };
    }
    return {
      id: l,
      kwh,
      cost: e.cost_gbp * sh,
      actual: (src && src.method === "power" ? src.cost_actual_gbp : e.cost_gbp) * sh,
      forgone: (src?.solar_forgone_gbp ?? 0) * sh,
      solar_kwh: (src?.solar_kwh ?? 0) * sh,
      battery_kwh: (src?.battery_kwh ?? 0) * sh,
      grid_kwh: (src ? src.grid_kwh : e.features.kwh) * sh,
      grid_peak_kwh: (src ? src.grid_peak_kwh : e.peak_kwh) * sh,
      peak_kwh: e.peak_kwh * sh,
      peak_min: peakMin,
    };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function sumParts(parts: CostPart[]) {
  const t = { kwh: 0, cost: 0, actual: 0, forgone: 0, solar_kwh: 0, battery_kwh: 0, grid_kwh: 0 };
  for (const c of parts) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += c[k];
  return {
    kwh: r2(t.kwh),
    cost_gbp: r2(t.cost),
    actual_gbp: r2(t.actual),
    saving_gbp: r2(t.cost - t.actual),
    solar_forgone_gbp: r2(t.forgone),
    sources: { solar_kwh: r2(t.solar_kwh), battery_kwh: r2(t.battery_kwh), grid_kwh: r2(t.grid_kwh) },
  };
}

export function manageAppliance(body: Record<string, unknown>): { ok: boolean; error?: string; summary?: string } {
  const s = load();
  const str = (v: unknown, n = 40) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const name = str(body.name);
  const id = String(body.id ?? "");
  const op = String(body.op ?? "");
  const find = (x: string) => s.appliances.find((a) => a.id === x);
  let summary = "";
  if (op === "add") {
    if (!name) return { ok: false, error: "name required" };
    if (s.appliances.some((a) => a.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "already exists" };
    let nid = slug(name);
    while (find(nid)) nid += "-2";
    s.appliances.push({ id: nid, name, created: new Date().toISOString(), color: PP_COLORS[s.appliances.length % PP_COLORS.length], icon: "plug", shiftable: true, rate_override_p: null });
    summary = `add ${name}`;
  } else if (op === "rename" || op === "update") {
    const a = find(id);
    if (!a) return { ok: false, error: "not found" };
    const ch: string[] = [];
    if ("name" in body) {
      if (!name) return { ok: false, error: "name required" };
      if (s.appliances.some((x) => x !== a && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "name already used" };
      if (a.name !== name) ch.push(`name ${a.name}→${name}`);
      a.name = name;
    }
    if ("color" in body) {
      const c = str(body.color, 9);
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return { ok: false, error: "colour must be #rrggbb" };
      a.color = c;
      ch.push("colour");
    }
    if ("icon" in body) {
      const ic = str(body.icon, 30);
      if (!PP_ICONS.includes(ic)) return { ok: false, error: "unknown icon" };
      a.icon = ic;
      ch.push("icon");
    }
    if ("shiftable" in body) {
      a.shiftable = Boolean(body.shiftable);
      ch.push(`shiftable ${a.shiftable}`);
    }
    if ("rate_override_p" in body) {
      const v = body.rate_override_p;
      if (v === null || v === "") a.rate_override_p = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 200) return { ok: false, error: "rate override must be 0–200 p/kWh or empty" };
        a.rate_override_p = Math.round(n * 100) / 100;
      }
      ch.push(`rate override ${a.rate_override_p ?? "off"}`);
    }
    summary = `update ${a.name}: ${ch.join(", ") || "no change"}`;
  } else if (op === "delete") {
    const a = find(id);
    if (!a) return { ok: false, error: "not found" };
    s.appliances = s.appliances.filter((x) => x.id !== id);
    for (const e of s.events) {
      if (!e.labels.includes(id)) continue;
      e.labels = e.labels.filter((l) => l !== id);
      if (!e.labels.length && (e.status === "confirmed" || e.status === "auto")) e.status = "new";
    }
    summary = `delete ${a.name}`;
  } else if (op === "merge") {
    const from = find(id);
    const into = find(String(body.into ?? ""));
    if (!from || !into || from === into) return { ok: false, error: "pick two different appliances" };
    for (const e of s.events) {
      if (!e.labels.includes(from.id)) continue;
      e.labels = [...new Set(e.labels.map((l) => (l === from.id ? into.id : l)))];
    }
    s.appliances = s.appliances.filter((x) => x.id !== from.id);
    summary = `merge ${from.name} into ${into.name}`;
  } else return { ok: false, error: "op must be add, update, delete or merge" };
  refreshSuggestions(s);
  save();
  return { ok: true, summary };
}

function nudges(s: Store, from: number) {
  const out: { appliance: string; name: string; runs_at_peak: number; runs: number; peak_hours: number; peak_kwh: number; grid_peak_kwh: number; saving_gbp: number; text: string }[] = [];
  for (const a of s.appliances) {
    if (a.shiftable === false || a.rate_override_p != null) continue;
    let runs = 0, atPeak = 0, pk = 0, gpk = 0, pm = 0;
    for (const e of s.events) {
      if (e.start < from || !(e.status === "confirmed" || e.status === "auto") || !e.labels.includes(a.id)) continue;
      runs++;
      const c = eventCosts(e, s.appliances).find((x) => x.id === a.id)!;
      if (c.peak_kwh > 0.05) {
        atPeak++;
        pk += c.peak_kwh;
        gpk += c.grid_peak_kwh;
        pm += c.peak_min;
      }
    }
    // Only the grid share bought at the peak rate costs real money; solar and battery shares were already cheap.
    const saving = (gpk * (peakP() - offP())) / 100;
    if (saving < 0.2) continue;
    const h = pm / 60;
    out.push({
      appliance: a.id,
      name: a.name,
      runs,
      runs_at_peak: atPeak,
      peak_hours: Math.round(h * 10) / 10,
      peak_kwh: r2(pk),
      grid_peak_kwh: r2(gpk),
      saving_gbp: r2(saving),
      text: `${a.name} ran ${h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(pm)} min`} in peak hours in the last 30 days (${atPeak} of ${runs} run${runs === 1 ? "" : "s"}); ${gpk.toFixed(1)} of its ${pk.toFixed(1)} kWh came from the grid at the peak rate, the rest from solar or the Powerwall. Running it in the 23:30–05:30 off-peak window would have saved about £${saving.toFixed(2)}.`,
    });
  }
  return out.sort((x, y) => y.saving_gbp - x.saving_gbp);
}

/** Per-appliance totals between two London dates (inclusive), for the Financials period. */
export function powerPrintBreakdown(startDate: string, endDate: string) {
  const s = load();
  const per = new Map<string, CostPart[]>();
  const runs = new Map<string, number>();
  const unl: CostPart[] = [];
  let earliest: number | null = null;
  for (const e of s.events) {
    earliest = earliest == null ? e.start : Math.min(earliest, e.start);
    const d = londonDate(e.start);
    if (d < startDate || d > endDate || e.status === "not_appliance") continue;
    for (const c of eventCosts(e, s.appliances)) {
      if (!c.id) {
        unl.push(c);
        continue;
      }
      per.set(c.id, [...(per.get(c.id) || []), c]);
      runs.set(c.id, (runs.get(c.id) || 0) + 1);
    }
  }
  const all = [...per.values()].flat();
  return {
    start: startDate,
    end: endDate,
    appliances: [...per.entries()]
      .map(([id, parts]) => {
        const a = s.appliances.find((x) => x.id === id);
        return { id, name: a?.name ?? id, color: a?.color ?? "#94a3b8", runs: runs.get(id) || 0, ...sumParts(parts) };
      })
      .sort((x, y) => y.cost_gbp - x.cost_gbp),
    total: sumParts(all),
    unlabelled: { runs: unl.length, ...sumParts(unl) },
    data_from: earliest != null ? londonDate(earliest) : null,
  };
}

export function powerPrintView(days = 30) {
  const s = load();
  const from = Date.now() - days * 86400e3;
  const events = s.events.filter((e) => e.end > from).sort((a, b) => b.start - a.start);
  const month = londonDate(new Date()).slice(0, 7);
  const today = londonDate(new Date());
  const stats = s.appliances.map((a) => {
    const runs = s.events.filter((e) => (e.status === "confirmed" || e.status === "auto") && e.labels.includes(a.id) && londonDate(e.start).slice(0, 7) === month);
    const parts = runs.map((e) => eventCosts(e, s.appliances).find((x) => x.id === a.id)!);
    const sum = sumParts(parts);
    const peak = parts.reduce((t, c) => t + c.peak_kwh, 0);
    const mins = runs.map((e) => e.features.start_min).sort((x, y) => x - y);
    const trained = s.events.filter((e) => e.status === "confirmed" && e.labels.includes(a.id)).length;
    const todayParts = runs.filter((e) => londonDate(e.start) === today).map((e) => eventCosts(e, s.appliances).find((x) => x.id === a.id)!);
    const td = sumParts(todayParts);
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      runs: runs.length,
      ...sum,
      avg_cost_gbp: runs.length ? r2(sum.cost_gbp / runs.length) : null,
      avg_actual_gbp: runs.length ? r2(sum.actual_gbp / runs.length) : null,
      typical_start_min: mins.length ? mins[Math.floor(mins.length / 2)] : null,
      peak_share: sum.kwh > 0 ? r2(peak / sum.kwh) : null,
      confirmed: trained,
      today_gbp: td.cost_gbp,
      today_actual_gbp: td.actual_gbp,
      today_runs: todayParts.length,
    };
  });
  const evOut = events.map((e) => {
    const parts = eventCosts(e, s.appliances);
    return { ...e, cost_effective_gbp: Math.round(parts.reduce((t, c) => t + c.cost, 0) * 1000) / 1000, actual_gbp: Math.round(parts.reduce((t, c) => t + c.actual, 0) * 1000) / 1000 };
  });
  return {
    appliances: s.appliances,
    events: evOut,
    inbox: events.filter((e) => e.status === "new" && !e.open).length,
    inbox_total: s.events.filter((e) => e.status === "new" && !e.open).length,
    stats,
    nudges: nudges(s, Date.now() - 30 * 86400e3),
    month,
    last_run: s.last_run,
    last_error: s.last_error,
    options: { colors: PP_COLORS, icons: PP_ICONS },
    settings: { auto_confidence: AUTO_CONF, auto_min_confirmations: AUTO_MIN_N, window_hours: WINDOW_H, threshold_kw: ppIds().detect.thresholdKw, min_on_min: ppIds().detect.minOnMin, merge_gap_min: ppIds().detect.mergeGapMin },
  };
}

export function inboxCount() {
  return load().events.filter((e) => e.status === "new" && !e.open).length;
}

/** Runs that finished recently, aren't labelled and haven't been sent yet (for the "Confirm this run?" alert). */
export function takeRunsToNotify(maxAgeMs = 3 * 3600e3) {
  const s = load();
  const now = Date.now();
  const list = s.events.filter((e) => e.status === "new" && !e.open && !e.notified_at && now - e.end < maxAgeMs && e.features.kwh >= 0.5);
  return {
    runs: list.map((e) => ({ id: e.id, start: e.start, end: e.end, kwh: e.features.kwh, cost: e.cost_gbp, actual: e.sources?.method === "power" ? e.sources.cost_actual_gbp : null, suggestion: e.suggestion ? e.suggestion.labels.map((l) => s.appliances.find((a) => a.id === l)?.name ?? l).join(" + ") : null, suggestion_labels: e.suggestion?.labels ?? [] })),
    mark: () => {
      const iso = new Date().toISOString();
      for (const e of list) e.notified_at = iso;
      save();
    },
  };
}
