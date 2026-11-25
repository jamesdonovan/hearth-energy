import { Link } from "react-router-dom";
import { fetchDayCost, type DayCost } from "../lib/api";
import { usePoll } from "../lib/store";
import { Card, CardHeader } from "./Card";

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toFixed(2)}`);

function Bar({ d }: { d: DayCost }) {
  const max = Math.max(d.budget_gbp, d.predicted_gbp ?? 0, 0.01) * 1.1;
  const actual = Math.max(0, d.actual_gbp ?? 0);
  const pred = Math.max(actual, d.predicted_gbp ?? actual);
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="relative mt-3 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--bg-elev)" }}>
      <div className={`absolute inset-y-0 left-0 ${d.over ? "bg-gridin/35" : "bg-batt/30"}`} style={{ width: pct(pred) }} />
      <div className={`absolute inset-y-0 left-0 ${d.over ? "bg-gridin" : "bg-batt"}`} style={{ width: pct(actual) }} />
      <div className="absolute inset-y-[-2px] w-0.5" style={{ left: pct(d.budget_gbp), background: "var(--text)" }} title={`Budget ${gbp(d.budget_gbp)}`} />
    </div>
  );
}

/** One-line version for the Overview cost tile. */
export function DayBudgetLine() {
  const { data: d } = usePoll(fetchDayCost, 120000);
  if (!d || d.predicted_gbp == null) return null;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span style={{ color: "var(--muted)" }}>Heading for</span>
        <span className={`num font-medium ${d.over ? "text-gridin" : ""}`}>
          {gbp(d.predicted_gbp)} <span className="font-sans text-xs" style={{ color: "var(--muted)" }}>/ {gbp(d.budget_gbp)} budget</span>
        </span>
      </div>
      <Bar d={d} />
    </div>
  );
}

/** Full card for Energy → Financials. */
export function DayBudgetCard() {
  const { data: d, err } = usePoll(fetchDayCost, 120000);
  return (
    <Card>
      <CardHeader
        label="Today · predicted vs budget"
        title={d?.predicted_gbp != null ? `Heading for ${gbp(d.predicted_gbp)}` : "Today's predicted cost"}
        right={
          d ? (
            <span className={`rounded-full px-2.5 py-1 text-xs ${d.over ? "bg-gridin/15 text-gridin" : "bg-batt/15 text-batt"}`}>
              {d.over ? `${gbp(d.over_by_gbp)} over budget` : `${gbp(d.budget_gbp - (d.predicted_gbp ?? 0))} under budget`}
            </span>
          ) : null
        }
      />
      {err && <p className="text-sm text-gridin">{err}</p>}
      {d && (
        <>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="label">So far</div>
              <div className="num text-xl">{gbp(d.actual_gbp)}</div>
            </div>
            <div>
              <div className="label">To midnight</div>
              <div className="num text-xl">{gbp(d.remaining_gbp)}</div>
            </div>
            <div>
              <div className="label">Budget</div>
              <div className="num text-xl">{gbp(d.budget_gbp)}</div>
            </div>
          </div>
          <Bar d={d} />
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Net of export, including the {d.standing_gbp != null ? `${gbp(d.standing_gbp)} ` : ""}standing charge. So far = <span className="num">predbat.cost_today</span>; day total = Predbat's plan cost to midnight (<span className="num">predbat.best_metric</span> → <span className="num">today</span>). Budget and alert step are in{" "}
            <Link to="/settings" className="text-gridout">Settings</Link>.
          </p>
        </>
      )}
    </Card>
  );
}
