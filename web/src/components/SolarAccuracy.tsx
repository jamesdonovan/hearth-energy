import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchSolar } from "../lib/api";
import { usePoll } from "../lib/store";
import { Card, CardHeader, Metric } from "./Card";
import { dateCategoryAxisProps, fmtDateKeyFull, useWidth } from "../lib/chartAxis";

const shortDate = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function SolarAccuracy() {
  const [days, setDays] = useState(14);
  const { data, err, loading } = usePoll(() => fetchSolar(days), 15 * 60000, [days]);
  const s = data?.summary;
  const rows = (data?.rows || []).map((r) => ({ ...r, label: shortDate(r.date) }));
  const [chartRef, chartW] = useWidth();
  return (
    <Card>
      <CardHeader
        label="Solcast via Predbat"
        title="Solar forecast vs actual"
        right={
          <div className="flex rounded-full p-1" style={{ background: "var(--bg-elev)" }}>
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full px-3 py-1 text-xs font-medium ${days === d ? "bg-white/10" : ""}`} style={{ color: days === d ? "var(--text)" : "var(--muted)" }}>
                {d}d
              </button>
            ))}
          </div>
        }
      />
      {err && <p className="text-sm text-gridin">{err}</p>}
      {loading && !data && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading forecast history…</p>}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Avg daily accuracy" value={s?.mean_accuracy_pct != null ? `${s.mean_accuracy_pct}%` : "—"} hint={`${s?.days_compared ?? 0} full days`} tone="solar" />
            <Metric label="Forecast / actual" value={`${s?.forecast_kwh?.toFixed(0) ?? "—"} / ${s?.actual_kwh?.toFixed(0) ?? "—"}`} hint="kWh over the period" />
            <Metric
              label="Bias"
              value={s?.bias_pct == null ? "—" : `${s.bias_pct > 0 ? "+" : ""}${s.bias_pct}%`}
              hint={s?.bias_pct == null ? "" : Math.abs(s.bias_pct) <= 5 ? "Totals line up well" : s.bias_pct > 0 ? "Forecast runs high" : "Forecast runs low"}
            />
            <Metric label="Typical miss" value={s?.mean_abs_error_kwh != null ? `${s.mean_abs_error_kwh.toFixed(1)} kWh` : "—"} hint="Mean absolute error per day" />
          </div>
          <div ref={chartRef} className="h-[240px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" {...dateCategoryAxisProps(rows.map((r) => r.date), chartW - 80, "day")} />
                <YAxis yAxisId="kwh" tick={{ fill: "var(--muted)", fontSize: 10 }} width={34} tickLine={false} axisLine={false} />
                <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "var(--muted)", fontSize: 10 }} unit="%" width={38} tickLine={false} axisLine={false} />
                <Tooltip
                  labelFormatter={(k) => fmtDateKeyFull(k, "day")}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
                  formatter={(v: number, name: string) => (name === "Accuracy" ? [`${v}%`, name] : [`${Number(v).toFixed(1)} kWh`, name])}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
                <Bar yAxisId="kwh" dataKey="forecast_morning" name="Forecast 06:00 (kWh)" fill="rgba(240,180,41,0.55)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="kwh" dataKey="actual" name="Actual (kWh)" fill="rgba(61,220,151,0.85)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="pct" type="monotone" dataKey="accuracy_pct" name="Accuracy" stroke="#c4b5fd" strokeWidth={2} dot={rows.length <= 14 ? { r: 2 } : false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="label text-left">
                  <th className="py-1.5 pr-3 font-medium">Day</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Forecast</th>
                  <th className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell">Final fcst</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Actual</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Miss</th>
                  <th className="py-1.5 text-right font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody className="num">
                {[...rows].reverse().slice(0, 7).map((r) => (
                  <tr key={r.date} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-1.5 pr-3 font-sans">{r.label}{!r.complete && <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>(today)</span>}</td>
                    <td className="py-1.5 pr-3 text-right">{r.forecast_morning?.toFixed(1) ?? "—"}</td>
                    <td className="hidden py-1.5 pr-3 text-right sm:table-cell">{r.forecast_final?.toFixed(1) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{r.actual?.toFixed(1) ?? "—"}</td>
                    <td className={`py-1.5 pr-3 text-right ${r.error_kwh == null ? "" : r.error_kwh > 0 ? "text-solar" : "text-gridout"}`}>{r.error_kwh == null ? "—" : `${r.error_kwh > 0 ? "+" : ""}${r.error_kwh.toFixed(1)}`}</td>
                    <td className="py-1.5 text-right">{r.accuracy_pct != null ? `${r.accuracy_pct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{data.method} A positive miss means the forecast was too high.</p>
        </>
      )}
    </Card>
  );
}
