import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, KeyRound, Monitor, Send, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import {
  deviceName,
  fetchAudit,
  fetchSettings,
  getJson,
  postJson,
  saveSettings,
  setDeviceName,
  type AuditEntry,
  type RuleId,
  type SettingsData,
  type Thresholds,
} from "../lib/api";
import { disablePush, enablePush, isIos, isStandalone, pushStatus, testPush } from "../lib/push";
import { getThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";
import { fmtTimeDate } from "../lib/format";
import { Card, CardHeader } from "../components/Card";
import { ApplianceEditor } from "../components/ApplianceEditor";
import { VariablesEditor } from "../components/VariablesEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";

const RULE_IDS: RuleId[] = ["planned_charge_missed", "iog_extra_slot", "pw_low", "export_spike", "daily_cost", "car_data_lost", "powerprint_confirm"];

type Draft = {
  rules: Record<RuleId, boolean>;
  thresholds: Thresholds;
  webpush: { enabled: boolean; types: Record<RuleId, boolean> };
  telegram: { enabled: boolean; chat_id: string; types: Record<RuleId, boolean> };
  newToken: string | null; // null = unchanged, "" = clear
};

function toDraft(s: SettingsData): Draft {
  return {
    rules: { ...s.rules },
    thresholds: { ...s.thresholds },
    webpush: { enabled: s.webpush.enabled, types: { ...s.webpush.types } },
    telegram: { enabled: s.telegram.enabled, chat_id: s.telegram.chat_id, types: { ...s.telegram.types } },
    newToken: null,
  };
}

const TH_FIELDS: { k: keyof Thresholds; label: string; unit: string; step?: number; hint: string; money?: boolean }[] = [
  { k: "daily_cost_gbp", label: "Daily cost budget", unit: "per day", money: true, hint: "Alert when Predbat's predicted net cost for today (so far + to midnight, incl. standing charge) goes over this." },
  { k: "daily_cost_step_gbp", label: "Budget re-alert step", unit: "", money: true, hint: "Alert again only if the prediction rises by another this much the same day." },
  { k: "car_lost_min", label: "Car data lost after", unit: "min", hint: "Alert when a car has reported unknown/unavailable for this long (push is off by default)." },
  { k: "export_spike_p", label: "Export spike", unit: "p/kWh", step: 0.5, hint: "Alert when Agile Outgoing reaches this (now or within 3 h)." },
  { k: "pw_low_pct", label: "Powerwall low (evening)", unit: "%", hint: "During the peak rate, alert if the Powerwall is below this with more than 30 min to 23:30." },
  { k: "pw_morning_min_pct", label: "Powerwall after night charge", unit: "%", hint: "Alert if below this between 05:30 and 07:00." },
  { k: "charge_min_fraction", label: "Overnight charge minimum", unit: "× plan", step: 0.05, hint: "Alert if a car's charger delivered less than this fraction of Predbat's planned kWh." },
  { k: "cooldown_min", label: "Cooldown per alert type", unit: "min", hint: "Don't notify the same kind of alert again within this time." },
  { k: "max_per_hour", label: "Max notifications", unit: "per hour", hint: "Global rate limit across all alert types." },
];

export function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSettings(s);
        setDraft(toDraft(s));
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const changes = useMemo(() => (settings && draft ? diff(settings, draft) : []), [settings, draft]);

  async function save() {
    if (!draft || !settings) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const patch: Record<string, unknown> = {
        rules: draft.rules,
        thresholds: draft.thresholds,
        webpush: draft.webpush,
        telegram: { ...draft.telegram, ...(draft.newToken !== null ? { bot_token: draft.newToken } : {}) },
      };
      const r = await saveSettings(patch);
      setSettings(r.settings);
      setDraft(toDraft(r.settings));
      setConfirm(false);
      setFlash(r.changed.length ? `Saved ${r.changed.length} change${r.changed.length > 1 ? "s" : ""}` : "No changes");
      setAuditKey((k) => k + 1);
      setTimeout(() => setFlash(null), 4000);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (err) return <p className="text-gridin">{err}</p>;
  if (!settings || !draft) return <p style={{ color: "var(--muted)" }}>Loading settings…</p>;

  const set = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const n = structuredClone(d);
      fn(n);
      return n;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Variables, alerts, notifications, display and the audit log. Saved on the Hearth server{settings.data_writable ? "" : " (warning: the data folder is not writable, so changes won't persist)"}.
          </p>
        </div>
      </div>

      <VariablesEditor />

      <PushCard />

      <ApplianceEditor />

      <Card>
        <CardHeader label="Alerts" title="What to alert on, and where" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="label text-left">
                <th className="pb-2 font-medium">Alert</th>
                <th className="pb-2 text-center font-medium">On</th>
                <th className="pb-2 text-center font-medium">Push</th>
                <th className="pb-2 text-center font-medium">Telegram</th>
              </tr>
            </thead>
            <tbody>
              {RULE_IDS.map((r) => (
                <tr key={r} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="py-2 pr-3">{settings.rule_labels[r]}</td>
                  <td className="py-2 text-center"><Check on={draft.rules[r]} onChange={(v) => set((d) => void (d.rules[r] = v))} label={`${r} enabled`} /></td>
                  <td className="py-2 text-center"><Check on={draft.webpush.types[r]} disabled={!draft.rules[r] || !draft.webpush.enabled} onChange={(v) => set((d) => void (d.webpush.types[r] = v))} label={`${r} push`} /></td>
                  <td className="py-2 text-center"><Check on={draft.telegram.types[r]} disabled={!draft.rules[r] || !draft.telegram.enabled} onChange={(v) => set((d) => void (d.telegram.types[r] = v))} label={`${r} telegram`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <Toggle label="Web push channel" on={draft.webpush.enabled} onChange={(v) => set((d) => void (d.webpush.enabled = v))} />
          <Toggle label="Telegram channel" on={draft.telegram.enabled} onChange={(v) => set((d) => void (d.telegram.enabled = v))} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TH_FIELDS.map((f) => (
            <label key={f.k} className="block">
              <div className="mb-1 text-sm font-medium">{f.label}</div>
              <div className="flex items-center gap-2">
                {f.money ? (
                  <MoneyInput value={Number(draft.thresholds[f.k])} onChange={(n) => set((d) => void ((d.thresholds as Record<string, number | string>)[f.k] = n))} />
                ) : (
                <input
                  type="number"
                  step={f.step ?? 1}
                  value={String(draft.thresholds[f.k])}
                  onChange={(e) => set((d) => void ((d.thresholds as Record<string, number | string>)[f.k] = Number(e.target.value)))}
                  className="w-28 rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
                />
                )}
                <span className="text-xs" style={{ color: "var(--muted)" }}>{f.unit}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{f.hint}</p>
            </label>
          ))}
          <label className="block">
            <div className="mb-1 text-sm font-medium">Quiet hours</div>
            <input
              type="text"
              placeholder="e.g. 23:00-07:00"
              value={draft.thresholds.quiet_hours}
              onChange={(e) => set((d) => void (d.thresholds.quiet_hours = e.target.value))}
              className="w-40 rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>No notifications in this window (alerts still show here). Leave blank for none.</p>
          </label>
        </div>
      </Card>

      <TelegramCard settings={settings} draft={draft} set={set} dirty={changes.length > 0} onAudit={() => setAuditKey((k) => k + 1)} />

      {(changes.length > 0 || flash) && (
      <div className="sticky bottom-20 z-20 md:bottom-4">
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <span className="text-sm" style={{ color: changes.length ? "var(--text)" : "var(--muted)" }}>
            {flash || (changes.length ? `${changes.length} unsaved change${changes.length > 1 ? "s" : ""}` : "No unsaved changes")}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={!changes.length} onClick={() => setDraft(toDraft(settings))} className="rounded-xl px-4 py-2 text-sm disabled:opacity-40" style={{ color: "var(--muted)" }}>
              Discard
            </button>
            <button type="button" disabled={!changes.length} onClick={() => { setSaveErr(null); setConfirm(true); }} className="rounded-xl bg-batt px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40">
              Save settings
            </button>
          </div>
        </div>
      </div>
      )}

      <DisplayCard />
      <AuditCard refreshKey={auditKey} />

      <ConfirmDialog
        open={confirm}
        title="Save these settings?"
        body={
          <ul className="list-disc space-y-1 pl-5">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        }
        confirmLabel="Save"
        busy={busy}
        error={saveErr}
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      />
    </div>
  );
}

/** £x.xx input: free typing, formatted to 2 dp on blur. */
function MoneyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) ? value.toFixed(2) : "");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(Number.isFinite(value) ? value.toFixed(2) : "");
  }, [value, focus]);
  return (
    <div className="flex items-center rounded-xl px-3 py-2 text-sm" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
      <span style={{ color: "var(--muted)" }}>£</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "");
          setText(v);
          const n = Math.round(Number(v) * 100) / 100;
          if (v !== "" && Number.isFinite(n)) onChange(n);
        }}
        className="w-20 bg-transparent pl-1 outline-none"
        style={{ color: "var(--text)" }}
        aria-label="Amount in pounds"
      />
    </div>
  );
}

function diff(s: SettingsData, d: Draft): string[] {
  const out: string[] = [];
  for (const r of RULE_IDS) {
    if (s.rules[r] !== d.rules[r]) out.push(`${s.rule_labels[r]}: ${d.rules[r] ? "on" : "off"}`);
    if (s.webpush.types[r] !== d.webpush.types[r]) out.push(`Push for “${s.rule_labels[r]}”: ${d.webpush.types[r] ? "on" : "off"}`);
    if (s.telegram.types[r] !== d.telegram.types[r]) out.push(`Telegram for “${s.rule_labels[r]}”: ${d.telegram.types[r] ? "on" : "off"}`);
  }
  if (s.webpush.enabled !== d.webpush.enabled) out.push(`Web push channel: ${d.webpush.enabled ? "on" : "off"}`);
  if (s.telegram.enabled !== d.telegram.enabled) out.push(`Telegram channel: ${d.telegram.enabled ? "on" : "off"}`);
  if (s.telegram.chat_id !== d.telegram.chat_id) out.push(`Telegram chat ID: ${d.telegram.chat_id || "(cleared)"}`);
  if (d.newToken !== null) out.push(d.newToken ? "Telegram bot token: replaced (value hidden)" : "Telegram bot token: cleared");
  for (const f of TH_FIELDS)
    if (s.thresholds[f.k] !== d.thresholds[f.k])
      out.push(f.money ? `${f.label}: £${Number(s.thresholds[f.k]).toFixed(2)} → £${Number(d.thresholds[f.k]).toFixed(2)}` : `${f.label}: ${s.thresholds[f.k]} → ${d.thresholds[f.k]} ${f.unit}`);
  if (s.thresholds.quiet_hours !== d.thresholds.quiet_hours) out.push(`Quiet hours: ${d.thresholds.quiet_hours || "none"}`);
  return out;
}

// ---------------- push ----------------

function PushCard() {
  const [st, setSt] = useState<{ supported: boolean; permission: string; subscribed: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ device: string | null; ua: string | null; added: string; last_ok: string | null; last_error: string | null; host: string }[]>([]);
  const refresh = () => {
    pushStatus().then(setSt).catch(() => setSt({ supported: false, permission: "unsupported", subscribed: false }));
    getJson<{ subscriptions: typeof devices }>("/api/push/subscriptions").then((r) => setDevices(r.subscriptions)).catch(() => {});
  };
  useEffect(refresh, []);
  const iosNeedsInstall = isIos() && !isStandalone();

  async function toggle() {
    setBusy(true);
    setMsg(null);
    try {
      if (st?.subscribed) {
        await disablePush();
        setMsg("Notifications turned off on this device.");
      } else {
        await enablePush();
        setMsg("Notifications are on for this device.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      refresh();
    }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await testPush();
      setMsg(r.sent ? "Test sent. It should appear in a few seconds." : "Nothing was sent.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <Card>
      <CardHeader label="This device" title="Push notifications" right={st?.subscribed ? <Bell size={18} className="text-batt" /> : <BellOff size={18} style={{ color: "var(--muted)" }} />} />
      {iosNeedsInstall ? (
        <div className="rounded-xl p-3 text-sm" style={{ background: "var(--bg-elev)" }}>
          On iPhone and iPad, notifications only work from the installed app. In Safari tap <b>Share → Add to Home Screen</b>, open Hearth from the home screen, then come back here and enable notifications.
        </div>
      ) : !st ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Checking…</p>
      ) : !st.supported ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>This browser doesn't support web push. Use Chrome, Edge, Firefox or the installed app on iOS 16.4+ and Android.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={toggle} className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${st.subscribed ? "" : "bg-batt text-ink-950"}`} style={st.subscribed ? { background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" } : undefined}>
            {st.subscribed ? "Disable notifications" : "Enable notifications"}
          </button>
          <button type="button" disabled={busy || !st.subscribed} onClick={test} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm disabled:opacity-40" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
            <Send size={14} /> Send test
          </button>
          <span className="text-xs" style={{ color: "var(--muted)" }}>Permission: {st.permission}{st.permission === "denied" ? " — re-allow notifications for this site in the browser/OS settings" : ""}</span>
        </div>
      )}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
      {devices.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2">Devices receiving alerts</div>
          <ul className="space-y-1 text-sm">
            {devices.map((d, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg-elev)" }}>
                <span>{d.device || "Device"} <span className="text-xs" style={{ color: "var(--muted)" }}>via {d.host}</span></span>
                <span className="text-xs" style={{ color: d.last_error ? "#f07167" : "var(--muted)" }}>{d.last_error ? `Error: ${d.last_error}` : d.last_ok ? `Last delivered ${fmtTimeDate(d.last_ok)}` : `Added ${fmtTimeDate(d.added)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------- telegram ----------------

function TelegramCard({ settings, draft, set, dirty, onAudit }: { settings: SettingsData; draft: Draft; set: (fn: (d: Draft) => void) => void; dirty: boolean; onAudit: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chats, setChats] = useState<{ id: string; type: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const tg = settings.telegram;

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      await postJson("/api/settings/telegram/test");
      setMsg("Test message sent. Check Telegram.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      onAudit();
    }
  }
  async function detect() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<{ bot: { username: string | null } | null; chats: { id: string; type: string; name: string }[] }>("/api/settings/telegram/detect");
      setChats(r.chats);
      if (!r.chats.length) setMsg(`No messages found. Send any message to ${r.bot?.username ? "@" + r.bot.username : "your bot"} in Telegram, then press Detect again.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader label="Optional" title="Telegram alerts" right={<KeyRound size={18} style={{ color: "var(--muted)" }} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-sm font-medium">Bot token</div>
            {draft.newToken !== null || replacing ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="123456789:AA…"
                  value={draft.newToken ?? ""}
                  onChange={(e) => set((d) => void (d.newToken = e.target.value))}
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
                />
                <button type="button" onClick={() => { setReplacing(false); set((d) => void (d.newToken = null)); }} className="rounded-xl px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="num rounded-lg px-3 py-2 text-sm" style={{ background: "var(--bg-elev)" }}>{tg.bot_token_set ? tg.bot_token_masked : "Not set"}</span>
                <button type="button" onClick={() => setReplacing(true)} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
                  {tg.bot_token_set ? "Replace" : "Add token"}
                </button>
                {tg.bot_token_set && (
                  <button type="button" onClick={() => set((d) => void (d.newToken = ""))} className="text-xs text-gridin">
                    Clear
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Write-only: stored on the Hearth server (chmod 600) and never sent back to the browser.</p>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Chat ID</div>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 123456789"
                value={draft.telegram.chat_id}
                onChange={(e) => set((d) => void (d.telegram.chat_id = e.target.value.trim()))}
                className="w-48 rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
              />
              <button type="button" disabled={busy || !tg.bot_token_set} onClick={detect} className="rounded-xl px-3 py-2 text-sm disabled:opacity-40" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
                Detect chat ID
              </button>
            </div>
            {chats && chats.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {chats.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "var(--bg-elev)" }}>
                    <span>{c.name || c.type} <span className="num text-xs" style={{ color: "var(--muted)" }}>{c.id}</span></span>
                    <button type="button" className="text-xs text-gridout" onClick={() => set((d) => void (d.telegram.chat_id = c.id))}>Use</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || dirty || !tg.bot_token_set || !tg.chat_id} onClick={test} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm disabled:opacity-40" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
              <Send size={14} /> Send test message
            </button>
            {dirty && <span className="text-xs" style={{ color: "var(--muted)" }}>Save first, then test.</span>}
          </div>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
        <div className="rounded-xl p-4 text-sm leading-relaxed" style={{ background: "var(--bg-elev)", color: "var(--muted)" }}>
          <div className="mb-2 font-medium" style={{ color: "var(--text)" }}>Setting up a bot (2 minutes)</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In Telegram, open <b>@BotFather</b> and send <code>/newbot</code>. Pick a name and a username ending in “bot”.</li>
            <li>BotFather replies with a token like <code>123456789:AA…</code>. Paste it into <b>Bot token</b> above.</li>
            <li>Open your new bot and send it any message (for example “hi”). Bots can't message you first.</li>
            <li>Save, then press <b>Detect chat ID</b> and choose your chat, or use a group's ID (negative number) after adding the bot to it.</li>
            <li>Turn on the Telegram channel, save, and press <b>Send test message</b>.</li>
          </ol>
        </div>
      </div>
    </Card>
  );
}

// ---------------- display ----------------

function DisplayCard() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const [name, setName] = useState(deviceName());
  const [rotate, setRotate] = useState(() => Number(localStorage.getItem("hearth-wall-rotate") || 20));
  return (
    <Card>
      <CardHeader label="This device" title="Display" right={<Monitor size={18} style={{ color: "var(--muted)" }} />} />
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <div className="mb-2 text-sm font-medium">Theme</div>
          <div className="flex rounded-full p-1" style={{ background: "var(--bg-elev)" }}>
            {(["dark", "light", "system"] as ThemeMode[]).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setThemeMode(m); }} className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium capitalize ${mode === m ? "bg-white/10" : ""}`} style={{ color: mode === m ? "var(--text)" : "var(--muted)" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <div className="mb-2 text-sm font-medium">Device name</div>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDeviceName(e.target.value); }}
            className="w-full rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Shown in the audit log and the push device list.</p>
        </label>
        <div>
          <div className="mb-2 text-sm font-medium">Wall tablet mode</div>
          <div className="flex items-center gap-2 text-sm">
            <span style={{ color: "var(--muted)" }}>Rotate every</span>
            <select value={rotate} onChange={(e) => { setRotate(Number(e.target.value)); localStorage.setItem("hearth-wall-rotate", e.target.value); }} className="rounded-xl px-2 py-1.5 text-sm" style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}>
              {[0, 10, 20, 30, 60].map((s) => (
                <option key={s} value={s}>{s ? `${s}s` : "never"}</option>
              ))}
            </select>
          </div>
          <Link to="/wall" className="mt-3 inline-block rounded-xl bg-solar px-4 py-2 text-sm font-semibold text-ink-950">Open wall mode</Link>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Large, read-only, auto-rotating panels. Bookmark <code>/wall</code> on the tablet.</p>
        </div>
      </div>
    </Card>
  );
}

// ---------------- audit ----------------

function AuditCard({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [filter, setFilter] = useState<"all" | "action" | "settings">("all");
  useEffect(() => {
    fetchAudit(300)
      .then((r) => {
        setEntries(r.entries);
        setPersisted(r.persisted);
      })
      .catch(() => setEntries([]));
  }, [refreshKey]);
  const shown = (entries || []).filter((e) => filter === "all" || e.kind === filter || (filter === "settings" && e.kind !== "action"));
  return (
    <Card>
      <CardHeader
        label="Audit log"
        title="Who changed what"
        right={
          <div className="flex rounded-full p-1" style={{ background: "var(--bg-elev)" }}>
            {(["all", "action", "settings"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${filter === f ? "bg-white/10" : ""}`} style={{ color: filter === f ? "var(--text)" : "var(--muted)" }}>
                {f === "action" ? "controls" : f}
              </button>
            ))}
          </div>
        }
      />
      {!persisted && <p className="mb-3 text-xs text-gridin">The data folder isn't writable, so the audit log isn't being saved.</p>}
      {!entries ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : !shown.length ? (
        <p className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}><Shield size={14} /> Nothing recorded yet. Every control press and settings change will appear here.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "var(--card)" }}>
              <tr className="label text-left">
                <th className="pb-2 pr-3 font-medium">When</th>
                <th className="pb-2 pr-3 font-medium">Who / device</th>
                <th className="pb-2 pr-3 font-medium">What</th>
                <th className="pb-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                  <td className="num whitespace-nowrap py-2 pr-3 text-xs">{fmtTimeDate(e.at)}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: "var(--muted)" }}>
                    {e.who.user || e.who.device || "Unknown"}
                    {e.who.user && e.who.device ? ` · ${e.who.device}` : ""}
                    <div>{[e.who.ua, e.who.ip].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {e.summary}
                    {e.detail?.before != null && <div className="text-xs" style={{ color: "var(--muted)" }}>was {String(e.detail.before)}</div>}
                  </td>
                  <td className="py-2 text-xs">
                    <span className={e.ok ? "text-batt" : "text-gridin"}>{e.ok ? (e.dry_run ? "dry run" : "ok") : "rejected"}</span>
                    {e.error && <div style={{ color: "var(--muted)" }}>{e.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------- inputs ----------------

function Check({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <input type="checkbox" aria-label={label} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-400 disabled:opacity-30" />;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-batt" : "bg-white/15"}`} aria-pressed={on}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "left-5" : "left-0.5"}`} />
      </button>
      <span>{label}</span>
    </label>
  );
}
