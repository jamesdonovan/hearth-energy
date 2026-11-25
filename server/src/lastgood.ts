/**
 * Last-known-good cache for car entities.
 *
 * Tesla Fleet often sets car entities to `unknown` after an HA restart / integration reload while
 * the car is asleep, and they stay that way until the car next wakes. The same can happen with Kia UVO
 * after an auth failure. Hearth keeps the last valid state of each car entity (persisted in
 * DATA_DIR/car-lastgood.json, seeded from HA history on first start) and serves that instead, flagged
 * as stale, plus a per-car status entity:
 *
 *   hearth.car_<vehicle_id>  state: online | asleep | idle | lost | no_data
 *     attributes: as_of, lost_since, last_seen, live_state, held[]
 *
 * Read-only: only history and state reads, never a service call or a wake.
 */
import type { HaClient, HaEntity } from "./ha.js";
import { readJson, writeJson } from "./storage.js";
import { getVariables, onVariablesApplied, chargerPowerIds } from "./variables.js";

export type CarKey = string;

type CarCfg = {
  name: string;
  /** Connectivity sensor (on = online, off = asleep). Kia has none. */
  status: string | null;
  /** Main reading; if this is bad the car counts as lost. */
  primary: string;
  /** Timestamp sensor for "as of" (Kia). */
  asOf: string | null;
  idleMin: number;
  entities: string[];
};

function heldEntities(car: ReturnType<typeof getVariables>["vehicles"][number]): string[] {
  return [
    car.soc, car.soc_last_known, car.range, car.range_last_known,
    car.charge_limit, car.charge_limit_last_known, car.plugged, car.charging,
    car.charge_switch, car.energy_added, car.location, car.status, car.as_of,
    car.last_scanned, car.odometer, car.capacity, car.economy, car.charge_duration,
    car.boost,
  ].filter((x): x is string => !!x);
}

function buildCfg(): Record<CarKey, CarCfg> {
  const out: Record<CarKey, CarCfg> = {};
  for (const car of getVariables().vehicles) {
    out[car.id] = {
      name: car.name,
      status: car.status,
      primary: car.soc,
      asOf: car.as_of,
      idleMin: car.idle_min || 60,
      entities: heldEntities(car),
    };
  }
  return out;
}

export let CAR_CFG: Record<CarKey, CarCfg> = {};

/** Instantaneous readings are NOT held (a stale 7 kW would be wrong); they just read as 0 / —. */
export function notHeld(): string[] {
  const v = getVariables();
  const ids = [...chargerPowerIds(v)];
  for (const car of v.vehicles) {
    for (const id of [car.charging_power, car.charge_rate, car.time_to_full]) if (id) ids.push(id);
  }
  return [...new Set(ids)];
}
export const NOT_HELD = new Proxy([] as string[], {
  get(_t, prop) {
    const list = notHeld();
    if (prop === "includes") return (x: string) => list.includes(x);
    if (prop === "length") return list.length;
    if (prop === Symbol.iterator) return list[Symbol.iterator].bind(list);
    return (list as unknown as Record<string, unknown>)[prop as string];
  },
});

const TRACKED = new Map<string, CarKey>();

export function rebuildCarCfg() {
  CAR_CFG = buildCfg();
  TRACKED.clear();
  for (const [k, c] of Object.entries(CAR_CFG)) for (const id of c.entities) TRACKED.set(id, k);
}

rebuildCarCfg();
onVariablesApplied(rebuildCarCfg);

type Rec = {
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  /** Last moment the live value was confirmed good. */
  seen_at: string | null;
  /** When the live value went unknown/unavailable (null while good). */
  bad_since: string | null;
  /** The bad live state, if any. */
  live_state?: string | null;
};
type Meta = { last_online_end?: string | null; online_now?: boolean };
type Store = { entities: Record<string, Rec>; cars: Partial<Record<CarKey, Meta>>; seeded_at?: string | null };

export const isBad = (s: string | undefined | null) => s == null || s === "" || s === "unknown" || s === "unavailable";

let store: Store = readJson<Store>("car-lastgood.json", { entities: {}, cars: {} });
store.entities ||= {};
store.cars ||= {};
let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJson("car-lastgood.json", store);
  }, 3000);
}

let haRef: HaClient | null = null;

function observe(ent: HaEntity, atIso: string) {
  const id = ent.entity_id;
  const car = TRACKED.get(id);
  if (!car) return;
  const rec = store.entities[id];
  if (!isBad(ent.state)) {
    store.entities[id] = {
      state: ent.state,
      attributes: ent.attributes,
      last_changed: ent.last_changed,
      last_updated: ent.last_updated,
      seen_at: atIso,
      bad_since: null,
      live_state: null,
    };
  } else if (rec) {
    if (!rec.bad_since) {
      rec.bad_since = ent.last_changed || atIso;
      // it was good right up to the moment it changed
      rec.seen_at = rec.bad_since;
    }
    rec.live_state = ent.state;
  }
  const cfg = CAR_CFG[car];
  if (id === cfg.status) {
    const meta = (store.cars[car] ||= {});
    if (ent.state === "on") {
      meta.online_now = true;
      meta.last_online_end = null;
    } else if (meta.online_now || meta.online_now === undefined) {
      // left "on" now (or first sighting while not on: keep any seeded value)
      if (meta.online_now) meta.last_online_end = ent.last_changed || atIso;
      meta.online_now = false;
    }
  }
  save();
}

/** What the rest of Hearth (and the browser) sees for an entity. */
export function overlay(raw: HaEntity): HaEntity {
  if (!TRACKED.has(raw.entity_id) || !isBad(raw.state)) return raw;
  const rec = store.entities[raw.entity_id];
  if (!rec || isBad(rec.state)) return raw;
  return {
    entity_id: raw.entity_id,
    state: rec.state,
    attributes: {
      ...raw.attributes,
      ...rec.attributes,
      hearth_stale: { live_state: raw.state, since: rec.bad_since || raw.last_changed || null, value_at: rec.last_changed || null },
    },
    last_changed: rec.last_changed,
    last_updated: rec.last_updated,
  };
}

const minIso = (a: string | null | undefined, b: string | null | undefined) => (!a ? b || null : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b);

export type CarStatus = {
  car: CarKey;
  name: string;
  mode: "online" | "asleep" | "idle" | "lost" | "no_data";
  as_of: string | null;
  lost_since: string | null;
  last_seen: string | null;
  live_state: string | null;
  held: string[];
};

export function carStatus(car: CarKey, now = new Date()): CarStatus {
  const cfg = CAR_CFG[car];
  const raw = (id: string) => haRef?.getRaw(id);
  const meta = store.cars[car] || {};
  const held = cfg.entities.filter((id) => isBad(raw(id)?.state) && store.entities[id] && !isBad(store.entities[id].state));
  const primaryRaw = raw(cfg.primary);
  const statusRaw = cfg.status ? raw(cfg.status) : undefined;
  const lost = isBad(primaryRaw?.state) || (cfg.status ? isBad(statusRaw?.state) : false);
  const primaryRec = store.entities[cfg.primary];
  const base: CarStatus = { car, name: cfg.name, mode: "online", as_of: null, lost_since: null, last_seen: null, live_state: null, held };

  // "as of": when the readings were last fresh from the car
  let asOf: string | null = null;
  if (cfg.asOf) {
    const v = haRef?.get(cfg.asOf)?.state;
    if (v && Number.isFinite(Date.parse(v))) asOf = new Date(Date.parse(v)).toISOString();
  }
  if (cfg.status) {
    if (statusRaw?.state === "on") asOf = now.toISOString();
    else asOf = meta.last_online_end || (isBad(statusRaw?.state) ? null : statusRaw?.last_changed) || null;
  }
  asOf ||= primaryRec?.last_updated || null;

  if (lost) {
    if (!primaryRec || isBad(primaryRec.state)) return { ...base, mode: "no_data", live_state: primaryRaw?.state ?? null, as_of: asOf };
    let since: string | null = null;
    for (const id of [cfg.primary, cfg.status].filter(Boolean) as string[]) {
      const r = raw(id);
      if (isBad(r?.state)) since = minIso(since, store.entities[id]?.bad_since || r?.last_changed);
    }
    const lastSeen = cfg.status ? meta.last_online_end || asOf || since : asOf || primaryRec.seen_at;
    return { ...base, mode: "lost", lost_since: since, last_seen: lastSeen, as_of: lastSeen, live_state: (statusRaw && isBad(statusRaw.state) ? statusRaw.state : primaryRaw?.state) ?? null };
  }
  if (cfg.status) {
    if (statusRaw?.state === "off") return { ...base, mode: "asleep", as_of: asOf, last_seen: asOf };
    return { ...base, mode: "online", as_of: asOf, last_seen: asOf };
  }
  const ageMin = asOf ? (now.getTime() - Date.parse(asOf)) / 60000 : 0;
  return { ...base, mode: ageMin > (cfg.idleMin || 60) ? "idle" : "online", as_of: asOf, last_seen: asOf };
}

function statusEntities(): Record<string, HaEntity> {
  const out: Record<string, HaEntity> = {};
  const nowIso = new Date().toISOString();
  for (const car of Object.keys(CAR_CFG) as CarKey[]) {
    const s = carStatus(car);
    const { mode, ...rest } = s;
    out[`hearth.car_${car}`] = { entity_id: `hearth.car_${car}`, state: mode, attributes: { ...rest, friendly_name: `${s.name} data` }, last_changed: nowIso, last_updated: nowIso };
  }
  // keep last_changed stable so the SSE diff only fires on real changes
  for (const [id, e] of Object.entries(out)) {
    const prev = haRef?.get(id);
    if (prev && prev.state === e.state && JSON.stringify(prev.attributes) === JSON.stringify(e.attributes)) out[id] = prev;
  }
  return out;
}

type HistRow = { entity_id?: string; state: string; attributes?: Record<string, unknown>; last_changed?: string; last_updated?: string };

/**
 * Fill gaps from HA history (last valid state before the current unknown run, and when the Tesla
 * was last online). Only for entities that are bad now and that we have nothing good for.
 */
async function seed(ha: HaClient) {
  const need = [...TRACKED.keys()].filter((id) => {
    const r = ha.getRaw(id);
    const rec = store.entities[id];
    return r && isBad(r.state) && (!rec || isBad(rec.state));
  });
  const statusIds = Object.entries(CAR_CFG)
    .filter(([k, c]) => c.status && store.cars[k as CarKey]?.last_online_end === undefined)
    .map(([, c]) => c.status as string);
  const ids = [...new Set([...need, ...statusIds])];
  if (!ids.length) return { seeded: 0 };
  const start = new Date(Date.now() - 10 * 86400000).toISOString();
  const res = (await ha.history(ids, start, new Date().toISOString(), true)) as HistRow[][];
  let seeded = 0;
  for (const series of res || []) {
    if (!series?.length) continue;
    const id = series[0].entity_id;
    if (!id) continue;
    const firstAttrs = series[0].attributes || ha.getRaw(id)?.attributes || {};
    // last good row, and the first bad row after it
    let lastGood = -1;
    for (let i = series.length - 1; i >= 0; i--) if (!isBad(series[i].state)) { lastGood = i; break; }
    if (need.includes(id) && lastGood >= 0) {
      const g = series[lastGood];
      const after = series[lastGood + 1];
      const attrs = { ...(ha.getRaw(id)?.attributes || firstAttrs) };
      store.entities[id] = {
        state: g.state,
        attributes: attrs,
        last_changed: g.last_changed,
        last_updated: g.last_updated || g.last_changed,
        seen_at: after?.last_changed || null,
        bad_since: after?.last_changed || ha.getRaw(id)?.last_changed || null,
        live_state: ha.getRaw(id)?.state ?? null,
      };
      seeded++;
    }
    const car = TRACKED.get(id);
    if (car && CAR_CFG[car].status === id) {
      const meta = (store.cars[car] ||= {});
      let lastOn = -1;
      for (let i = series.length - 1; i >= 0; i--) if (series[i].state === "on") { lastOn = i; break; }
      const cur = ha.getRaw(id)?.state;
      meta.online_now = cur === "on";
      meta.last_online_end = cur === "on" ? null : lastOn >= 0 ? series[lastOn + 1]?.last_changed || null : null;
    }
  }
  store.seeded_at = new Date().toISOString();
  save();
  return { seeded };
}

export function lastGoodView() {
  return {
    cars: (Object.keys(CAR_CFG) as CarKey[]).map((c) => carStatus(c)),
    entities: store.entities,
    seeded_at: store.seeded_at || null,
  };
}

export function installLastGood(ha: HaClient) {
  haRef = ha;
  ha.setLayer((kind, entities) => {
    const at = new Date().toISOString();
    for (const ent of Object.values(entities)) observe(ent, at);
    if (kind === "snapshot") {
      seed(ha)
        .then((r) => {
          if (r.seeded) console.log(`Car last-known-good: seeded ${r.seeded} entities from HA history`);
          for (const e of Object.values(statusEntities())) ha.putSynthetic(e);
          // re-publish held entities so open browsers get the seeded values
          ha.republish([...TRACKED.keys()]);
        })
        .catch((err) => console.error("Car last-known-good seed failed:", (err as Error).message));
    }
    return statusEntities();
  }, overlay);
  setInterval(() => {
    for (const e of Object.values(statusEntities())) ha.putSynthetic(e);
  }, 60000);
}
