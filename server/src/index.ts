import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { HaClient, num, type HaEntity } from "./ha.js";
import { ENTITY_SET, findAction, applyAllowLists } from "./whitelist.js";
import { collectEntityIds, deriveActions, getVariables, kiaLike, publicVariables, saveVariables, resetVariables, setApplyHook, teslaLike } from "./variables.js";
import { eventRates, loadPlan, ratesFromEntity } from "./plan.js";
import { buildStats } from "./stats.js";
import { buildFinancials } from "./financials.js";
import { audit, readAudit } from "./audit.js";
import { DATA_DIR, dataWritable } from "./storage.js";
import { carCosts, carPlan, iogDispatches, lastNight } from "./cars.js";
import { buildTonight } from "./tonight.js";
import { solarAccuracy } from "./solar.js";
import { ackAlert, alertsView, notifyPowerPrint, onAlertsChange, runAlerts, startAlertEngine } from "./alerts.js";
import { getSettings, publicSettings, updateSettings, RULE_LABELS } from "./settings.js";
import { addSubscription, ensureVapid, hasSubscription, isValidSub, removeSubscription, sendPush, subscriptionSummary } from "./push.js";
import { botInfo, detectChats, sendTelegram } from "./telegram.js";
import { installLastGood, lastGoodView } from "./lastgood.js";
import { dayCost } from "./budget.js";
import { counterfactual } from "./counterfactual.js";
import { planView } from "./planview.js";
import { detectNow, labelEvent, manageAppliance, onDetected, powerPrintBreakdown, powerPrintView, startPowerPrint, takeRunsToNotify } from "./powerprint.js";
import { parsePeriod, periodCacheKey } from "./period.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HA_URL = process.env.HA_URL || "";
const HA_TOKEN = process.env.HA_TOKEN || "";
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ALLOW_ACTIONS = (process.env.ALLOW_ACTIONS ?? "true").toLowerCase() !== "false";
const ALERTS_ENABLED = (process.env.ALERTS_ENABLED ?? "true").toLowerCase() !== "false";

if (!HA_URL || !HA_TOKEN) {
  console.error("HA_URL and HA_TOKEN must be set");
  process.exit(1);
}

const ha = new HaClient(HA_URL, HA_TOKEN);
installLastGood(ha);
const sseClients = new Set<express.Response>();
dataWritable();
ensureVapid();
onAlertsChange((view) => {
  const payload = JSON.stringify({ type: "alerts", ...view });
  for (const res of sseClients) res.write(`event: alerts\ndata: ${payload}\n\n`);
});

ha.on((event) => {
  const payload = JSON.stringify(event);
  for (const res of sseClients) {
    res.write(`event: ${event.type}\ndata: ${payload}\n\n`);
  }
});

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ha_connected: ha.connected,
    last_error: ha.lastError,
    last_connect: ha.lastConnectAt,
    entities: Object.keys(ha.getAll()).length,
    allow_actions: ALLOW_ACTIONS,
    alerts_enabled: ALERTS_ENABLED,
    data_dir: DATA_DIR,
    data_writable: dataWritable(),
  });
});

app.get("/api/state", (_req, res) => {
  res.json({
    connected: ha.connected,
    last_connect: ha.lastConnectAt,
    entities: ha.getAll(),
  });
});

/** Car freshness: per-car status plus the held last-known-good values (already sanitised). */
app.get("/api/cars/lastgood", (_req, res) => {
  res.json(lastGoodView());
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: snapshot\ndata: ${JSON.stringify({ type: "snapshot", entities: ha.getAll(), connected: ha.connected })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 20000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

app.get("/api/plan", async (_req, res) => {
  try {
    const plan = await loadPlan(ha);
    const pb = getVariables().predbat;
    const tf = getVariables().tariff;
    const importRates = ratesFromEntity(ha.get(pb.rates));
    const exportRates = ratesFromEntity(ha.get(pb.rates_export));
    const socBest = ratesFromEntity(ha.get(pb.soc_kw_best));
    const chargeLimit = ratesFromEntity(ha.get(pb.best_charge_limit));
    const exportLimit = ratesFromEntity(ha.get(pb.best_export_limit));
    const octopusImportToday = eventRates(ha.get(tf.import_current_day_rates));
    const octopusImportTomorrow = eventRates(ha.get(tf.import_next_day_rates));
    const octopusExportToday = eventRates(ha.get(tf.export_current_day_rates));
    const octopusExportTomorrow = eventRates(ha.get(tf.export_next_day_rates));
    res.json({
      plan,
      predbat: { importRates, exportRates, socBest, chargeLimit, exportLimit },
      octopus: {
        import: [...octopusImportToday, ...octopusImportTomorrow],
        export: [...octopusExportToday, ...octopusExportTomorrow],
      },
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "plan failed" });
  }
});

let statsCache: { at: number; data: unknown } | null = null;
app.get("/api/stats", async (_req, res) => {
  try {
    if (statsCache && Date.now() - statsCache.at < 5 * 60 * 1000) {
      res.json(statsCache.data);
      return;
    }
    const data = await buildStats(ha);
    statsCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "stats failed" });
  }
});


let financialsCache = new Map<string, { at: number; data: unknown }>();
app.get("/api/financials", async (req, res) => {
  let period;
  try {
    period = parsePeriod(req.query as Record<string, unknown>);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "bad period" });
    return;
  }
  try {
    const key = periodCacheKey(period);
    const hit = financialsCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
      res.json(hit.data);
      return;
    }
    const data = await buildFinancials(ha, period);
    financialsCache.set(key, { at: Date.now(), data });
    if (financialsCache.size > 30) financialsCache.delete(financialsCache.keys().next().value as string);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "financials failed" });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const ids = String(req.query.entity_ids || req.query.entity_id || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) {
      res.status(400).json({ error: "entity_ids required" });
      return;
    }
    if (ids.length > 8) {
      res.status(400).json({ error: "at most 8 entities per request" });
      return;
    }
    for (const id of ids) {
      if (!ENTITY_SET.has(id)) {
        res.status(403).json({ error: `Entity not allowed: ${id}` });
        return;
      }
    }
    const end = req.query.end ? new Date(String(req.query.end)) : new Date();
    const start = req.query.start
      ? new Date(String(req.query.start))
      : new Date(end.getTime() - 24 * 3600 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      res.status(400).json({ error: "invalid start/end" });
      return;
    }
    if (end.getTime() - start.getTime() > 40 * 24 * 3600 * 1000) {
      res.status(400).json({ error: "range too large (max 40 days)" });
      return;
    }
    const raw = (await ha.history(ids, start.toISOString(), end.toISOString(), true)) as unknown[];
    const series = downsampleHistory(raw, 800);
    res.json({ start: start.toISOString(), end: end.toISOString(), series });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "history failed" });
  }
});

app.post("/api/action", async (req, res) => {
  try {
    const body = req.body || {};
    const domain = String(body.domain || "");
    const service = String(body.service || "");
    const entityId = String(body.entity_id || body.entityId || "");
    const dryRun = Boolean(body.dry_run || body.dryRun || req.query.dry_run === "true");
    const confirmed = body.confirmed === true;
    const summary = `${domain}.${service} → ${entityId}${body.option != null ? ` = ${String(body.option)}` : body.value != null ? ` = ${String(body.value)}` : ""}`;
    const deny = (status: number, error: string, extra: Record<string, unknown> = {}) => {
      audit(req, { kind: "action", ok: false, dry_run: dryRun, summary, error, detail: { domain, service, entity_id: entityId } });
      res.status(status).json({ error, ...extra });
    };
    const spec = findAction(domain, service, entityId);
    if (!spec) {
      deny(403, "Action is not on the allow-list", { domain, service, entity_id: entityId });
      return;
    }
    if (!dryRun && !confirmed) {
      deny(428, "Confirmation required: send confirmed:true after the user confirms");
      return;
    }

    const data: Record<string, unknown> = {};
    if (spec.service === "select_option") {
      const option = String(body.option ?? body.value ?? "");
      const ent = ha.get(entityId);
      const liveOptions = Array.isArray(ent?.attributes?.options)
        ? (ent!.attributes.options as string[])
        : [];
      const allowed = new Set([...(spec.allowedOptions || []), ...liveOptions]);
      if (!option || (allowed.size > 0 && !allowed.has(option))) {
        deny(400, "Invalid option", { option, allowed: [...allowed] });
        return;
      }
      data.option = option;
    }
    if (spec.service === "set_value" && spec.numberRange) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < spec.numberRange.min || value > spec.numberRange.max) {
        deny(400, "Value out of range", { min: spec.numberRange.min, max: spec.numberRange.max });
        return;
      }
      data.value = value;
    }

    const before = ha.get(entityId)?.state ?? null;
    if (dryRun) {
      audit(req, { kind: "action", ok: true, dry_run: true, summary, detail: { domain, service, entity_id: entityId, data, before } });
      res.json({ ok: true, dry_run: true, would_call: { domain, service, entity_id: entityId, data } });
      return;
    }
    if (!ALLOW_ACTIONS) {
      deny(403, "Actions are disabled (ALLOW_ACTIONS=false)");
      return;
    }
    try {
      await ha.callService(domain, service, entityId, data);
    } catch (err) {
      deny(502, err instanceof Error ? err.message : "action failed");
      return;
    }
    audit(req, { kind: "action", ok: true, dry_run: false, summary, detail: { domain, service, entity_id: entityId, data, before } });
    res.json({ ok: true, dry_run: false, called: { domain, service, entity_id: entityId, data } });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "action failed" });
  }
});

// ---------- v3: plan, cars, solar ----------
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) => res.status(502).json({ error: err instanceof Error ? err.message : "failed" }));

app.get(
  "/api/financials/counterfactual",
  wrap(async (req, res) => {
    let period;
    try {
      period = parsePeriod(req.query as Record<string, unknown>);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "bad period" });
      return;
    }
    res.json(await counterfactual(ha, period));
  }),
);
app.get("/api/powerprint", (req, res) => res.json(powerPrintView(Math.min(120, Math.max(1, Number(req.query.days ?? 30)) || 30))));
app.post("/api/powerprint/events/:id/label", (req, res) => {
  const r = labelEvent(String(req.params.id), req.body || {});
  audit(req, { kind: "powerprint", ok: r.ok, summary: r.ok ? `PowerPrint: ${r.event!.status} ${r.event!.id} ${r.event!.labels.join("+")}` : "PowerPrint label rejected", error: r.error, detail: r.created ? { created: r.created.name } : undefined });
  res.status(r.ok ? 200 : 400).json(r);
});
app.post("/api/powerprint/appliances", (req, res) => {
  const r = manageAppliance(req.body || {});
  audit(req, { kind: "powerprint", ok: r.ok, summary: `PowerPrint appliance ${r.summary ?? String(req.body?.op ?? "?")}`.slice(0, 160), error: r.error });
  res.status(r.ok ? 200 : 400).json(r);
});
app.get("/api/powerprint/breakdown", (req, res) => {
  const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!ok(req.query.start) || !ok(req.query.end)) return void res.status(400).json({ error: "start and end must be YYYY-MM-DD" });
  res.json(powerPrintBreakdown(String(req.query.start), String(req.query.end)));
});
app.post("/api/powerprint/detect", wrap(async (_req, res) => {
  await detectNow(ha);
  res.json({ ok: true, last_run: powerPrintView(1).last_run, last_error: powerPrintView(1).last_error });
}));
app.get("/api/planview", wrap(async (_req, res) => res.json(await planView(ha))));
app.get("/api/daycost", (_req, res) => res.json(dayCost(ha)));
app.get("/api/tonight", wrap(async (_req, res) => res.json(await buildTonight(ha))));
app.get(
  "/api/cars",
  wrap(async (_req, res) => {
    const [night] = await Promise.all([lastNight(ha)]);
    const vehicles: Record<string, unknown> = {};
    for (const v of getVariables().vehicles) vehicles[v.id] = carPlan(ha, v.id);
    res.json({ plan: { tesla: (teslaLike() && vehicles[teslaLike()!.id]) || null, ev9: (kiaLike() && vehicles[kiaLike()!.id]) || null, vehicles }, iog: iogDispatches(ha), last_night: night });
  }),
);
app.get("/api/cars/costs", wrap(async (_req, res) => res.json(await carCosts(ha))));
app.get(
  "/api/solar",
  wrap(async (req, res) => {
    const d = Number(req.query.days ?? 14);
    res.json(await solarAccuracy(ha, [7, 14, 30].includes(d) ? d : 14));
  }),
);

// ---------- variables ----------
function catalogueForValidation() {
  return ha.listCatalogue("", "", 20000);
}

function broadcastVariables() {
  const payload = JSON.stringify({ type: "variables", variables: publicVariables().variables });
  for (const res of sseClients) res.write(`event: variables\ndata: ${payload}\n\n`);
}

function applyLiveLists() {
  const v = getVariables();
  applyAllowLists(collectEntityIds(v), deriveActions(v));
}

setApplyHook((v) => {
  applyAllowLists(collectEntityIds(v), deriveActions(v));
  statsCache = null;
  financialsCache = new Map();
  ha.refreshWhitelisted().catch((err) => console.error("variables refresh failed:", (err as Error).message));
  broadcastVariables();
});
applyLiveLists();

app.get("/api/variables", (_req, res) => res.json({ ...publicVariables(), data_writable: dataWritable() }));
app.get("/api/variables/export", (_req, res) => {
  const v = getVariables();
  res.setHeader("Content-Disposition", 'attachment; filename="hearth-variables.json"');
  res.json({ kind: "hearth-variables", exported_at: new Date().toISOString(), variables: v });
});
app.get("/api/ha/entities", (req, res) => {
  const q = String(req.query.q ?? req.query.query ?? "");
  const domain = String(req.query.domain ?? "");
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
  res.json({ entities: ha.listCatalogue(q, domain, limit), connected: ha.connected });
});

function requireConfirm(req: express.Request, res: express.Response, summary: string) {
  if ((req.body || {}).confirmed !== true) {
    audit(req, { kind: "variables", ok: false, summary: `${summary} rejected (not confirmed)` });
    res.status(428).json({ error: "Confirmation required" });
    return false;
  }
  return true;
}

app.put("/api/variables", (req, res) => {
  if (!requireConfirm(req, res, "Variables save")) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const payload = body.variables ?? body.patch ?? body;
  const result = saveVariables(payload, catalogueForValidation());
  if (!result.ok) {
    audit(req, { kind: "variables", ok: false, summary: "Variables save rejected", error: result.errors.join("; ") });
    res.status(400).json({ error: result.errors.join("; "), warnings: result.warnings, issues: result.issues });
    return;
  }
  audit(req, { kind: "variables", ok: true, summary: "Variables saved", detail: { updated_at: result.variables.updated_at, warnings: result.warnings } });
  res.json({ ok: true, warnings: result.warnings, issues: result.issues, ...publicVariables() });
});
app.post("/api/variables/import", (req, res) => {
  if (!requireConfirm(req, res, "Variables import")) return;
  const body = (req.body || {}) as Record<string, unknown>;
  if (body.kind && body.kind !== "hearth-variables") {
    audit(req, { kind: "variables", ok: false, summary: "Variables import rejected (wrong kind)" });
    res.status(400).json({ error: "This file is not a Hearth variables export" });
    return;
  }
  const payload = body.variables ?? body;
  const result = saveVariables(payload, catalogueForValidation());
  if (!result.ok) {
    audit(req, { kind: "variables", ok: false, summary: "Variables import rejected", error: result.errors.join("; ") });
    res.status(400).json({ error: result.errors.join("; "), warnings: result.warnings, issues: result.issues });
    return;
  }
  audit(req, { kind: "variables", ok: true, summary: "Variables imported", detail: { updated_at: result.variables.updated_at } });
  res.json({ ok: true, warnings: result.warnings, issues: result.issues, ...publicVariables() });
});
app.post("/api/variables/reset", (req, res) => {
  if (!requireConfirm(req, res, "Variables reset")) return;
  const result = resetVariables(catalogueForValidation());
  if (!result.ok) {
    audit(req, { kind: "variables", ok: false, summary: "Variables reset failed", error: result.errors.join("; ") });
    res.status(400).json({ error: result.errors.join("; ") });
    return;
  }
  audit(req, { kind: "variables", ok: true, summary: "Variables reset to defaults" });
  res.json({ ok: true, warnings: result.warnings, issues: result.issues, ...publicVariables() });
});

// ---------- alerts ----------
app.get("/api/alerts", (_req, res) => res.json({ ...alertsView(), enabled: ALERTS_ENABLED, rule_labels: RULE_LABELS }));
app.post("/api/alerts/:id/ack", (req, res) => {
  const ok = ackAlert(String(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});
app.post(
  "/api/alerts/check",
  wrap(async (_req, res) => {
    await runAlerts(ha);
    res.json(alertsView());
  }),
);

// ---------- audit ----------
app.get("/api/audit", (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
  res.json({ entries: readAudit(limit), persisted: dataWritable() });
});

// ---------- settings (Telegram token is write-only) ----------
app.get("/api/settings", (_req, res) => res.json({ ...publicSettings(), data_writable: dataWritable() }));
app.post("/api/settings", (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  if (body.confirmed !== true) {
    audit(req, { kind: "settings", ok: false, summary: "Settings change rejected (not confirmed)" });
    res.status(428).json({ error: "Confirmation required" });
    return;
  }
  const { changed, errors } = updateSettings((body.patch || {}) as Record<string, unknown>);
  if (errors.length) {
    audit(req, { kind: "settings", ok: false, summary: "Settings change rejected", error: errors.join("; ") });
    res.status(400).json({ error: errors.join("; ") });
    return;
  }
  // Log which fields changed and their new values, except the bot token (never logged).
  const s = getSettings() as unknown as Record<string, Record<string, unknown>>;
  const detail: Record<string, unknown> = {};
  for (const c of changed) {
    if (c.startsWith("telegram.bot_token")) continue;
    const [a, b, d] = c.split(".");
    detail[c] = d ? (s[a]?.[b] as Record<string, unknown>)?.[d] : s[a]?.[b];
  }
  audit(req, { kind: "settings", ok: true, summary: changed.length ? `Settings: ${changed.join(", ")}` : "Settings: no change", detail });
  res.json({ ok: true, changed, settings: publicSettings() });
});
app.post(
  "/api/settings/telegram/test",
  wrap(async (req, res) => {
    try {
      await sendTelegram("✅ Hearth test message — Telegram alerts are working.");
      audit(req, { kind: "notify-test", ok: true, summary: "Telegram test message sent" });
      res.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      audit(req, { kind: "notify-test", ok: false, summary: "Telegram test message failed", error: msg });
      res.status(400).json({ error: msg });
    }
  }),
);
app.post(
  "/api/settings/telegram/detect",
  wrap(async (_req, res) => {
    try {
      const [bot, chats] = await Promise.all([botInfo().catch(() => null), detectChats()]);
      res.json({ bot, chats });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ---------- web push ----------
app.get("/api/push/key", (_req, res) => res.json({ publicKey: ensureVapid().publicKey }));
app.get("/api/push/subscriptions", (_req, res) => res.json({ subscriptions: subscriptionSummary() }));
app.post("/api/push/status", (req, res) => res.json({ subscribed: hasSubscription(String(req.body?.endpoint || "")) }));
app.post("/api/push/subscribe", (req, res) => {
  const sub = req.body?.subscription;
  if (!isValidSub(sub)) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }
  const device = typeof req.body?.device === "string" ? req.body.device.slice(0, 60) : null;
  const n = addSubscription(sub, device, typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 160) : null);
  audit(req, { kind: "push", ok: true, summary: `Push notifications enabled${device ? ` on ${device}` : ""}`, detail: { devices: n } });
  res.json({ ok: true, devices: n });
});
app.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "");
  const removed = removeSubscription(endpoint);
  audit(req, { kind: "push", ok: true, summary: "Push notifications disabled on a device", detail: { removed } });
  res.json({ ok: true, removed });
});
app.post(
  "/api/push/test",
  wrap(async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : undefined;
    const r = await sendPush({ title: "Hearth test", body: "Push notifications are working on this device.", url: "/settings", tag: "hearth-test" }, endpoint);
    audit(req, { kind: "notify-test", ok: r.sent > 0, summary: `Push test: ${r.sent} sent, ${r.failed} failed` });
    res.status(r.sent > 0 ? 200 : 400).json(r.sent > 0 ? { ok: true, ...r } : { error: r.total ? "Push service rejected the message" : "No subscription for this device", ...r });
  }),
);

function downsampleHistory(raw: unknown, maxPoints: number) {
  if (!Array.isArray(raw)) return [];
  const out: { entity_id: string; points: { t: string; v: number | string }[] }[] = [];
  for (const series of raw as Record<string, unknown>[][]) {
    if (!Array.isArray(series) || !series.length) continue;
    const entity_id = String(series[0].entity_id || "");
    const points = series.map((p) => {
      const t = String(p.last_changed || p.last_updated || p.lu || p.time || "");
      const state = p.state ?? p.s;
      const n = Number(state);
      return { t, v: Number.isFinite(n) ? n : String(state ?? "") };
    });
    const step = points.length <= maxPoints ? 1 : Math.ceil(points.length / maxPoints);
    out.push({
      entity_id,
      points: points.filter((_, i) => i % step === 0 || i === points.length - 1),
    });
  }
  return out;
}

// Production static frontend
const publicDirCandidates = [
  path.resolve(__dirname, "../public"),
  path.resolve(__dirname, "../../web/dist"),
];
const publicDir = publicDirCandidates.find((d) => fs.existsSync(path.join(d, "index.html")));
if (publicDir) {
  app.use(
    express.static(publicDir, {
      setHeaders(res, file) {
        const base = path.basename(file);
        if (base === "sw.js" || base === "index.html" || base.endsWith(".webmanifest")) res.setHeader("Cache-Control", "no-cache");
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

if (ALERTS_ENABLED) startAlertEngine(ha);
if (process.env.POWERPRINT !== "off") {
  onDetected(async () => {
    const t = takeRunsToNotify();
    if (!t.runs.length) return;
    const r = await notifyPowerPrint(t.runs);
    // mark as offered when sent, or when the rule is off (so switching it on later doesn't replay old runs)
    if (r.sent || r.reason === "rule off" || r.reason === "no channel enabled") t.mark();
  });
  startPowerPrint(ha);
}

ha.start()
  .then(() => {
    console.log(`Connected to Home Assistant, cached ${Object.keys(ha.getAll()).length} entities`);
  })
  .catch((err) => {
    console.error("Initial HA connection failed:", err.message);
  });

app.listen(PORT, HOST, () => {
  console.log(`Hearth Energy listening on http://${HOST}:${PORT}`);
});
