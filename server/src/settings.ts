import { readJson, writeJson } from "./storage.js";

export const RULES = ["planned_charge_missed", "iog_extra_slot", "pw_low", "export_spike", "car_data_lost", "daily_cost", "powerprint_confirm"] as const;
export type RuleId = (typeof RULES)[number];
export const RULE_LABELS: Record<RuleId, string> = {
  planned_charge_missed: "A planned EV charge didn't happen overnight",
  iog_extra_slot: "IOG extra cheap slot (chance to charge another car)",
  pw_low: "Powerwall low before the cheap rate / after the night charge",
  export_spike: "Export rate spike",
  car_data_lost: "Car data lost (Tesla Fleet / Kia showing unknown)",
  daily_cost: "Today's predicted cost over budget",
  powerprint_confirm: "PowerPrint: confirm a detected appliance run (off by default)",
};

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
  quiet_hours: string; // "" or "HH:MM-HH:MM"
};

type ChannelTypes = Record<RuleId, boolean>;

export type Settings = {
  rules: Record<RuleId, boolean>;
  thresholds: Thresholds;
  webpush: { enabled: boolean; types: ChannelTypes };
  telegram: { enabled: boolean; chat_id: string; bot_token: string; types: ChannelTypes };
  updated_at: string | null;
};

const envNum = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] != null ? v : d;
};
const allTrue = (): ChannelTypes => ({ planned_charge_missed: true, iog_extra_slot: true, pw_low: true, export_spike: true, car_data_lost: true, daily_cost: true, powerprint_confirm: true });
/** Notification defaults: "car data lost" shows in the app but is off for push/Telegram until switched on. */
const channelDefaults = (): ChannelTypes => ({ ...allTrue(), car_data_lost: false });

function defaults(): Settings {
  return {
    rules: { ...allTrue(), powerprint_confirm: false },
    thresholds: {
      export_spike_p: envNum("ALERT_EXPORT_SPIKE_P", 30),
      pw_low_pct: envNum("ALERT_PW_LOW_PCT", 20),
      pw_morning_min_pct: envNum("ALERT_PW_MORNING_MIN_PCT", 50),
      charge_min_fraction: envNum("ALERT_CHARGE_MIN_FRACTION", 0.5),
      cooldown_min: envNum("ALERT_COOLDOWN_MIN", 60),
      max_per_hour: envNum("ALERT_MAX_PER_HOUR", 6),
      car_lost_min: envNum("ALERT_CAR_LOST_MIN", 30),
      daily_cost_gbp: envNum("ALERT_DAILY_COST_GBP", 2),
      daily_cost_step_gbp: envNum("ALERT_DAILY_COST_STEP_GBP", 0.5),
      quiet_hours: process.env.ALERT_QUIET_HOURS || "",
    },
    webpush: { enabled: true, types: channelDefaults() },
    telegram: {
      enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      chat_id: process.env.TELEGRAM_CHAT_ID || "",
      bot_token: process.env.TELEGRAM_BOT_TOKEN || "",
      types: channelDefaults(),
    },
    updated_at: null,
  };
}

let cache: Settings | null = null;

/** Env seeds defaults; anything saved from the UI (server/data/settings.json) overrides. */
export function getSettings(): Settings {
  if (cache) return cache;
  const d = defaults();
  const saved = readJson<Partial<Settings>>("settings.json", {});
  cache = {
    rules: { ...d.rules, ...(saved.rules || {}) },
    thresholds: { ...d.thresholds, ...(saved.thresholds || {}) },
    webpush: { ...d.webpush, ...(saved.webpush || {}), types: { ...d.webpush.types, ...(saved.webpush?.types || {}) } },
    telegram: {
      ...d.telegram,
      ...(saved.telegram || {}),
      bot_token: saved.telegram && typeof saved.telegram.bot_token === "string" ? saved.telegram.bot_token : d.telegram.bot_token,
      types: { ...d.telegram.types, ...(saved.telegram?.types || {}) },
    },
    updated_at: saved.updated_at || null,
  };
  return cache;
}

function mask(token: string) {
  if (!token) return null;
  return `••••${token.slice(-4)}`;
}

/** Browser-safe view: the bot token is never returned, only a mask. */
export function publicSettings() {
  const s = getSettings();
  const { bot_token, ...tg } = s.telegram;
  return {
    ...s,
    telegram: { ...tg, bot_token_set: Boolean(bot_token), bot_token_masked: mask(bot_token) },
    rule_labels: RULE_LABELS,
  };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * Apply a validated patch. Returns the list of changed field paths (never values of secrets)
 * so the audit log can record what changed.
 */
export function updateSettings(patch: Record<string, unknown>): { changed: string[]; errors: string[] } {
  const s = structuredClone(getSettings());
  const changed: string[] = [];
  const errors: string[] = [];
  const set = (pathStr: string, prev: unknown, next: unknown, apply: () => void) => {
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      apply();
      changed.push(pathStr);
    }
  };

  const rules = patch.rules as Record<string, unknown> | undefined;
  if (rules && typeof rules === "object") {
    for (const r of Object.keys(rules)) {
      if (!(RULES as readonly string[]).includes(r)) continue;
      const v = Boolean(rules[r]);
      set(`rules.${r}`, s.rules[r as RuleId], v, () => (s.rules[r as RuleId] = v));
    }
  }

  const th = patch.thresholds as Record<string, unknown> | undefined;
  if (th && typeof th === "object") {
    const t = s.thresholds;
    const upd = <K extends keyof Thresholds>(k: K, v: Thresholds[K]) => set(`thresholds.${k}`, t[k], v, () => (t[k] = v));
    if ("export_spike_p" in th) upd("export_spike_p", clamp(th.export_spike_p, 0, 500, t.export_spike_p));
    if ("pw_low_pct" in th) upd("pw_low_pct", clamp(th.pw_low_pct, 0, 100, t.pw_low_pct));
    if ("pw_morning_min_pct" in th) upd("pw_morning_min_pct", clamp(th.pw_morning_min_pct, 0, 100, t.pw_morning_min_pct));
    if ("charge_min_fraction" in th) upd("charge_min_fraction", clamp(th.charge_min_fraction, 0, 1, t.charge_min_fraction));
    if ("cooldown_min" in th) upd("cooldown_min", clamp(th.cooldown_min, 0, 24 * 60, t.cooldown_min));
    if ("daily_cost_gbp" in th) upd("daily_cost_gbp", Math.round(clamp(th.daily_cost_gbp, 0, 100, t.daily_cost_gbp) * 100) / 100);
    if ("daily_cost_step_gbp" in th) upd("daily_cost_step_gbp", Math.round(clamp(th.daily_cost_step_gbp, 0.05, 50, t.daily_cost_step_gbp) * 100) / 100);
    if ("car_lost_min" in th) upd("car_lost_min", Math.round(clamp(th.car_lost_min, 5, 24 * 60, t.car_lost_min)));
    if ("max_per_hour" in th) upd("max_per_hour", Math.round(clamp(th.max_per_hour, 1, 60, t.max_per_hour)));
    if ("quiet_hours" in th) {
      const q = String(th.quiet_hours ?? "").trim();
      if (q && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(q)) errors.push("quiet_hours must be HH:MM-HH:MM or empty");
      else upd("quiet_hours", q);
    }
  }

  const channel = (name: "webpush" | "telegram") => {
    const c = patch[name] as Record<string, unknown> | undefined;
    if (!c || typeof c !== "object") return;
    const cur = s[name];
    if ("enabled" in c) set(`${name}.enabled`, cur.enabled, Boolean(c.enabled), () => (cur.enabled = Boolean(c.enabled)));
    const types = c.types as Record<string, unknown> | undefined;
    if (types && typeof types === "object") {
      for (const r of Object.keys(types)) {
        if (!(RULES as readonly string[]).includes(r)) continue;
        const v = Boolean(types[r]);
        set(`${name}.types.${r}`, cur.types[r as RuleId], v, () => (cur.types[r as RuleId] = v));
      }
    }
  };
  channel("webpush");
  channel("telegram");

  const tg = patch.telegram as Record<string, unknown> | undefined;
  if (tg && typeof tg === "object") {
    if ("chat_id" in tg) {
      const id = String(tg.chat_id ?? "").trim();
      if (id && !/^-?\d{1,20}$|^@[A-Za-z0-9_]{4,64}$/.test(id)) errors.push("chat_id must be a numeric id or @channelname");
      else set("telegram.chat_id", s.telegram.chat_id, id, () => (s.telegram.chat_id = id));
    }
    if ("bot_token" in tg && typeof tg.bot_token === "string") {
      const tok = tg.bot_token.trim();
      if (tok && !/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(tok)) errors.push("bot token does not look like a Telegram token (123456:ABC…)");
      else if (tok !== s.telegram.bot_token) {
        s.telegram.bot_token = tok;
        changed.push(tok ? "telegram.bot_token (replaced)" : "telegram.bot_token (cleared)");
      }
    }
  }

  if (errors.length) return { changed: [], errors };
  if (changed.length) {
    s.updated_at = new Date().toISOString();
    if (!writeJson("settings.json", s, true)) errors.push("Settings could not be saved: data directory is not writable");
    cache = s;
  }
  return { changed, errors };
}
