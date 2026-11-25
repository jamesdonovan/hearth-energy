import { AlertTriangle, BellRing, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useHa } from "../lib/store";
import { fmtTimeDate } from "../lib/format";
import { Card, CardHeader } from "../components/Card";
import type { Alert } from "../lib/api";

export function Alerts() {
  const { alerts, ack } = useHa();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Alerts</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Checked every couple of minutes on the server, so they still fire when no one has the dashboard open.
          </p>
        </div>
        <Link to="/settings" className="text-sm text-gridout">Notification settings →</Link>
      </div>
      <Card>
        <CardHeader label="Now" title={alerts?.active.length ? `${alerts.active.length} active` : "All clear"} right={<span className="text-xs" style={{ color: "var(--muted)" }}>{alerts?.last_run ? `Last check ${fmtTimeDate(alerts.last_run)}` : ""}</span>} />
        {alerts?.last_error && <p className="mb-3 text-xs text-gridin">Some checks failed: {alerts.last_error}</p>}
        {alerts?.active.length ? (
          <ul className="space-y-3">
            {alerts.active.map((a) => (
              <AlertRow key={a.id} a={a} onAck={() => ack(a.id)} />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <CheckCircle2 size={16} className="text-batt" /> Nothing needs your attention.
          </div>
        )}
        {!!alerts?.acked.length && (
          <div className="mt-5">
            <div className="label mb-2">Dismissed (still true)</div>
            <ul className="space-y-2">
              {alerts.acked.map((a) => (
                <AlertRow key={a.id} a={a} muted />
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader label="History" title="Recent alerts" />
        {alerts?.history.length ? (
          <ul className="space-y-2">
            {alerts.history.map((a) => (
              <AlertRow key={a.id} a={a} muted />
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No resolved alerts yet.</p>
        )}
      </Card>
    </div>
  );
}

function AlertRow({ a, onAck, muted }: { a: Alert; onAck?: () => void; muted?: boolean }) {
  const n = a.notified;
  const sent = [n?.push && n.push.sent > 0 ? `push ×${n.push.sent}` : null, n?.telegram === "sent" ? "Telegram" : null].filter(Boolean).join(", ");
  return (
    <li className={`flex items-start gap-3 rounded-xl p-3 ${muted ? "opacity-75" : ""}`} style={{ background: "var(--bg-elev)" }}>
      <div className={`mt-0.5 ${a.severity === "warning" ? "text-gridin" : "text-solar"}`}>{a.severity === "warning" ? <AlertTriangle size={18} /> : <BellRing size={18} />}</div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{a.title}</div>
        <p className="mt-0.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{a.body}</p>
        <div className="mt-1 text-[11px]" style={{ color: "var(--faint)" }}>
          Raised {fmtTimeDate(a.raised_at)}
          {a.resolved_at ? ` · cleared ${fmtTimeDate(a.resolved_at)}` : ""}
          {sent ? ` · sent via ${sent}` : n?.suppressed ? ` · not sent: ${n.suppressed}` : " · in-app only"}
          {n?.telegram && n.telegram !== "sent" ? ` · Telegram error: ${n.telegram}` : ""}
        </div>
      </div>
      {onAck && (
        <button type="button" onClick={onAck} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}>
          Dismiss
        </button>
      )}
    </li>
  );
}
