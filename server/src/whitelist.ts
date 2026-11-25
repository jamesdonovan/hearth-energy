/** Entity and action allow-lists. The HA token never leaves this process. */

/** Live allow-list, filled from Settings → Variables at startup via applyAllowLists. */
export const ENTITY_IDS: string[] = [];

export const ENTITY_SET = new Set<string>(ENTITY_IDS);

/** Attributes that must never be forwarded to the browser. */
const BLOCKED_ATTR_EXACT = new Set([
  "access_token",
  "refresh_token",
  "token",
  "latitude",
  "longitude",
  "gps_accuracy",
  "source_type",
  "entity_picture",
  "html",
  "text",
  "debug",
]);

const BLOCKED_ATTR_SUBSTR = ["token", "latitude", "longitude", "gps", "secret", "password"];

export function sanitizeAttributes(
  entityId: string,
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!attributes) return out;
  // Location trackers: state only (home / not_home). Never leak coordinates.
  if (entityId.startsWith("device_tracker.")) return out;

  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase();
    if (BLOCKED_ATTR_EXACT.has(lower)) continue;
    if (BLOCKED_ATTR_SUBSTR.some((s) => lower.includes(s))) continue;
    // plan_html.raw is served via /api/plan, not the generic state payload
    if (entityId === "predbat.plan_html" && (key === "raw" || key === "html" || key === "text")) {
      continue;
    }
    // Drop huge blobs from generic state (rates arrays live on /api/plan or events)
    if (typeof value === "string" && value.length > 4000) continue;
    out[key] = value;
  }
  return out;
}

export type ActionSpec = {
  domain: string;
  service: string;
  entityId: string;
  /** If set, data.option must be one of these, or one of the entity's live options. */
  optionFromEntity?: boolean;
  allowedOptions?: string[];
  /** For input_number.set_value */
  numberRange?: { min: number; max: number; step?: number };
};

/** Live action allow-list, filled from Variables at startup via applyAllowLists. */
export const ACTIONS: ActionSpec[] = [];

/** Replace the live allow-lists (called when Variables are loaded or saved). */
export function applyAllowLists(ids: string[], actions: ActionSpec[]) {
  ENTITY_SET.clear();
  for (const id of ids) ENTITY_SET.add(id);
  ENTITY_IDS.length = 0;
  ENTITY_IDS.push(...ids);
  ACTIONS.length = 0;
  ACTIONS.push(...actions);
}

export function findAction(domain: string, service: string, entityId: string): ActionSpec | undefined {
  return ACTIONS.find((a) => a.domain === domain && a.service === service && a.entityId === entityId);
}
