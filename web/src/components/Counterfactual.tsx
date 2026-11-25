import { useEffect, useState } from "react";
import { fetchCounterfactual, type CounterfactualData, type PeriodSel } from "../lib/api";
import { fmtGbp } from "../lib/format";
import { Card, CardHeader, Metric } from "./Card";

const muted = { color: "var(--muted)" } as const;

function Row({ k, sub, v, strong, tone }: { k: string; sub?: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "border-t border-white/10 font-medium" : ""}`}>
      <div className="min-w-0">
        <div className="text-sm">{k}</div>
        {sub && <div className="text-xs" style={muted}>{sub}</div>}
      </div>
      <div className={`num shrink-0 text-sm ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

const kwh = (n: number) => `${n.toFixed(1)} kWh`;

export function CounterfactualCard({ period, periodKey }: { period: PeriodSel; periodKey: string }) {
  const [d, setD] = useState<CounterfactualData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setD(null);
    fetchCounterfactual(period)
      .then((x) => live && (setD(x), setErr(null)))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  return (
    <Card>
      <CardHeader label={`Comparator · ${d ? (d.period.key === "custom" ? `${d.days} days` : d.period.label) : "…"}`} title="Without solar & Powerwall" />
      {err ? (
        <p className="text-sm" style={muted}>Couldn’t calculate: {err}</p>
      ) : !d ? (
        <p className="text-sm" style={muted}>Calculating from Powerwall history… (long periods can take up to ~20 s)</p>
      ) : d.coverage.days_with_data === 0 ? (
        <p className="text-sm" style={muted}>{d.coverage.note ?? "No Powerwall energy history in this period."}</p>
      ) : (
        <div className="space-y-5">
          {d.coverage.partial && d.coverage.note && (
            <div className="rounded-xl px-4 py-2 text-sm" style={{ background: "rgba(245, 180, 60, 0.12)", color: "#f5b43c" }}>
              {d.coverage.note}
            </div>
          )}
          <p className="text-sm" style={muted}>
            Every kWh the house and both cars used ({kwh(d.counterfactual.load_kwh)}) bought from the grid on the same Intelligent Octopus Go tariff — no
            Powerwall charging, no export.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Without solar & Powerwall" value={fmtGbp(d.counterfactual.total_gbp)} hint={`avg ${d.counterfactual.avg_rate_p?.toFixed(1) ?? "—"}p/kWh + standing`} tone="gridin" />
            <Metric label="Actual net cost" value={fmtGbp(d.actual.net_gbp)} hint="import − export, incl. standing" />
            <Metric label="Saving" value={fmtGbp(d.saving.gbp)} hint={d.actual.net_gbp < 0 ? "actual was a net credit" : d.saving.pct != null ? `${d.saving.pct.toFixed(0)}% lower` : undefined} tone="solar" />
            <Metric
              label="Extrapolation"
              value={d.projection.per_month_gbp != null ? `${fmtGbp(d.projection.per_month_gbp)}/mo` : "—"}
              hint={d.projection.per_year_gbp != null ? `≈ ${fmtGbp(d.projection.per_year_gbp)}/yr if every day were like these ${d.projection.based_on_days.toFixed(1)} days` : undefined}
              tone="batt"
            />
          </div>
          <p className="text-xs" style={muted}>
            Standing charge {fmtGbp(d.counterfactual.standing_gbp)} is included in both figures, so it doesn’t change the saving.
            {d.projection.per_day_gbp != null && ` Extrapolation = ${fmtGbp(d.projection.per_day_gbp)}/day × 30.4 or × 365 — not a forecast; winter and summer solar differ a lot.`}
          </p>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide" style={muted}>Where the saving comes from</div>
            <Row
              k="Solar used directly"
              sub={`${kwh(d.breakdown.solar_self_consumption_kwh)} that would otherwise have been imported`}
              v={fmtGbp(d.breakdown.solar_self_consumption_gbp)}
            />
            <Row
              k="Battery time-shift"
              sub={`${kwh(d.breakdown.battery_to_home_kwh)} from the Powerwall worth ${fmtGbp(d.breakdown.battery_to_home_value_gbp)}, minus ${fmtGbp(d.breakdown.battery_grid_charge_cost_gbp)} to charge ${kwh(d.breakdown.battery_grid_charge_kwh)} from the grid`}
              v={fmtGbp(d.breakdown.battery_time_shift_gbp)}
            />
            <Row k="Export income" sub="Octopus export earnings (solar and battery)" v={fmtGbp(d.breakdown.export_income_gbp)} />
            <Row
              k="Other / rounding"
              sub={`metered import ${fmtGbp(d.breakdown.import_metered_gbp)} vs modelled ${fmtGbp(d.breakdown.import_model_gbp)}, window edges`}
              v={fmtGbp(d.breakdown.other_gbp)}
            />
            <Row k="Total saving" v={fmtGbp(d.saving.gbp)} strong />
          </div>

          <details className="rounded-xl bg-white/5 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">How this is calculated</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed" style={muted}>
              {d.method.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            {d.daily.length > 1 && (
              <div className="mt-4 overflow-x-auto">
                <table className="num w-full text-xs">
                  <thead style={muted}>
                    <tr className="text-left">
                      <th className="py-1 pr-3 font-normal">Day</th>
                      <th className="py-1 pr-3 font-normal">Load</th>
                      <th className="py-1 pr-3 font-normal">Without</th>
                      <th className="py-1 pr-3 font-normal">Actual</th>
                      <th className="py-1 font-normal">Saving</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.daily.map((r) => (
                      <tr key={r.date} className="border-t border-white/5">
                        <td className="py-1 pr-3">{r.date.slice(5)}</td>
                        <td className="py-1 pr-3">{r.load_kwh.toFixed(1)}</td>
                        <td className="py-1 pr-3">{fmtGbp(r.counterfactual_gbp)}</td>
                        <td className="py-1 pr-3">{fmtGbp(r.actual_net_gbp)}</td>
                        <td className="py-1">{fmtGbp(r.saving_gbp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      )}
    </Card>
  );
}
