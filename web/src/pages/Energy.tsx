import { useEffect, useMemo, useState } from "react";
import { fmtTimeFull, timeAxisProps, useWidth } from "../lib/chartAxis";
import { fetchHistory, fetchPlan, fetchStats, type PlanData } from "../lib/api";
import { FinancialsPanel } from "../components/Financials";
import { PowerPrintPanel } from "../components/PowerPrint";
import { fetchPowerPrint } from "../lib/api";
import { useHa, usePoll } from "../lib/store";
import { ev9Of, flowIdsFrom, predbatId, siteId, teslaOf } from "../lib/variables";
import { SolarAccuracy } from "../components/SolarAccuracy";
import { Card, CardHeader, Metric } from "../components/Card";
import { PlanChart, RateChart } from "../components/PlanChart";
import { fmtGbp, fmtKwh, fmtPence } from "../lib/format";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Tab = "plan" | "financials" | "analysis" | "powerprint";

export function Energy() {
  const [tab, setTabState] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "financials" || t === "analysis" || t === "plan" || t === "powerprint" ? (t as Tab) : "plan";
  });
  const { data: pp } = usePoll(() => fetchPowerPrint(1), 300000);
  const ppInbox = pp?.inbox_total ?? 0;
  const setTab = (t: Tab) => {
    setTabState(t);
    const q = new URLSearchParams(window.location.search);
    if (t === "plan") {
      q.delete("tab");
      q.delete("period");
      q.delete("start");
      q.delete("end");
    } else q.set("tab", t);
    if (t !== "financials") {
      q.delete("period");
      q.delete("start");
      q.delete("end");
    }
    const qs = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  };
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([fetchPlan(), fetchStats()])
      .then(([p, s]) => {
        if (!live) return;
        setPlan(p);
        setStats(s);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        setLoading(false);
      });
    const t = setInterval(() => {
      fetchPlan().then((p) => live && setPlan(p)).catch(() => {});
    }, 60000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const today = (stats?.today || {}) as Record<string, number | null>;
  const yesterday = (stats?.yesterday || {}) as Record<string, number | null>;
  const last7 = (stats?.last7 || {}) as Record<string, number | null>;
  const last30 = (stats?.last30 || {}) as Record<string, number | null>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Energy</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Predbat’s next 30 hours, Octopus rates, import/export costs, and the numbers behind the plan.
          </p>
        </div>
        <div className="flex max-w-full overflow-x-auto rounded-full p-1" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}>
          {(["plan", "financials", "analysis", "powerprint"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium sm:px-4 ${t === "powerprint" ? "" : "capitalize"} ${tab === t ? "bg-white/10" : ""}`}
              style={{ color: tab === t ? "var(--text)" : "var(--muted)" }}
            >
              {t === "powerprint" ? "PowerPrint" : t}
              {t === "powerprint" && ppInbox > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-house px-1 text-[10px] font-semibold text-ink-950">{ppInbox}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="text-sm text-gridin">{err}</div>}
      {loading && tab === "plan" && <div className="text-sm" style={{ color: "var(--muted)" }}>Loading plan and history from Home Assistant…</div>}

      {tab === "plan" && !loading && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card><Metric label="Today cost" value={fmtPence(today.cost_p)} hint={`Import ${fmtPence(today.cost_import_p)} · export ${fmtPence(today.cost_export_p)}`} /></Card>
            <Card><Metric label="Yesterday" value={fmtPence(yesterday.cost_p ?? today.cost_yesterday_p)} hint={`Predbat saved ${fmtPence(today.savings_yesterday_p)}`} /></Card>
            <Card><Metric label="Solar today" value={fmtKwh(today.solar_kwh)} hint={`Forecast ${fmtKwh(today.pv_forecast_kwh)} · tomorrow ${fmtKwh(today.pv_forecast_tomorrow_kwh)}`} tone="solar" /></Card>
            <Card><Metric label="Import / export today" value={`${n(today.import_kwh)} / ${n(today.export_kwh)}`} hint="kWh in · kWh out" /></Card>
          </div>

          <Card>
            <CardHeader
              label="Predbat plan"
              title="SoC, rates and charge/export windows"
              right={
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {plan?.plan?.generated ? `Updated ${new Date(plan.plan.generated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}` : ""}
                </span>
              }
            />
            <PlanChart plan={plan?.plan ?? null} />
            {plan?.plan?.windows?.length ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {plan.plan.windows.map((w, i) => (
                  <span
                    key={i}
                    className={`rounded-full px-2.5 py-1 ${
                      w.type === "charge" ? "bg-batt/15 text-batt" : w.type === "export" ? "bg-gridout/15 text-gridout" : "bg-solar/15 text-solar"
                    }`}
                  >
                    {w.type} {new Date(w.start).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
                    {w.target ? ` → ${w.target}%` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader label="Octopus" title="Import — IOG today & tomorrow" />
              <RateChart series={plan?.octopus.import || []} importKey />
            </Card>
            <Card>
              <CardHeader label="Octopus" title="Export — Agile Outgoing" />
              <RateChart series={plan?.octopus.export || []} importKey={false} />
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatBlock title="7 days" importK={last7.import_kwh} exportK={last7.export_kwh} solar={last7.solar_kwh} savings={last7.savings_p} cycles={last7.battery_cycles} importCost={last7.import_cost_gbp} exportEarn={last7.export_earnings_gbp} netCost={last7.net_cost_gbp} />
            <StatBlock title="30 days" importK={last30.import_kwh} exportK={last30.export_kwh} solar={last30.solar_kwh} savings={last30.savings_p} cycles={last30.battery_cycles} importCost={last30.import_cost_gbp} exportEarn={last30.export_earnings_gbp} netCost={last30.net_cost_gbp} />
            <Card>
              <CardHeader label="Yesterday meter" title="Octopus settlement" />
              <ul className="space-y-2 text-sm">
                <Li k="Import" v={`${fmtKwh(today.octopus_import_yesterday_kwh)} · ${fmtGbpSafe(today.octopus_import_yesterday_gbp)}`} />
                <Li k="Export" v={`${fmtKwh(today.octopus_export_yesterday_kwh)} · ${fmtGbpSafe(today.octopus_export_yesterday_gbp)}`} />
                <Li k="Today so far (meter)" v={`${fmtKwh(today.octopus_import_kwh)} · ${fmtGbpSafe(today.octopus_import_cost_gbp)}`} />
              </ul>
            </Card>
          </div>

          <SolarAccuracy />
        </>
      )}

      {tab === "financials" && <FinancialsPanel />}

      {tab === "analysis" && <AnalysisPanel />}

      {tab === "powerprint" && <PowerPrintPanel />}
    </div>
  );
}

function n(v: number | null | undefined) {
  return v == null ? "—" : v.toFixed(1);
}
function fmtGbpSafe(v: number | null | undefined) {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}
function Li({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className="num">{v}</span>
    </li>
  );
}

function StatBlock({
  title, importK, exportK, solar, savings, cycles, importCost, exportEarn, netCost,
}: {
  title: string;
  importK: number | null;
  exportK: number | null;
  solar: number | null;
  savings: number | null;
  cycles: number | null;
  importCost?: number | null;
  exportEarn?: number | null;
  netCost?: number | null;
}) {
  return (
    <Card>
      <CardHeader label="Totals" title={title} />
      <ul className="space-y-2 text-sm">
        <Li k="Import" v={`${fmtKwh(importK)}${importCost != null ? ` · ${fmtGbp(importCost)}` : ""}`} />
        <Li k="Export" v={`${fmtKwh(exportK)}${exportEarn != null ? ` · ${fmtGbp(exportEarn)}` : ""}`} />
        <Li k="Net cost" v={fmtGbp(netCost)} />
        <Li k="Solar" v={fmtKwh(solar)} />
        <Li k="Predbat savings" v={fmtPence(savings)} />
        <Li k="Battery cycles" v={cycles == null ? "—" : cycles.toFixed(1)} />
      </ul>
    </Card>
  );
}

function analysisPresets(cfg: Parameters<typeof teslaOf>[0]) {
  const f = flowIdsFrom(cfg);
  const tesla = teslaOf(cfg);
  const ev9 = ev9Of(cfg);
  const carIds = [tesla?.soc, ev9?.soc].filter((x): x is string => !!x);
  return [
    { id: "power", label: "Live power (solar, load, grid, battery)", ids: [f.solar, f.load, f.grid, f.battery].map((x) => x || "").filter(Boolean) },
    { id: "soc", label: "Powerwall SoC", ids: [siteId(cfg, "pw_soc")] },
    { id: "cost", label: "Cost today (pence)", ids: [predbatId(cfg, "cost_today", "predbat.cost_today")] },
    { id: "cars", label: "Car SoC", ids: carIds },
  ];
}

function AnalysisPanel() {
  const { variables: cfg } = useHa();
  const PRESETS = analysisPresets(cfg);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [data, setData] = useState<{ name: string; [k: string]: string | number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;

  useEffect(() => {
    const ids = PRESETS.find((p) => p.id === preset)!.ids;
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    setBusy(true);
    setErr(null);
    fetchHistory(ids, start.toISOString(), end.toISOString())
      .then((r) => {
        const map = new Map<string, { name: string; [k: string]: string | number }>();
        for (const s of r.series) {
          const key = shortName(s.entity_id);
          for (const p of s.points) {
            if (typeof p.v !== "number") continue;
            const row = map.get(p.t) || { name: p.t };
            row[key] = p.v;
            map.set(p.t, row);
          }
        }
        const rows = [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setData(rows);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  }, [preset, hours]);

  const keys = useMemo(() => {
    if (!data?.[0]) return [];
    return Object.keys(data[0]).filter((k) => k !== "name");
  }, [data]);

  const colors = ["#f0b429", "#c4b5fd", "#f07167", "#3ddc97", "#5b9cff", "#22d3ee"];
  const [chartRef, chartW] = useWidth();
  // Numeric time axis (history points are irregular); window end = now.
  const series = useMemo(() => (data || []).map((r) => ({ ...r, ts: Date.parse(String(r.name)) })).filter((r) => Number.isFinite(r.ts)), [data]);
  const tMax = series.length ? Math.max(series[series.length - 1].ts, Date.now() - 60000) : Date.now();
  const tMin = tMax - hours * 3600 * 1000;

  return (
    <Card>
      <CardHeader label="History" title="Pick a series and a window" />
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm"
          style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="flex rounded-full p-1" style={{ background: "var(--bg-elev)" }}>
          {(["24h", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${range === r ? "bg-white/10" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="text-sm text-gridin">{err}</div>}
      <div ref={chartRef} className="h-[300px] sm:h-[360px]">
        {busy && !data ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>Loading history…</div>
        ) : data && data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="ts" {...timeAxisProps(tMin, tMax, chartW - 50)} />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} width={38} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
                labelFormatter={fmtTimeFull}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
              {keys.map((k, i) => (
                <Area key={k} type="monotone" dataKey={k} name={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.15} strokeWidth={2} dot={false} connectNulls />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>No points in this range.</div>
        )}
      </div>
    </Card>
  );
}

function shortName(id: string) {
  return id
    .replace("sensor.powerwall_", "")
    .replace("sensor.my_home_", "")
    .replace("_2", "")
    .replace("sensor.", "")
    .replace("predbat.", "predbat ")
    .replaceAll("_", " ");
}
