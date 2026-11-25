import { PowerPrintBreakdownCard } from "./PowerPrint";
import { DayBudgetCard } from "./DayBudget";
import { CounterfactualCard } from "./Counterfactual";
import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchFinancials, type FinancialsData, type PeriodSel } from "../lib/api";
import { fmtGbp, fmtKwh, fmtRateP } from "../lib/format";
import { dateCategoryAxisProps, fmtDateKeyFull, fmtDateKeyShort, useWidth } from "../lib/chartAxis";
import { Card, CardHeader, Metric } from "./Card";
import { FINANCIALS_PRESETS, PeriodPicker, fmtDay, londonToday, validPeriod } from "./PeriodPicker";

const LS_KEY = "hearth.financials.period";
const allowed = FINANCIALS_PRESETS.map((p) => p.key);
/** Period from the URL (?period=6m or ?period=custom&start=&end=), else the last one used on this device, else 14D. */
function initialPeriod(): PeriodSel {
  const q = new URLSearchParams(window.location.search);
  const fromUrl = validPeriod({ key: q.get("period") as PeriodSel["key"], start: q.get("start") ?? undefined, end: q.get("end") ?? undefined }, allowed);
  if (fromUrl) return fromUrl;
  try {
    const saved = validPeriod(JSON.parse(localStorage.getItem(LS_KEY) || "null"), allowed);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return { key: "14d" };
}
function rememberPeriod(p: PeriodSel) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams(window.location.search);
  q.set("tab", "financials");
  q.set("period", p.key);
  if (p.key === "custom" && p.start && p.end) {
    q.set("start", p.start);
    q.set("end", p.end);
  } else {
    q.delete("start");
    q.delete("end");
  }
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}

function fmtDelta(pct: number | null | undefined, invertGood = false) {
  if (pct == null || !Number.isFinite(pct)) return "vs previous period";
  const abs = Math.abs(pct);
  const arrow = pct > 0.5 ? "↑" : pct < -0.5 ? "↓" : "→";
  const good = invertGood ? pct > 0 : pct < 0;
  const label = `${arrow} ${abs.toFixed(0)}% vs previous`;
  return { label, good, flat: abs < 0.5 };
}

function DeltaHint({ pct, invertGood, extra }: { pct: number | null; invertGood?: boolean; extra?: string }) {
  const d = fmtDelta(pct, invertGood);
  if (typeof d === "string") {
    return (
      <span>
        {extra ? `${extra} · ` : ""}
        {d}
      </span>
    );
  }
  const color = d.flat ? "var(--muted)" : d.good ? "#3ddc97" : "#f07167";
  return (
    <span>
      {extra ? `${extra} · ` : ""}
      <span style={{ color }}>{d.label}</span>
    </span>
  );
}

function sourceLabel(kind: string | undefined) {
  if (kind === "estimated") return "Estimated";
  if (kind === "mixed") return "Metered + estimated";
  return "Metered";
}

export function FinancialsPanel() {
  const [period, setPeriodState] = useState<PeriodSel>(initialPeriod);
  const today = londonToday();
  const setPeriod = (p: PeriodSel) => {
    setPeriodState(p);
    rememberPeriod(p);
  };
  const periodKey = `${period.key}:${period.start ?? ""}:${period.end ?? ""}`;
  const [data, setData] = useState<FinancialsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchFinancials(period)
      .then((d) => {
        if (!live) return;
        setData(d);
        setErr(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);
  useEffect(() => {
    rememberPeriod(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = data?.current;
  const prev = data?.previous;
  const deltas = data?.deltas;

  // Long periods: weekly (> 62 days) or monthly (> 200 days) totals so the chart stays readable.
  const grain: "day" | "week" | "month" = (data?.daily.length ?? 0) > 200 ? "month" : (data?.daily.length ?? 0) > 62 ? "week" : "day";
  const chart = (() => {
    const rows = data?.daily || [];
    if (grain === "day")
      return rows.map((d) => ({
        key: d.date,
        date: d.date.slice(5),
        full: d.date,
        import: d.import_cost_gbp != null ? +d.import_cost_gbp.toFixed(2) : null,
        export: d.export_earnings_gbp != null ? +d.export_earnings_gbp.toFixed(2) : null,
        net: d.net_cost_gbp != null ? +d.net_cost_gbp.toFixed(2) : null,
      }));
    const groups = new Map<string, { imp: number | null; exp: number | null; net: number | null }>();
    const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
    for (const d of rows) {
      let k = d.date.slice(0, 7);
      if (grain === "week") {
        const t = new Date(`${d.date}T12:00:00Z`);
        t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // Monday
        k = t.toISOString().slice(0, 10);
      }
      const g = groups.get(k) || { imp: null, exp: null, net: null };
      g.imp = add(g.imp, d.import_cost_gbp);
      g.exp = add(g.exp, d.export_earnings_gbp);
      g.net = add(g.net, d.net_cost_gbp);
      groups.set(k, g);
    }
    return [...groups.entries()].map(([k, g]) => ({
      key: k,
      date:
        grain === "month"
          ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${k}-15T12:00:00Z`))
          : k.slice(5),
      full: grain === "month" ? k : `week of ${k}`,
      import: g.imp != null ? +g.imp.toFixed(2) : null,
      export: g.exp != null ? +g.exp.toFixed(2) : null,
      net: g.net != null ? +g.net.toFixed(2) : null,
    }));
  })();

  const [chartRef, chartW] = useWidth();
  const peakK = cur?.peak_kwh ?? 0;
  const offK = cur?.offpeak_kwh ?? 0;
  const peakShareK = peakK + offK > 0 ? (peakK / (peakK + offK)) * 100 : 0;
  const peakC = cur?.peak_cost_gbp ?? 0;
  const offC = cur?.offpeak_cost_gbp ?? 0;
  const peakShareC = peakC + offC > 0 ? (peakC / (peakC + offC)) * 100 : 0;

  return (
    <div className="space-y-6">
      <PeriodPicker
        presets={FINANCIALS_PRESETS}
        period={period}
        onChange={setPeriod}
        today={today}
        leading={
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Import, export and net cost from Octopus meters. Unsettled days (usually today, sometimes yesterday’s export) are estimated from energy × rate.
          </p>
        }
      />

      {data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
          <span>
            {data.period.label === "Custom" || data.period.key === "custom" ? "Custom range" : data.period.label}: {fmtDay(data.period.start)} – {fmtDay(data.period.end)}
            {data.period.includes_today ? " (today so far)" : ""} · {data.period.days} day{data.period.days === 1 ? "" : "s"}
          </span>
          {loading && <span>Updating…</span>}
        </div>
      )}
      {data?.coverage?.partial && data.coverage.note && (
        <div className="rounded-xl px-4 py-2 text-sm" style={{ background: "rgba(245, 180, 60, 0.12)", color: "#f5b43c" }}>
          {data.coverage.note}
        </div>
      )}

      <DayBudgetCard />

      {err && <div className="text-sm text-gridin">{err}</div>}
      {loading && !data && (
        <div className="text-sm" style={{ color: "var(--muted)" }}>
          Loading cost history from Home Assistant…
        </div>
      )}

      {cur && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <Metric
                label="Import cost"
                value={fmtGbp(cur.import_cost_gbp)}
                hint=""
                tone="gridin"
              />
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                <DeltaHint pct={deltas?.import_cost_gbp ?? null} extra={sourceLabel(cur.import_source)} />
              </div>
            </Card>
            <Card>
              <Metric label="Export earnings" value={fmtGbp(cur.export_earnings_gbp)} tone="gridout" />
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                <DeltaHint pct={deltas?.export_earnings_gbp ?? null} invertGood extra={sourceLabel(cur.export_source)} />
              </div>
            </Card>
            <Card>
              <Metric
                label="Net cost"
                value={fmtGbp(cur.net_cost_gbp)}
                tone={(cur.net_cost_gbp ?? 0) <= 0 ? "batt" : "gridin"}
              />
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                <DeltaHint pct={deltas?.net_cost_gbp ?? null} extra={`Import ${fmtGbp(cur.import_cost_gbp)} − export ${fmtGbp(cur.export_earnings_gbp)}`} />
              </div>
            </Card>
            <Card>
              <Metric
                label="Avg unit rate"
                value={`${fmtRateP(cur.avg_import_p_kwh)} in`}
                hint={`${fmtRateP(cur.avg_export_p_kwh)} out · standing ${fmtGbp(cur.standing_gbp)} excluded from unit rate`}
              />
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Metric label="Imported" value={fmtKwh(cur.import_kwh)} />
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                <DeltaHint pct={deltas?.import_kwh ?? null} extra="Octopus meter" />
              </div>
            </Card>
            <Card>
              <Metric label="Exported" value={fmtKwh(cur.export_kwh)} tone="gridout" />
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                <DeltaHint pct={deltas?.export_kwh ?? null} invertGood extra="Octopus / Powerwall" />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              label={grain === "day" ? "Daily costs" : grain === "week" ? "Weekly costs" : "Monthly costs"}
              title="Import cost vs export earnings"
              right={
                <span className="whitespace-nowrap text-xs" style={{ color: "var(--muted)" }}>
                  {data
                    ? data.window.start.slice(0, 4) !== data.window.end.slice(0, 4)
                      ? `${fmtDateKeyShort(data.window.start, "day", 99)} ${data.window.start.slice(0, 4)} – ${fmtDateKeyShort(data.window.end, "day", 99)} ${data.window.end.slice(0, 4)}`
                      : `${fmtDateKeyShort(data.window.start, "day", 99)} – ${fmtDateKeyShort(data.window.end, "day", 99)}`
                    : ""}
                </span>
              }
            />
            <div ref={chartRef} className="h-[260px] sm:h-[340px]">
              {chart.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} barGap={chart.length > 20 ? 0 : 2} barCategoryGap={chart.length > 20 ? "12%" : "18%"} margin={{ top: 6, right: 18, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="key" {...dateCategoryAxisProps(chart.map((c) => c.key), chartW - 50, grain)} />
                    <YAxis
                      tick={{ fill: "var(--muted)", fontSize: 10 }}
                      width={42}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickFormatter={(v) => (Number(v) < 0 ? `−£${Math.abs(Number(v))}` : `£${v}`)}
                    />
                    <Tooltip
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
                      formatter={(v, name) => [`£${Number(v).toFixed(2)}`, String(name)]}
                      labelFormatter={(k) => fmtDateKeyFull(k, grain)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
                    <Bar dataKey="import" name="Import" fill="#f07167" radius={[4, 4, 0, 0]} maxBarSize={28} stackId="cost" />
                    <Bar dataKey="export" name="Export" fill="#5b9cff" radius={[4, 4, 0, 0]} maxBarSize={28} stackId="earn" />
                    <Line type="monotone" dataKey="net" name="Net" stroke="#3ddc97" strokeWidth={2} dot={chart.length <= 14 ? { r: 3 } : false} activeDot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
                  No daily points in this window.
                </div>
              )}
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              Previous {data?.period.days ?? ""} days{data?.previous_coverage?.partial ? ` (${data.previous_coverage.days_with_data} with data)` : ""}: import {fmtGbp(prev?.import_cost_gbp)} · export {fmtGbp(prev?.export_earnings_gbp)} · net {fmtGbp(prev?.net_cost_gbp)}
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader label="Tariff split" title="Cheap vs peak import" />
              <div className="space-y-4">
                <SplitBar
                  label="Energy"
                  left={`${fmtKwh(cur.offpeak_kwh)} cheap`}
                  right={`${fmtKwh(cur.peak_kwh)} peak`}
                  pct={100 - peakShareK}
                />
                <SplitBar
                  label="Unit cost"
                  left={`${fmtGbp(cur.offpeak_cost_gbp)} off-peak`}
                  right={`${fmtGbp(cur.peak_cost_gbp)} peak`}
                  pct={100 - peakShareC}
                />
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Off-peak hours and fallback rates come from Settings → Variables. Settled days use Octopus peak/off-peak meters; today is estimated from hourly import × those rates. Standing charge is not in this split.
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader label="Solar" title="Self-consumption value" />
              <Metric
                label="Self-consumed"
                value={fmtKwh(cur.self_consumption_kwh)}
                hint={`${fmtGbp(cur.self_consumption_value_gbp)} at the peak import rate (estimated avoided import)`}
                tone="solar"
              />
              <ul className="mt-4 space-y-2 text-sm">
                <Li k="Solar generated" v={fmtKwh(cur.solar_kwh)} />
                <Li k="Home use" v={fmtKwh(cur.load_kwh)} />
              </ul>
            </Card>

            <Card>
              <CardHeader label="Predbat" title="Optimisation savings" />
              {cur.predbat_savings_gbp != null ? (
                <Metric
                  label="Reported saving"
                  value={fmtGbp(cur.predbat_savings_gbp)}
                  hint="Predbat vs no optimisation, for days it published a figure. Not a meter reading."
                  tone="batt"
                />
              ) : (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Predbat has not published savings for enough days in this window to total.
                </p>
              )}
            </Card>
          </div>

          <CounterfactualCard period={period} periodKey={periodKey} />

          {data?.window && <PowerPrintBreakdownCard start={data.window.start} end={data.window.end} importCost={cur?.import_cost_gbp} />}

          <Card>
            <CardHeader label="Analysis" title="What the numbers say" />
            {data?.analysis?.length ? (
              <ul className="space-y-3 text-sm leading-relaxed">
                {data.analysis.map((line, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-batt" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Waiting for enough history to comment.</p>
            )}
            {data?.gaps?.length ? (
              <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
                Notes: {data.gaps.slice(0, 4).join(" ")}
              </p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

function SplitBar({ label, left, right, pct }: { label: string; left: string; right: string; pct: number }) {
  const cheap = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span>{label}</span>
        <span className="num">{cheap.toFixed(0)}% cheap</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(240,113,103,0.35)" }}>
        <div className="h-full rounded-full bg-batt" style={{ width: `${cheap}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function Li({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className="num">{v}</span>
    </li>
  );
}
