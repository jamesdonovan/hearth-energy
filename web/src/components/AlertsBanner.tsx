import { AlertTriangle, BellRing, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useHa } from "../lib/store";
import { fmtTimeDate } from "../lib/format";

export function AlertsBanner() {
  const { alerts, ack } = useHa();
  const loc = useLocation();
  if (!alerts?.active.length || loc.pathname === "/alerts") return null;
  const shown = alerts.active.slice(0, 2);
  return (
    <div className="mb-6 space-y-2">
      {shown.map((a) => (
        <div
          key={a.id}
          className={`card flex items-start gap-3 p-4 ${a.severity === "warning" ? "ring-1 ring-gridin/50" : "ring-1 ring-solar/40"}`}
        >
          <div className={`mt-0.5 ${a.severity === "warning" ? "text-gridin" : "text-solar"}`}>
            {a.severity === "warning" ? <AlertTriangle size={18} /> : <BellRing size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{a.title}</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{fmtTimeDate(a.raised_at)}</span>
            </div>
            <p className="mt-0.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{a.body}</p>
          </div>
          <button type="button" onClick={() => ack(a.id)} className="rounded-lg p-1.5" style={{ color: "var(--muted)" }} aria-label="Dismiss alert" title="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
      {alerts.active.length > shown.length && (
        <Link to="/alerts" className="block text-right text-xs text-gridout">
          +{alerts.active.length - shown.length} more alerts →
        </Link>
      )}
    </div>
  );
}
