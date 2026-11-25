import WebSocket from "ws";
import { ENTITY_IDS, ENTITY_SET, sanitizeAttributes } from "./whitelist.js";
import type { EntityHint } from "./variables.js";

export type HaEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
};

export type StatisticPoint = {
  start: number;
  end?: number;
  state?: number | null;
  sum?: number | null;
  change?: number | null;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  last_reset?: string | number | null;
};

type Listener = (event: { type: string; entities?: Record<string, HaEntity> }) => void;
type RawHook = (kind: "snapshot" | "state", entities: Record<string, HaEntity>) => Record<string, HaEntity> | void;

export class HaClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, HaEntity>();
  private listeners = new Set<Listener>();
  private synthetic = new Map<string, HaEntity>();
  private rawHook: RawHook | null = null;
  private overlay: ((raw: HaEntity) => HaEntity) | null = null;
  private catalogue: EntityHint[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  connected = false;
  lastError: string | null = null;
  lastConnectAt: string | null = null;

  constructor(
    private url: string,
    private token: string,
  ) {}

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: { type: string; entities?: Record<string, HaEntity> }) {
    for (const fn of this.listeners) fn(event);
  }

  /**
   * Install the last-known-good layer. `hook` sees every raw update first (and may return extra
   * synthetic entities to publish); `overlay` turns a raw entity into what the app should use.
   */
  setLayer(hook: RawHook, overlay: (raw: HaEntity) => HaEntity) {
    this.rawHook = hook;
    this.overlay = overlay;
  }

  /** Publish a Hearth-made entity (e.g. hearth.car_tesla) alongside HA states. */
  putSynthetic(ent: HaEntity, emit = true) {
    const prev = this.synthetic.get(ent.entity_id);
    this.synthetic.set(ent.entity_id, ent);
    if (emit && JSON.stringify(prev) !== JSON.stringify(ent)) this.emit({ type: "state", entities: { [ent.entity_id]: ent } });
  }

  /** Re-send the effective state of some entities (after the last-known-good cache changed). */
  republish(ids: string[]) {
    const out: Record<string, HaEntity> = {};
    for (const id of ids) {
      const e = this.get(id);
      if (e) out[id] = e;
    }
    if (Object.keys(out).length) this.emit({ type: "state", entities: out });
  }

  private view(ent: HaEntity): HaEntity {
    return this.overlay ? this.overlay(ent) : ent;
  }

  /** Effective state: last-known-good values for car entities that are unknown/unavailable. */
  get(entityId: string): HaEntity | undefined {
    const raw = this.cache.get(entityId);
    if (raw) return this.view(raw);
    return this.synthetic.get(entityId);
  }

  /** What Home Assistant actually reports right now. */
  getRaw(entityId: string): HaEntity | undefined {
    return this.cache.get(entityId);
  }

  getAll(): Record<string, HaEntity> {
    const out: Record<string, HaEntity> = {};
    for (const [id, ent] of this.cache) out[id] = this.view(ent);
    for (const [id, ent] of this.synthetic) out[id] = ent;
    return out;
  }


  /** Sanitised entity catalogue for the Variables picker. No tokens, GPS or large attributes. */
  listCatalogue(q = "", domain = "", limit = 200): EntityHint[] {
    const query = q.trim().toLowerCase();
    const out: EntityHint[] = [];
    for (const h of this.catalogue) {
      if (domain && h.domain !== domain) continue;
      if (query) {
        const name = (h.friendly_name || "").toLowerCase();
        if (!h.entity_id.toLowerCase().includes(query) && !name.includes(query)) continue;
      }
      out.push(h);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Re-read HA states after the allow-list changes: drop unlisted cache entries,
   * add newly listed ones, republish a snapshot. Event subscription is already
   * for all state_changed events.
   */
  async refreshWhitelisted(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    await this.loadStates(false);
  }

  private hintOf(s: HaEntity): EntityHint {
    const attrs = (s.attributes || {}) as Record<string, unknown>;
    const domain = s.entity_id.split(".")[0] || "";
    let state: string | null = s.state ?? null;
    if (typeof state === "string" && state.length > 80) state = `${state.slice(0, 80)}…`;
    return {
      entity_id: s.entity_id,
      domain,
      friendly_name: typeof attrs.friendly_name === "string" ? attrs.friendly_name : null,
      state,
      unit: domain === "device_tracker" ? null : typeof attrs.unit_of_measurement === "string" ? attrs.unit_of_measurement : null,
      device_class: typeof attrs.device_class === "string" ? attrs.device_class : null,
    };
  }

  private async loadStates(subscribeEvents: boolean) {
    const states = (await this.call({ type: "get_states" })) as HaEntity[];
    this.catalogue = (states || []).map((s) => this.hintOf(s));
    const entities: Record<string, HaEntity> = {};
    for (const id of [...this.cache.keys()]) {
      if (!ENTITY_SET.has(id)) this.cache.delete(id);
    }
    for (const s of states || []) {
      if (!ENTITY_SET.has(s.entity_id)) continue;
      const ent = this.toEntity(s);
      this.cache.set(s.entity_id, ent);
      entities[s.entity_id] = ent;
    }
    const extra = this.rawHook?.("snapshot", entities) || {};
    const out: Record<string, HaEntity> = {};
    for (const [id, ent] of Object.entries(entities)) out[id] = this.view(ent);
    for (const [id, ent] of Object.entries(extra)) {
      this.synthetic.set(id, ent);
      out[id] = ent;
    }
    for (const [id, ent] of this.synthetic) out[id] ??= ent;
    this.emit({ type: "snapshot", entities: out });
    if (subscribeEvents) {
      await this.call({ type: "subscribe_events", event_type: "state_changed" });
    }
  }

  async start() {
    await this.connect();
  }

  private wsUrl(): string {
    const u = this.url.replace(/\/+$/, "");
    if (u.startsWith("https://")) return "wss://" + u.slice("https://".length) + "/api/websocket";
    if (u.startsWith("http://")) return "ws://" + u.slice("http://".length) + "/api/websocket";
    throw new Error("HA_URL must be http(s)");
  }

  private restUrl(path: string): string {
    return this.url.replace(/\/+$/, "") + path;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.wsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let opened = false;

      ws.on("open", () => {
        /* auth handshake follows */
      });

      ws.on("message", (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        const type = msg.type as string;
        if (type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: this.token }));
          return;
        }
        if (type === "auth_ok") {
          this.connected = true;
          this.lastError = null;
          this.lastConnectAt = new Date().toISOString();
          opened = true;
          this.subscribe().then(() => resolve()).catch(reject);
          this.armPing();
          this.emit({ type: "connected" });
          return;
        }
        if (type === "auth_invalid") {
          this.lastError = "HA auth failed";
          reject(new Error("Home Assistant rejected the access token"));
          ws.close();
          return;
        }
        if (typeof msg.id === "number" && (type === "result" || this.pending.has(msg.id as number))) {
          const p = this.pending.get(msg.id as number);
          if (p) {
            this.pending.delete(msg.id as number);
            if (msg.success === false) {
              const err = (msg.error as { message?: string })?.message || "HA command failed";
              p.reject(new Error(err));
            } else {
              p.resolve(msg.result);
            }
          }
        }
        if (type === "event") {
          this.handleEvent(msg);
        }
      });

      ws.on("close", () => {
        this.connected = false;
        this.ws = null;
        this.clearPing();
        this.emit({ type: "disconnected" });
        if (!opened) {
          // still reject the promise if we never authed
        }
        this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        this.lastError = err.message;
        if (!opened) reject(err);
      });
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.lastError = err.message;
        this.scheduleReconnect();
      });
    }, 3000);
  }

  private armPing() {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.call({ type: "ping" }).catch(() => {});
      }
    }, 25000);
  }

  private clearPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private nextId() {
    this.msgId += 1;
    return this.msgId;
  }

  private call(payload: Record<string, unknown>, timeoutMs = 20000): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to Home Assistant"));
    }
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("HA command timed out"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ ...payload, id }));
    });
  }

  private async subscribe() {
    await this.loadStates(true);
  }

  private toEntity(s: HaEntity): HaEntity {
    return {
      entity_id: s.entity_id,
      state: s.state,
      attributes: sanitizeAttributes(s.entity_id, s.attributes as Record<string, unknown>),
      last_changed: s.last_changed,
      last_updated: s.last_updated,
    };
  }

  private handleEvent(msg: Record<string, unknown>) {
    const event = msg.event as {
      event_type?: string;
      data?: { entity_id?: string; new_state?: HaEntity | null };
    };
    if (event?.event_type !== "state_changed") return;
    const entityId = event.data?.entity_id;
    if (!entityId || !ENTITY_SET.has(entityId)) return;
    const neu = event.data?.new_state;
    if (!neu) {
      this.cache.delete(entityId);
      return;
    }
    const ent = this.toEntity(neu);
    this.cache.set(entityId, ent);
    const extra = this.rawHook?.("state", { [entityId]: ent }) || {};
    const out: Record<string, HaEntity> = { [entityId]: this.view(ent) };
    for (const [id, e] of Object.entries(extra)) {
      const prev = this.synthetic.get(id);
      this.synthetic.set(id, e);
      if (JSON.stringify(prev) !== JSON.stringify(e)) out[id] = e;
    }
    this.emit({ type: "state", entities: out });
  }


  /** Long-term recorder statistics (read-only). start/end are ISO timestamps. */
  async statisticsDuringPeriod(
    statisticIds: string[],
    startTime: string,
    endTime: string,
    period: "5minute" | "hour" | "day",
  ): Promise<Record<string, StatisticPoint[]>> {
    const result = await this.call(
      {
        type: "recorder/statistics_during_period",
        start_time: startTime,
        end_time: endTime,
        statistic_ids: statisticIds,
        period,
      },
      45000,
    );
    return (result || {}) as Record<string, StatisticPoint[]>;
  }

  /** Fetch unsanitized state (server-side only, e.g. plan_html.raw). */
  async getRawState(entityId: string): Promise<HaEntity | null> {
    const res = await fetch(this.restUrl(`/api/states/${encodeURIComponent(entityId)}`), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HA GET ${entityId} failed: ${res.status}`);
    return (await res.json()) as HaEntity;
  }

  async history(entityIds: string[], startIso: string, endIso?: string, significant = true): Promise<unknown> {
    for (const id of entityIds) {
      if (!ENTITY_SET.has(id)) throw new Error(`Entity not allowed: ${id}`);
    }
    const start = encodeURIComponent(startIso);
    const params = new URLSearchParams({
      filter_entity_id: entityIds.join(","),
      significant_changes_only: significant ? "true" : "false",
      minimal_response: "true",
    });
    if (endIso) params.set("end_time", endIso);
    const res = await fetch(this.restUrl(`/api/history/period/${start}?${params.toString()}`), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`HA history failed: ${res.status}`);
    return res.json();
  }

  /** Full history including attributes (server-side only; never forwarded raw). */
  async historyWithAttributes(entityIds: string[], startIso: string, endIso: string): Promise<HaEntity[][]> {
    for (const id of entityIds) {
      if (!ENTITY_SET.has(id)) throw new Error(`Entity not allowed: ${id}`);
    }
    const params = new URLSearchParams({
      filter_entity_id: entityIds.join(","),
      significant_changes_only: "false",
      end_time: endIso,
    });
    const res = await fetch(this.restUrl(`/api/history/period/${encodeURIComponent(startIso)}?${params.toString()}`), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`HA history failed: ${res.status}`);
    return (await res.json()) as HaEntity[][];
  }

  async callService(domain: string, service: string, entityId: string, data: Record<string, unknown> = {}) {
    if (!ENTITY_SET.has(entityId)) throw new Error(`Entity not allowed: ${entityId}`);
    return this.call({
      type: "call_service",
      domain,
      service,
      target: { entity_id: entityId },
      service_data: data,
    });
  }
}

export function num(ent: HaEntity | undefined): number | null {
  if (!ent) return null;
  const s = ent.state;
  if (s == null || s === "" || s === "unknown" || s === "unavailable") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const WHITELIST = ENTITY_IDS;
