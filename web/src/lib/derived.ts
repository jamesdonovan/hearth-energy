import type { HaEntity } from "./api";
import { isUnavailable } from "./format";

export function st(entities: Record<string, HaEntity>, id?: string | null): string | null {
  if (!id) return null;
  const s = entities[id]?.state;
  if (isUnavailable(s)) return null;
  return s ?? null;
}

export function num(entities: Record<string, HaEntity>, id?: string | null): number | null {
  const s = st(entities, id);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function attr<T = unknown>(entities: Record<string, HaEntity>, id: string | null | undefined, key: string): T | undefined {
  if (!id) return undefined;
  return entities[id]?.attributes?.[key] as T | undefined;
}

export function options(entities: Record<string, HaEntity>, id: string): string[] {
  const o = attr<string[]>(entities, id, "options");
  return Array.isArray(o) ? o : [];
}

export type FlowIds = {
  solar?: string;
  load?: string;
  battery?: string;
  grid?: string;
  tesla?: string | null;
  ev9?: string | null;
};

/** Raw battery/grid sign convention: +discharge / −charge; +import / −export. Missing ids read as 0. */
export function flows(entities: Record<string, HaEntity>, ids: FlowIds = {}) {
  const solar = Math.max(0, (ids.solar ? num(entities, ids.solar) : null) ?? 0);
  const load = Math.max(0, (ids.load ? num(entities, ids.load) : null) ?? 0);
  const battRaw = (ids.battery ? num(entities, ids.battery) : null) ?? 0;
  const gridRaw = (ids.grid ? num(entities, ids.grid) : null) ?? 0;
  const tesla = Math.max(0, (ids.tesla ? num(entities, ids.tesla) : null) ?? 0);
  const ev9 = Math.max(0, (ids.ev9 ? num(entities, ids.ev9) : null) ?? 0);
  const batteryCharge = battRaw < 0 ? -battRaw : 0;
  const batteryDischarge = battRaw > 0 ? battRaw : 0;
  const gridImport = gridRaw > 0 ? gridRaw : 0;
  const gridExport = gridRaw < 0 ? -gridRaw : 0;
  return { solar, load, batteryCharge, batteryDischarge, gridImport, gridExport, tesla, ev9, battRaw, gridRaw };
}

export function cheapImport(entities: Record<string, HaEntity>, offPeakId?: string) {
  if (!offPeakId) return false;
  return st(entities, offPeakId) === "on";
}
