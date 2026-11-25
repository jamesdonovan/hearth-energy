import crypto from "node:crypto";
import type { HaClient } from "./ha.js";
import { num } from "./ha.js";
import { readJson, writeJson } from "./storage.js";
import { getSettings, RULES, type RuleId } from "./settings.js";
import { iogDispatches, isExtraIogSlot, lastNight } from "./cars.js";
import { loadPlan, eventRates } from "./plan.js";
import { fmtHM, londonDate, londonInstant, londonMinutes } from "./time.js";
import { sendPush } from "./push.js";
import { sendTelegram } from "./telegram.js";
import { carStatus, type CarKey } from "./lastgood.js";
import { dayCost } from "./budget.js";
import { getVariables, isOffPeakMins, kiaLike, teslaLike, type Vehicle } from "./variables.js";

export type Severity = "info" | "warning";
export type Alert = {
  id: string;
  key: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  body: string;
  url: string;
  raised_at: string;
  updated_at: string;
  resolved_at?: string | null;
  acked_at?: string | null;
  /** For stepped alerts (daily cost): current level and the highest level already notified. */
  level?: number | null;
  notified_level?: number | null;
  notified?: { push?: { sent: number; failed: number } | null; telegram?: "sent" | string | null; suppressed?: string | null };
};

type State = { active: Alert[]; history: Alert[]; notifyLog: { at: number; rule: RuleId }[]; lastRun: string | null; lastError: string | null };

function tariffIds() {
  const v = getVariables();
  return {
    exportEvents: [v.tariff.export_current_day_rates, v.tariff.export_next_day_rates].filter(Boolean),
    exportNow: v.tariff.export_current_rate,
    pwSoc: v.site.pw_soc,
    offPeak: v.tariff.off_peak,
    start: v.tariff.off_peak_start,
    end: v.tariff.off_peak_end,
    offP: v.tariff.offpeak_gbp,
  };
}
function otherCar(): Vehicle | undefined {
  return kiaLike();
}
function hhmmToMins(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 23 * 60 + 30;
}
function windowLabel(start: string, end: string) {
  return `${start}–${end}`;
}
function pence(gbp: number) {
  const p = gbp * 100;
  return Number.isInteger(p) ? `${p}p` : `${p.toFixed(1)}p`.replace(/\.0p$/, "p");
}

let state: State = readJson<State>("alerts.json", { active: [], history: [], notifyLog: [], lastRun: null, lastError: null });
let onChange: ((s: ReturnType<typeof alertsView>) => void) | null = null;

export function onAlertsChange(fn: typeof onChange) {
  onChange = fn;
}

function persist() {
  state.history = state.history.slice(0, 300);
  state.notifyLog = state.notifyLog.filter((n) => Date.now() - n.at < 24 * 3600 * 1000);
  writeJson("alerts.json", state);
  onChange?.(alertsView());
}

export function alertsView() {
  return {
    active: state.active.filter((a) => !a.acked_at),
    acked: state.active.filter((a) => a.acked_at),
    history: state.history.slice(0, 100),
    last_run: state.lastRun,
    last_error: state.lastError,
  };
}

export function ackAlert(id: string) {
  const a = state.active.find((x) => x.id === id);
  if (!a) return false;
  a.acked_at = new Date().toISOString();
  persist();
  return true;
}

type Candidate = { key: string; rule: RuleId; severity: Severity; title: string; body: string; url?: string; level?: number };

// ---------------- rules ----------------

async function rulePlannedChargeMissed(ha: HaClient, now: Date): Promise<Candidate[]> {
  const mins = londonMinutes(now);
  if (mins < 6 * 60 || mins > 12 * 60) return [];
  const t = getSettings().thresholds;
  const n = await lastNight(ha, now);
  const list = n.vehicles ? Object.values(n.vehicles) : [n.tesla, n.ev9].filter(Boolean);
  const out: Candidate[] = [];
  for (const e of list) {
    if (!e?.plan_recorded || e.planned_kwh == null || e.planned_kwh < 1) continue;
    if (e.actual_kwh >= e.planned_kwh * t.charge_min_fraction) continue;
    const pct = Math.round((e.actual_kwh / e.planned_kwh) * 100);
    const name = e.name || e.car;
    out.push({
      key: `planned_charge_missed:${e.car}:${n.window.date}`,
      rule: "planned_charge_missed",
      severity: "warning",
      title: `${name} didn't charge as planned`,
      body: `Predbat planned ${e.planned_kwh.toFixed(1)} kWh overnight but the charger delivered ${e.actual_kwh.toFixed(1)} kWh (${pct}%). ${name} is at ${e.soc_end ?? "?"}%${e.planned_morning_soc != null ? `, plan was ${Math.round(e.planned_morning_soc)}%` : ""}. Check the plug, charger mode and any Predbat → charger automation.`,
      url: "/cars",
    });
  }
  return out;
}

function ruleIog(ha: HaClient, now: Date): Candidate[] {
  const iog = iogDispatches(ha);
  const out: Candidate[] = [];
  for (const d of iog.planned) {
    if (Date.parse(d.end) <= now.getTime() || !isExtraIogSlot(d.start, d.end)) continue;
    if (Date.parse(d.start) - now.getTime() > 3 * 3600000) continue; // only shout about it when it's close
    const activeNow = Date.parse(d.start) <= now.getTime();
    const ev9 = otherCar();
    const ev9Plugged = ev9?.plugged ? ha.get(ev9.plugged)?.state === "on" : false;
    const ev9Soc = ev9?.soc ? num(ha.get(ev9.soc)) : null;
    const ev9Name = ev9?.name || "your other car";
    const ids = tariffIds();
    out.push({
      key: `iog_extra:${d.start}`,
      rule: "iog_extra_slot",
      severity: "info",
      title: activeNow ? "Cheap IOG slot now" : "Extra cheap IOG slot coming",
      body: `Intelligent Octopus gave a cheap slot ${fmtHM(d.start)}–${fmtHM(d.end)}: the whole house is ${pence(ids.offP)} then. ${
        ev9Plugged ? `${ev9Name} is plugged in at ${ev9Soc ?? "?"}% — ${ev9Name} Boost would charge it cheaply.` : `Plug in ${ev9Name} to use it.`
      }`,
      url: "/",
    });
  }
  // Active dispatch that isn't in the planned list (Octopus sometimes drops it once started)
  if (iog.active && !out.length) {
    const m = londonMinutes(now);
    const ids = tariffIds();
    if (!isOffPeakMins(m, ids.start, ids.end)) {
      out.push({
        key: `iog_extra:active:${londonDate(now)}:${Math.floor(m / 30)}`,
        rule: "iog_extra_slot",
        severity: "info",
        title: "Cheap IOG slot now",
        body: `Intelligent Octopus is dispatching outside the usual ${windowLabel(ids.start, ids.end)} window, so the house is on ${pence(ids.offP)}. A good moment to charge ${otherCar()?.name || "another car"}.`,
        url: "/",
      });
    }
  }
  return out;
}

async function rulePw(ha: HaClient, now: Date): Promise<Candidate[]> {
  const t = getSettings().thresholds;
  const ids = tariffIds();
  const soc = num(ha.get(ids.pwSoc));
  const mins = londonMinutes(now);
  const today = londonDate(now);
  const out: Candidate[] = [];
  if (soc == null) return out;
  const endM = hhmmToMins(ids.end);
  const startM = hhmmToMins(ids.start);
  // (a) Just after the night charge: battery should be full-ish before the day rate starts.
  if (mins >= endM && mins < endM + 90 && soc < t.pw_morning_min_pct) {
    out.push({
      key: `pw_low_morning:${today}`,
      rule: "pw_low",
      severity: "warning",
      title: "Powerwall low going into the peak rate",
      body: `The cheap window has ended and the Powerwall is at ${soc.toFixed(0)}% (alert below ${t.pw_morning_min_pct}%). Check Predbat's charge window and the Powerwall's grid-charging setting.`,
      url: "/energy",
    });
  }
  const offPeak = ha.get(ids.offPeak)?.state === "on";
  const untilCheap = mins < startM ? startM - mins : 0;
  // (b) During the peak rate, battery already low with a long way to go to the cheap window.
  if (!offPeak && untilCheap > 30 && soc < t.pw_low_pct && mins >= endM + 90) {
    out.push({
      key: `pw_low_evening:${today}`,
      rule: "pw_low",
      severity: "warning",
      title: "Powerwall low before the cheap rate",
      body: `Powerwall is at ${soc.toFixed(0)}% with ${(untilCheap / 60).toFixed(1)} h until ${ids.start}, so the house will import at the peak rate. Predbat expects about ${(num(ha.get(getVariables().predbat.best_battery_hours_left)) ?? 0).toFixed(1)} h left.`,
      url: "/energy",
    });
  } else if (!offPeak && untilCheap > 60 && mins >= 12 * 60) {
    // (c) Plan says it will run down before the cheap window.
    const plan = await loadPlan(ha).catch(() => null);
    const [sh, sm] = ids.start.split(":").map(Number);
    const cheapAt = londonInstant(today, sh, sm).getTime();
    const hit = plan?.rows.find((r) => Date.parse(r.time) > now.getTime() && Date.parse(r.time) < cheapAt && r.soc_percent != null && r.soc_percent <= t.pw_low_pct);
    if (hit) {
      const peakHours = (cheapAt - Date.parse(hit.time)) / 3600000;
      if (peakHours >= 0.75) {
        out.push({
          key: `pw_low_forecast:${today}`,
          rule: "pw_low",
          severity: "info",
          title: `Powerwall will run low before ${ids.start}`,
          body: `Predbat's plan has the Powerwall at ${hit.soc_percent}% by ${fmtHM(hit.time)}, about ${peakHours.toFixed(1)} h before the cheap rate. Now ${soc.toFixed(0)}%.`,
          url: "/energy",
        });
      }
    }
  }
  return out;
}

function ruleExport(ha: HaClient, now: Date): Candidate[] {
  const t = getSettings().thresholds;
  const ids = tariffIds();
  const slots = ids.exportEvents.flatMap((id) => eventRates(ha.get(id)))
    .map((r) => ({ s: Date.parse(r.start), e: Date.parse(r.end), p: r.value * 100 }))
    .filter((r) => Number.isFinite(r.s) && r.e > now.getTime() && r.s < now.getTime() + 3 * 3600000)
    .sort((a, b) => a.s - b.s);
  const nowRate = num(ha.get(ids.exportNow));
  const runs: { s: number; e: number; max: number }[] = [];
  for (const r of slots) {
    if (r.p < t.export_spike_p) continue;
    const last = runs[runs.length - 1];
    if (last && last.e === r.s) {
      last.e = r.e;
      last.max = Math.max(last.max, r.p);
    } else runs.push({ s: r.s, e: r.e, max: r.p });
  }
  if (!runs.length && nowRate != null && nowRate * 100 >= t.export_spike_p) {
    const start = Date.parse(String(ha.get(ids.exportNow)?.attributes?.start ?? "")) || now.getTime();
    const end = Date.parse(String(ha.get(ids.exportNow)?.attributes?.end ?? "")) || now.getTime() + 1800000;
    runs.push({ s: start, e: end, max: nowRate * 100 });
  }
  const soc = num(ha.get(ids.pwSoc));
  return runs.slice(0, 1).map((r) => ({
    key: `export_spike:${new Date(r.s).toISOString()}`,
    rule: "export_spike" as RuleId,
    severity: "info" as Severity,
    title: `Export spike: up to ${r.max.toFixed(1)}p`,
    body: `Agile Outgoing pays ${r.max.toFixed(1)}p/kWh ${r.s <= now.getTime() ? "now" : "from " + fmtHM(r.s)} until ${fmtHM(r.e)} (alert at ${t.export_spike_p}p). Powerwall ${soc != null ? soc.toFixed(0) + "%" : "—"}; Predbat will export if its plan says it pays.`,
    url: "/energy",
  }));
}

// ---------------- engine ----------------

function inQuietHours(q: string, now: Date) {
  const m = q.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return false;
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  const x = londonMinutes(now);
  return a <= b ? x >= a && x < b : x >= a || x < b;
}

async function notify(a: Alert, force = false) {
  const s = getSettings();
  const t = s.thresholds;
  const now = Date.now();
  const recent = state.notifyLog.filter((n) => now - n.at < 3600000);
  const sameRule = state.notifyLog.filter((n) => n.rule === a.rule && now - n.at < t.cooldown_min * 60000);
  let suppressed: string | null = null;
  if (inQuietHours(t.quiet_hours, new Date())) suppressed = "quiet hours";
  else if (recent.length >= t.max_per_hour) suppressed = `rate limit (${t.max_per_hour}/h)`;
  else if (sameRule.length && !force) suppressed = `cooldown (${t.cooldown_min} min)`;
  a.notified = { suppressed };
  if (suppressed) return;
  let any = false;
  if (s.webpush.enabled && s.webpush.types[a.rule]) {
    try {
      a.notified.push = await sendPush({ title: a.title, body: a.body, url: a.url, tag: a.key, severity: a.severity });
      any = any || (a.notified.push?.sent ?? 0) > 0;
    } catch (err) {
      a.notified.push = { sent: 0, failed: 1 };
      console.error("push failed:", (err as Error).message);
    }
  }
  if (s.telegram.enabled && s.telegram.types[a.rule] && s.telegram.bot_token && s.telegram.chat_id) {
    try {
      await sendTelegram(`${a.severity === "warning" ? "⚠️" : "🔔"} ${a.title}\n${a.body}`);
      a.notified.telegram = "sent";
      any = true;
    } catch (err) {
      a.notified.telegram = (err as Error).message.slice(0, 200);
    }
  }
  if (any) state.notifyLog.push({ at: now, rule: a.rule });
}

let running = false;

export async function runAlerts(ha: HaClient) {
  if (running || !ha.connected) return;
  running = true;
  const now = new Date();
  try {
    const s = getSettings();
    const cands: Candidate[] = [];
    const errors: string[] = [];
    const tryRule = async (id: RuleId, fn: () => Promise<Candidate[]> | Candidate[]) => {
      if (!s.rules[id]) return;
      try {
        cands.push(...(await fn()));
      } catch (err) {
        errors.push(`${id}: ${(err as Error).message}`);
      }
    };
    await tryRule("planned_charge_missed", () => rulePlannedChargeMissed(ha, now));
    await tryRule("iog_extra_slot", () => ruleIog(ha, now));
    await tryRule("pw_low", () => rulePw(ha, now));
    await tryRule("export_spike", () => ruleExport(ha, now));
    await tryRule("car_data_lost", () => ruleCarLost(ha, now));
    await tryRule("daily_cost", () => ruleDailyCost(ha, now));

    const keys = new Set(cands.map((c) => c.key));
    const iso = now.toISOString();
    // resolve alerts whose condition has cleared (only for rules that ran without error)
    const failedRules = new Set(errors.map((e) => e.split(":")[0]));
    for (const a of [...state.active]) {
      if (!keys.has(a.key) && !failedRules.has(a.rule)) {
        a.resolved_at = iso;
        state.active = state.active.filter((x) => x !== a);
        state.history.unshift(a);
      }
    }
    for (const c of cands) {
      const existing = state.active.find((a) => a.key === c.key);
      if (existing) {
        existing.body = c.body;
        existing.title = c.title;
        existing.updated_at = iso;
        if (c.level != null) {
          existing.level = c.level;
          // stepped alert rose another step: notify again (and show it again if it was dismissed)
          if (c.level > (existing.notified_level ?? -1)) {
            existing.acked_at = null;
            existing.notified_level = c.level;
            await notify(existing, true);
          }
        }
        continue;
      }
      const prior = state.history.filter((h) => h.key === c.key && Date.now() - Date.parse(h.raised_at) < 12 * 3600000);
      let silent = false;
      if (c.level != null) {
        // Stepped: show again in the app if it comes back, but only notify above the highest level already sent.
        const sent = Math.max(-1, ...prior.map((h) => h.notified_level ?? -1));
        silent = c.level <= sent;
      } else if (prior.length) continue; // Don't re-raise something that already fired and resolved in the last 12 h.
      const a: Alert = { id: crypto.randomUUID(), key: c.key, rule: c.rule, severity: c.severity, title: c.title, body: c.body, url: c.url || "/", raised_at: iso, updated_at: iso, resolved_at: null, acked_at: null, level: c.level ?? null };
      if (c.level != null) a.notified_level = silent ? Math.max(-1, ...prior.map((h) => h.notified_level ?? -1)) : c.level;
      state.active.push(a);
      if (silent) a.notified = { suppressed: "already notified at this level today" };
      else await notify(a);
    }
    state.lastRun = iso;
    state.lastError = errors.length ? errors.join("; ") : null;
    persist();
  } catch (err) {
    state.lastError = (err as Error).message;
  } finally {
    running = false;
  }
}

function carHint(v: Vehicle | undefined, car: string): string {
  if (v?.kind === "tesla_iog" || car === "tesla") {
    return "Usually this is Tesla Fleet after a Home Assistant restart or integration reload while the car is asleep; it clears when the car next wakes (opening the Tesla app or pressing Wake once). Predbat will see an unknown car SoC / charge limit until then.";
  }
  if (v?.kind === "kia" || car === "ev9") {
    return "Usually the Kia UVO integration has failed to log in, which leaves every Kia entity unavailable. Re-authenticate it in Home Assistant; Hearth shows the last known values until then.";
  }
  return "The car integration may have dropped; Hearth is holding the last known values until the entities come back.";
}

function ruleCarLost(ha: HaClient, now: Date): Candidate[] {
  const t = getSettings().thresholds;
  const out: Candidate[] = [];
  const vehicles = getVariables().vehicles;
  const keys = vehicles.map((v) => v.id);
  for (const car of keys) {
    const v = vehicles.find((x) => x.id === car);
    const s = carStatus(car, now);
    if (s.mode !== "lost" || !s.lost_since) continue;
    const mins = (now.getTime() - Date.parse(s.lost_since)) / 60000;
    if (mins < t.car_lost_min) continue;
    const socId = v?.soc;
    const soc = socId ? num(ha.get(socId)) : null;
    out.push({
      key: `car_data_lost:${car}:${s.lost_since}`,
      rule: "car_data_lost",
      severity: "warning",
      title: `${s.name}: car data lost since ${fmtHM(Date.parse(s.lost_since))}`,
      body: `${s.name} has reported ${s.live_state || "unknown"} for ${Math.round(mins)} min${s.last_seen ? ` (last seen ${fmtHM(Date.parse(s.last_seen))})` : ""}. Hearth is showing the last known values${soc != null ? ` (${soc.toFixed(0)}%)` : ""}. ${carHint(v, car)}`,
      url: "/cars",
    });
  }
  return out;
}

function ruleDailyCost(ha: HaClient, now: Date): Candidate[] {
  const d = dayCost(ha, now);
  if (!d.over || d.predicted_gbp == null) return [];
  const step = Math.max(0.05, d.step_gbp);
  const level = Math.floor((d.predicted_gbp - d.budget_gbp) / step + 1e-9);
  const gbp = (n: number | null) => (n == null ? "—" : `£${n.toFixed(2)}`);
  return [
    {
      key: `daily_cost:${d.date}`,
      rule: "daily_cost",
      severity: "warning",
      level,
      title: `Today's cost heading for ${gbp(d.predicted_gbp)} (budget ${gbp(d.budget_gbp)})`,
      body: `Predbat predicts ${gbp(d.predicted_gbp)} net for today including the standing charge: ${gbp(d.actual_gbp)} so far plus ${gbp(d.remaining_gbp)} to midnight. That is ${gbp(d.over_by_gbp)} over your ${gbp(d.budget_gbp)} budget.${level > 0 ? ` (Re-alerts every further ${gbp(step)}.)` : ""}`,
      url: "/energy",
    },
  ];
}

const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const hhmm = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(t));

/**
 * PowerPrint "Confirm this run?" through the normal channels (rule powerprint_confirm, off by default).
 * Same quiet hours and hourly cap as other alerts. Telegram gets URL buttons that deep-link into Hearth.
 */
export async function notifyPowerPrint(runs: { id: string; start: number; end: number; kwh: number; cost: number; actual?: number | null; suggestion: string | null; suggestion_labels: string[] }[]): Promise<{ sent: boolean; reason?: string }> {
  const s = getSettings();
  if (!runs.length) return { sent: false, reason: "nothing new" };
  if (!s.rules.powerprint_confirm) return { sent: false, reason: "rule off" };
  const t = s.thresholds;
  const now = Date.now();
  if (inQuietHours(t.quiet_hours, new Date())) return { sent: false, reason: "quiet hours" };
  if (state.notifyLog.filter((n) => now - n.at < 3600000).length >= t.max_per_hour) return { sent: false, reason: "rate limit" };
  const r = runs[runs.length - 1];
  const link = (extra = "") => `${PUBLIC_URL}/energy?tab=powerprint&run=${encodeURIComponent(r.id)}${extra}`;
  const title = runs.length === 1 ? "Confirm appliance run?" : `${runs.length} appliance runs to confirm`;
  const body = `Something ran ${hhmm(r.start)}–${hhmm(r.end)}, ${r.kwh.toFixed(1)} kWh, £${r.cost.toFixed(2)}${r.actual != null && r.cost - r.actual >= 0.01 ? ` (£${r.actual.toFixed(2)} with solar/battery)` : ""}.${r.suggestion ? ` Looks like ${r.suggestion}.` : ""} Which was it?${runs.length > 1 ? ` (+${runs.length - 1} more)` : ""}`;
  let any = false;
  if (s.webpush.enabled && s.webpush.types.powerprint_confirm) {
    try {
      const res = await sendPush({ title, body, url: `/energy?tab=powerprint&run=${encodeURIComponent(r.id)}`, tag: "powerprint", severity: "info" });
      any = any || (res?.sent ?? 0) > 0;
    } catch (err) {
      console.error("push failed:", (err as Error).message);
    }
  }
  if (s.telegram.enabled && s.telegram.types.powerprint_confirm && s.telegram.bot_token && s.telegram.chat_id) {
    const buttons: { text: string; url: string }[][] = [];
    if (r.suggestion) buttons.push([{ text: `Yes, ${r.suggestion}`, url: link(`&label=${encodeURIComponent(r.suggestion_labels.join(","))}`) }]);
    buttons.push([{ text: "Choose in Hearth", url: link() }]);
    try {
      await sendTelegram(`🔌 ${title}\n${body}`, undefined, PUBLIC_URL.startsWith("http") ? buttons : undefined);
      any = true;
    } catch (err) {
      console.error("telegram failed:", (err as Error).message.slice(0, 200));
    }
  }
  if (any) state.notifyLog.push({ at: now, rule: "powerprint_confirm" });
  return { sent: any, reason: any ? undefined : "no channel enabled" };
}

export function startAlertEngine(ha: HaClient) {
  const every = Math.max(30, Number(process.env.ALERT_INTERVAL_SEC || 120)) * 1000;
  setTimeout(() => runAlerts(ha), 20000);
  setInterval(() => runAlerts(ha), every);
}

export const ALL_RULES = RULES;
