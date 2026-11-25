import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlanData } from "../lib/api";
import { fmtRateP, fmtTime } from "../lib/format";
import { categoryTimeAxisProps, useWidth } from "../lib/chartAxis";

const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(new Date(iso));
const fullLabel = (iso: unknown) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(iso)));

/** First point of each new London day (for midnight markers). */
export function dayBoundaries(times: string[]) {
  const out: { t: string; label: string }[] = [];
  for (let i = 1; i < times.length; i++) {
    if (dayKey(times[i]) !== dayKey(times[i - 1])) out.push({ t: times[i], label: dayLabel(times[i]) });
  }
  return out;
}

function boundaryLines(times: string[], yAxisId?: string) {
  return dayBoundaries(times).map((b) => (
    <ReferenceLine
      key={b.t}
      x={b.t}
      {...(yAxisId ? { yAxisId } : {})}
      stroke="var(--muted)"
      strokeDasharray="4 4"
      strokeOpacity={0.7}
    />
  ));
}

export function PlanChart({ plan }: { plan: PlanData["plan"] }) {
  const [ref, width] = useWidth();
  if (!plan || !plan.rows.length) {
    return <div className="py-16 text-center text-sm" style={{ color: "var(--muted)" }}>No plan data yet.</div>;
  }
  const data = plan.rows.map((r) => ({
    t: r.time,
    label: fmtTime(r.time),
    soc: r.soc_percent,
    import: r.import_rate,
    export: r.export_rate,
    pv: r.pv_forecast != null ? r.pv_forecast * 2 : null, // kWh per 30m → kW-ish
    load: r.load_forecast != null ? r.load_forecast * 2 : null,
    charge: r.state.toLowerCase().startsWith("chrg") || r.state.toLowerCase() === "charge" ? 8 : 0,
    exp: r.state.toLowerCase().startsWith("exp") ? 8 : 0,
    freeze: r.state.toLowerCase().includes("frz") || r.state.toLowerCase().includes("freeze") ? 8 : 0,
    state: r.state,
  }));

  return (
    <div ref={ref} className="h-[300px] w-full sm:h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" {...categoryTimeAxisProps(data.map((d) => d.t), width - 76)} />
          <YAxis yAxisId="soc" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "var(--muted)", fontSize: 10 }} unit="%" width={38} tickLine={false} axisLine={false} />
          <YAxis yAxisId="rate" orientation="right" tick={{ fill: "var(--muted)", fontSize: 10 }} unit="p" width={34} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
            labelStyle={{ color: "var(--text)" }}
            labelFormatter={fullLabel}
            formatter={(value: number, name: string) => {
              if (name === "SoC") return [`${Number(value).toFixed(0)}%`, name];
              if (name === "Import" || name === "Export") return [fmtRateP(Number(value)), name];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
          <Bar yAxisId="soc" dataKey="charge" name="Charge window" fill="rgba(61,220,151,0.85)" stroke="none" legendType="square" barSize={10} />
          <Bar yAxisId="soc" dataKey="exp" name="Export window" fill="rgba(91,156,255,0.9)" stroke="none" legendType="square" barSize={10} />
          <Bar yAxisId="soc" dataKey="freeze" name="Freeze" fill="rgba(240,180,41,0.9)" stroke="none" legendType="square" barSize={10} />
          <Area yAxisId="soc" type="monotone" dataKey="soc" name="SoC" stroke="#3ddc97" fill="rgba(61,220,151,0.18)" strokeWidth={2} />
          <Line yAxisId="rate" type="stepAfter" dataKey="import" name="Import" stroke="#f07167" strokeWidth={2} dot={false} />
          <Line yAxisId="rate" type="stepAfter" dataKey="export" name="Export" stroke="#5b9cff" strokeWidth={2} dot={false} />
          {boundaryLines(data.map((d) => d.t), "soc")}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RateChart({
  series,
  importKey = true,
}: {
  series: { start: string; end: string; value: number }[];
  importKey?: boolean;
}) {
  const [ref, width] = useWidth();
  if (!series.length) {
    return <div className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>Rates not available.</div>;
  }
  const data = series.map((r) => ({
    label: fmtTime(r.start),
    t: r.start,
    v: r.value * 100, // GBP → pence
  }));
  const nowMs = Date.now();
  const nowT = series.find((r) => Date.parse(r.start) <= nowMs && Date.parse(r.end) > nowMs)?.start;
  return (
    <div ref={ref} className="h-[200px] w-full sm:h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" {...categoryTimeAxisProps(data.map((d) => d.t), width - 44)} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} unit="p" width={36} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
            formatter={(v: number) => [`${Number(v).toFixed(1)}p`, importKey ? "Import" : "Export"]}
            labelFormatter={fullLabel}
          />
          <Area type="stepAfter" dataKey="v" stroke={importKey ? "#f07167" : "#5b9cff"} fill={importKey ? "rgba(240,113,103,0.18)" : "rgba(91,156,255,0.18)"} strokeWidth={2} />
          {boundaryLines(data.map((d) => d.t))}
          {nowT && <ReferenceLine x={nowT} stroke="#f0b429" strokeOpacity={0.9} label={{ value: "Now", position: "insideTopRight", fill: "#f0b429", fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
