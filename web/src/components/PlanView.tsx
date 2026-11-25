/** Hearth's take on Predbat's plan view: summary tiles, a two-strip chart and a 30-minute slot timeline. Read-only. */
import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { BatteryLow, Car, Coins, Crosshair, Home, MoonStar, Sun, TrendingDown } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlanCarSummary, PlanSlot, PlanViewData, PlanWindow } from "../lib/api";
import { fmtTime, windowLabel } from "../lib/format";
import { categoryTimeAxisProps, useWidth } from "../lib/chartAxis";
import { dayBoundaries } from "./PlanChart";
import { useHa } from "../lib/store";
import { ev9Of, teslaOf } from "../lib/variables";

const TZ = "Europe/London";
const gbp = (g: number | null | undefined, sign = false) => (g == null ? "—" : `${sign && g > 0 ? "+" : g < 0 ? "−" : ""}£${Math.abs(g).toFixed(2)}`);
const kwh = (k: number | null | undefined, d = 1) => (k == null ? "—" : `${k.toFixed(d)} kWh`);
const rp = (p: number | null | undefined) => (p == null ? "—" : `${p.toFixed(1)}p`);
const dayName = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(iso));
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const londonDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const fullLabel = (iso: unknown) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(iso)));

/** "23:30–06:00" with the weekday added when it isn't today. */
function when(start: string, end: string, today: string) {
  const d = londonDay(Date.parse(start));
  return `${d === today ? "" : `${dayName(start)} `}${windowLabel(start, end)}`;
}
function at(iso: string, today: string) {
  const d = londonDay(Date.parse(iso));
  return `${d === today ? "" : `${dayName(iso)} `}${fmtTime(iso)}`;
}

export const STATE_STYLE: Record<PlanSlot["state"], { label: string; cls: string; fill: string }> = {
  charge: { label: "Charge", cls: "bg-batt/15 text-batt", fill: "rgba(61,220,151,0.16)" },
  export: { label: "Export", cls: "bg-gridout/15 text-gridout", fill: "rgba(91,156,255,0.16)" },
  hold: { label: "Hold", cls: "bg-solar/15 text-[#a16207] dark:text-solar", fill: "rgba(240,180,41,0.16)" },
  discharge: { label: "Battery", cls: "bg-house/20 text-[#6d5bd0] dark:text-house", fill: "transparent" },
  idle: { label: "Grid", cls: "bg-[var(--line)] text-[var(--muted)]", fill: "transparent" },
};
const BAND: Record<PlanSlot["band"], string> = {
  cheap: "bg-batt/15 text-batt",
  mid: "bg-solar/15 text-solar",
  peak: "bg-gridin/15 text-gridin",
};

export function stateLabel(s: PlanSlot, reserve: number | null) {
  if (s.state === "idle" && reserve != null && (s.soc_pct ?? 100) <= reserve + 0.5) return "Grid · reserve";
  if (s.state === "idle") return "Grid";
  const base = STATE_STYLE[s.state].label;
  return s.target_pct != null && (s.state === "charge" || s.state === "export") ? `${base} → ${Math.round(s.target_pct)}%` : base;
}

// ---------------------------------------------------------------- summary

function Tile({ icon, label, value, hint, tone, big, children }: { icon: React.ReactNode; label: string; value: string; hint?: React.ReactNode; tone?: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="label mb-1.5 flex items-center gap-1.5">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      <div className={clsx("num font-medium leading-tight", big ? "text-3xl" : "text-xl sm:text-2xl", tone)}>{value}</div>
      {hint && <div className={clsx("mt-1 leading-snug", big ? "text-base" : "text-xs")} style={{ color: "var(--muted)" }}>{hint}</div>}
      {children}
    </div>
  );
}

function carLine(c: PlanCarSummary | null | undefined, today: string) {
  if (!c) return "No car configured";
  if (!c.slots.length) return `${c.name}: no charge planned${c.soc_now != null ? ` · ${Math.round(c.soc_now)}%` : ""}`;
  const first = c.slots[0];
  const last = c.slots[c.slots.length - 1];
  const cost = c.planned_cost_p != null ? ` · £${(c.planned_cost_p / 100).toFixed(2)}` : "";
  return `${c.name}: ${kwh(c.planned_kwh)} ${when(first.start, last.end, today)}${cost}`;
}

export function PlanSummary({ data, big = false }: { data: PlanViewData; big?: boolean }) {
  const s = data.summary;
  const today = s.today.date;
  const toCome = s.today.predicted_gbp != null && s.today.actual_gbp != null ? s.today.predicted_gbp - s.today.actual_gbp : null;
  const oc = s.overnight_charge;
  const winList = (ws: PlanWindow[]) => ws.map((w) => when(w.start, w.end, today)).join(", ");
  return (
    <div className={clsx("grid gap-3", big ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-6")}>
      <Tile big={big} icon={<Coins size={14} />} label="Today's cost" value={gbp(s.today.predicted_gbp)} hint={`${gbp(s.today.actual_gbp)} so far · ${gbp(toCome)} to come`} />
      <Tile
        big={big}
        icon={<Coins size={14} />}
        label="Tomorrow"
        value={s.tomorrow ? gbp(s.tomorrow.cost_gbp) : "—"}
        hint={s.tomorrow ? (s.tomorrow.complete ? `${dayName(s.tomorrow.date + "T12:00:00Z")} · whole day` : `${dayName(s.tomorrow.date + "T12:00:00Z")} · planned to ${fmtTime(s.tomorrow.until)} so far`) : "plan doesn't reach tomorrow yet"}
      />
      <Tile
        big={big}
        icon={<BatteryLow size={14} />}
        tone={s.battery_empty ? "text-gridin" : "text-batt"}
        label="Battery out"
        value={s.battery_empty ? at(s.battery_empty.at, today) : "Not planned"}
        hint={
          s.battery_empty
            ? `${s.soc_now_pct ?? "—"}% now → ${s.battery_empty.reserve_pct ?? "—"}% reserve${s.battery_empty.refill_at ? ` · grid until ${at(s.battery_empty.refill_at, today)}` : ""}`
            : `${s.soc_now_pct ?? "—"}% now · stays above reserve`
        }
      />
      <Tile
        big={big}
        icon={<MoonStar size={14} />}
        tone="text-batt"
        label="Night charge"
        value={oc ? windowLabel(oc.start, oc.end) : "None"}
        hint={oc ? `${oc.target_pct != null ? `to ${Math.round(oc.target_pct)}% · ` : ""}${kwh(oc.grid_kwh)} at ${rp(oc.avg_rate_p)}${oc.windows.length > 1 ? ` · ${oc.windows.length} blocks` : ""}` : "No charge window in the plan"}
      />
      <Tile
        big={big}
        icon={<TrendingDown size={14} />}
        tone="text-batt"
        label="Cheapest import"
        value={s.cheapest_import ? rp(s.cheapest_import.rate_p) : "—"}
        hint={s.cheapest_import ? winList(s.cheapest_import.windows) : undefined}
      />
      <Tile
        big={big}
        icon={<Car size={14} />}
        tone="text-car"
        label="Car plan"
        value={`${[s.cars.tesla, s.cars.ev9].filter((c) => c && c.slots.length).length || "No"} charging`}
        hint={
          <>
            <span className="block">{carLine(s.cars.tesla, today)}</span>
            <span className="block">{carLine(s.cars.ev9, today)}</span>
          </>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- charts

export function PlanCharts({ data, tall = false }: { data: PlanViewData; tall?: boolean }) {
  const [ref, width] = useWidth();
  const rows = data.slots.map((s) => ({
    t: s.start,
    soc: s.soc_pct,
    imp: s.import_p,
    exp: s.export_p,
    pv: s.pv_kwh,
    load: s.load_kwh != null ? -s.load_kwh : null,
    car: s.car_kwh ? -s.car_kwh : null,
    total: s.total_gbp,
  }));
  const times = rows.map((r) => r.t);
  const bands = useMemo(() => {
    const out: { a: string; b: string; state: PlanSlot["state"] }[] = [];
    data.slots.forEach((s, i) => {
      if (s.state !== "charge" && s.state !== "export" && s.state !== "hold") return;
      const last = out[out.length - 1];
      if (last && last.state === s.state && data.slots[i - 1]?.state === s.state) last.b = s.start;
      else out.push({ a: s.start, b: s.start, state: s.state });
    });
    return out;
  }, [data.slots]);
  const nowT = data.slots.find((s) => s.is_now)?.start ?? data.slots[0]?.start;
  const axis = categoryTimeAxisProps(times, width - 76);
  const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }, labelStyle: { color: "var(--text)" }, labelFormatter: fullLabel };
  const midnights = dayBoundaries(times);
  if (!rows.length) return <div className="py-12 text-center text-sm" style={{ color: "var(--muted)" }}>No plan data yet.</div>;
  return (
    <div ref={ref} className="w-full">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
        <Key c="#3ddc97" label="SoC" /> <Key c="#f07167" label="Import p" line /> <Key c="#5b9cff" label="Export p" line />
        <Key c="rgba(61,220,151,0.35)" label="Charge" /> <Key c="rgba(91,156,255,0.35)" label="Export" /> <Key c="rgba(240,180,41,0.35)" label="Hold" />
      </div>
      <div className={tall ? "h-[300px]" : "h-[210px] sm:h-[250px]"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="plan" margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" {...axis} />
            <YAxis yAxisId="soc" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "var(--muted)", fontSize: 10 }} unit="%" width={38} tickLine={false} axisLine={false} />
            <YAxis yAxisId="rate" orientation="right" tick={{ fill: "var(--muted)", fontSize: 10 }} unit="p" width={34} tickLine={false} axisLine={false} />
            {bands.map((b) => (
              <ReferenceArea key={b.a} yAxisId="soc" x1={b.a} x2={b.b} y1={0} y2={100} fill={STATE_STYLE[b.state].fill.replace("0.16", "0.28")} strokeOpacity={0} ifOverflow="hidden" />
            ))}
            <Tooltip {...tip} formatter={(v: number, n: string) => [n === "SoC" ? `${Number(v).toFixed(0)}%` : `${Number(v).toFixed(1)}p`, n]} />
            <Area yAxisId="soc" type="monotone" dataKey="soc" name="SoC" stroke="#3ddc97" fill="rgba(61,220,151,0.14)" strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="rate" type="stepAfter" dataKey="imp" name="Import" stroke="#f07167" strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line yAxisId="rate" type="stepAfter" dataKey="exp" name="Export" stroke="#5b9cff" strokeWidth={1.75} dot={false} isAnimationActive={false} />
            {midnights.map((m) => (
              <ReferenceLine key={m.t} yAxisId="soc" x={m.t} stroke="var(--muted)" strokeDasharray="4 4" strokeOpacity={0.7} />
            ))}
            {data.reserve_pct != null && <ReferenceLine yAxisId="soc" y={data.reserve_pct} stroke="#f07167" strokeDasharray="2 4" strokeOpacity={0.6} />}
            {nowT && <ReferenceLine yAxisId="soc" x={nowT} stroke="#f0b429" strokeWidth={1.5} label={{ value: "Now", position: "insideTopLeft", fill: "#f0b429", fontSize: 11 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
        <Key c="#f0b429" label="Solar kWh" /> <Key c="#c4b5fd" label="Load kWh" /> <Key c="#22d3ee" label="Car kWh" /> <Key c="var(--text)" label="Running cost £" line />
      </div>
      <div className={tall ? "h-[170px]" : "h-[130px] sm:h-[150px]"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="plan" stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" {...axis} />
            <YAxis yAxisId="e" tick={{ fill: "var(--muted)", fontSize: 10 }} width={38} tickLine={false} axisLine={false} tickFormatter={(v: number) => Math.abs(v).toFixed(v && Math.abs(v) < 1 ? 1 : 0)} />
            <YAxis yAxisId="c" orientation="right" tick={{ fill: "var(--muted)", fontSize: 10 }} width={34} tickLine={false} axisLine={false} tickFormatter={(v: number) => `£${v.toFixed(0)}`} />
            <Tooltip {...tip} formatter={(v: number, n: string) => (n === "Running cost" ? [`£${Number(v).toFixed(2)}`, n] : [`${Math.abs(Number(v)).toFixed(2)} kWh`, n])} />
            <Bar yAxisId="e" dataKey="pv" name="Solar" stackId="e" fill="#f0b429" isAnimationActive={false} />
            <Bar yAxisId="e" dataKey="load" name="Load" stackId="e" fill="rgba(196,181,253,0.75)" isAnimationActive={false} />
            <Bar yAxisId="e" dataKey="car" name="Car" stackId="e" fill="#22d3ee" isAnimationActive={false} />
            <Line yAxisId="c" type="monotone" dataKey="total" name="Running cost" stroke="var(--text)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {midnights.map((m) => (
              <ReferenceLine key={m.t} yAxisId="e" x={m.t} stroke="var(--muted)" strokeDasharray="4 4" strokeOpacity={0.7} />
            ))}
            {nowT && <ReferenceLine yAxisId="e" x={nowT} stroke="#f0b429" strokeWidth={1.5} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Key({ c, label, line }: { c: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={line ? "h-0.5 w-3 rounded" : "h-2.5 w-2.5 rounded-sm"} style={{ background: c }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- slot timeline

function SocBar({ a, b }: { a: number | null; b: number | null }) {
  const lo = Math.min(a ?? 0, b ?? a ?? 0);
  const hi = Math.max(a ?? 0, b ?? a ?? 0);
  const up = (b ?? 0) > (a ?? 0) + 0.5;
  const down = (b ?? 0) < (a ?? 0) - 0.5;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full sm:w-20" style={{ background: "var(--line)" }}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-batt/70" style={{ width: `${lo}%` }} />
        {(up || down) && <div className={clsx("absolute inset-y-0 rounded-full", up ? "bg-batt" : "bg-house/80")} style={{ left: `${lo}%`, width: `${Math.max(2, hi - lo)}%` }} />}
      </div>
      <span className="num whitespace-nowrap text-xs">
        {a != null ? Math.round(a) : "—"}
        {b != null && Math.round(b) !== Math.round(a ?? -1) ? `→${Math.round(b)}` : ""}%
      </span>
    </div>
  );
}

function CarChips({ s }: { s: PlanSlot }) {
  const { variables: cfg } = useHa();
  const tName = teslaOf(cfg)?.name || "Car 1";
  const eName = ev9Of(cfg)?.name || "Car 2";
  const parts: React.ReactNode[] = [];
  if (s.cars.tesla) parts.push(<span key="t" className="rounded-full bg-car/15 px-2 py-0.5 text-car">{tName} {s.cars.tesla.toFixed(1)}</span>);
  if (s.cars.ev9) parts.push(<span key="e" className="rounded-full bg-car/15 px-2 py-0.5 text-car">{eName} {s.cars.ev9.toFixed(1)}</span>);
  if (!s.cars.tesla && !s.cars.ev9 && s.car_kwh) parts.push(<span key="c" className="rounded-full bg-car/15 px-2 py-0.5 text-car">Car {s.car_kwh.toFixed(1)}</span>);
  if (s.cars.iog) parts.push(<span key="i" className="rounded-full px-2 py-0.5" style={{ background: "var(--line)", color: "var(--muted)" }} title="Octopus Intelligent dispatch: the whole house gets the off-peak rate">IOG</span>);
  return parts.length ? <span className="flex flex-wrap items-center gap-1 text-[11px] font-medium">{parts}</span> : null;
}

const COLS = "md:grid md:grid-cols-[4.2rem_8.5rem_4.6rem_4.2rem_minmax(8rem,1fr)_4.6rem_3.6rem_3.6rem_minmax(6.5rem,1fr)_4.4rem_4.6rem] md:items-center md:gap-3";

export function SlotTimeline({ data, maxHeight = "70vh", autoScroll = true }: { data: PlanViewData; maxHeight?: string; autoScroll?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const nowRow = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const today = data.summary.today.date;
  const groups = useMemo(() => {
    const g: { day: string; slots: PlanSlot[] }[] = [];
    for (const s of data.slots) {
      const last = g[g.length - 1];
      if (last && last.day === s.day) last.slots.push(s);
      else g.push({ day: s.day, slots: [s] });
    }
    return g;
  }, [data.slots]);

  const jump = (smooth = true) => {
    const c = box.current;
    const r = nowRow.current;
    if (!c || !r) return;
    const head = window.matchMedia("(min-width: 768px)").matches ? 66 : 34;
    c.scrollTo({ top: Math.max(0, c.scrollTop + r.getBoundingClientRect().top - c.getBoundingClientRect().top - head), behavior: smooth ? "smooth" : "auto" });
  };
  useEffect(() => {
    if (!autoScroll || scrolled.current || !data.slots.length) return;
    scrolled.current = true;
    requestAnimationFrame(() => jump(false));
  }, [data.slots.length, autoScroll]);

  const dayTitle = (day: string, first: PlanSlot) => {
    const tomorrow = londonDay(Date.parse(`${today}T12:00:00Z`) + 86400e3);
    return day === today ? `Today · ${dayShort(first.start)}` : day === tomorrow ? `Tomorrow · ${dayShort(first.start)}` : dayShort(first.start);
  };

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {(["charge", "export", "hold", "discharge", "idle"] as const).map((k) => (
            <span key={k} className={clsx("rounded-full px-2 py-0.5 font-medium", STATE_STYLE[k].cls)}>{STATE_STYLE[k].label}</span>
          ))}
          <span className="mx-1" style={{ color: "var(--muted)" }}>·</span>
          <span className={clsx("rounded-full px-2 py-0.5 font-medium", BAND.cheap)}>cheap</span>
          <span className={clsx("rounded-full px-2 py-0.5 font-medium", BAND.mid)}>mid</span>
          <span className={clsx("rounded-full px-2 py-0.5 font-medium", BAND.peak)}>peak</span>
        </div>
        <button type="button" onClick={() => jump()} className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
          <Crosshair size={13} /> Now
        </button>
      </div>
      <div ref={box} className="overflow-y-auto overscroll-contain rounded-xl" style={{ maxHeight, boxShadow: "0 0 0 1px var(--line)" }}>
        <div className={clsx("sticky top-0 z-20 hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-wider md:grid", COLS)} style={{ background: "var(--card)", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
          <span>Time</span>
          <span>Battery plan</span>
          <span>Import</span>
          <span>Export</span>
          <span>Powerwall SoC</span>
          <span className="text-right">Battery</span>
          <span className="text-right">Solar</span>
          <span className="text-right">Load</span>
          <span>Cars</span>
          <span className="text-right">Slot</span>
          <span className="text-right">Running</span>
        </div>
        {groups.map((g) => {
          const dayCost = g.slots.reduce((a, s) => a + (s.cost_gbp ?? 0), 0);
          const minSoc = g.slots.reduce((m, s) => Math.min(m, s.soc_end_pct ?? s.soc_pct ?? 100), 100);
          return (
            <div key={g.day}>
              <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-xs font-semibold md:top-[33px]" style={{ background: "var(--bg-elev)", borderBottom: "1px solid var(--line)" }}>
                <span>{dayTitle(g.day, g.slots[0])}</span>
                <span className="num font-normal" style={{ color: "var(--muted)" }}>
                  <span className="hidden sm:inline">{g.slots.length} slots · </span>{gbp(dayCost)} · min {Math.round(minSoc)}%
                </span>
              </div>
              {g.slots.map((s) => {
                const st = STATE_STYLE[s.state];
                return (
                  <div
                    key={s.start}
                    ref={s.is_now ? nowRow : undefined}
                    data-now={s.is_now || undefined}
                    className={clsx("relative px-3 py-2 text-sm", COLS, s.is_now && "bg-solar/[0.07]")}
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    {s.is_now && <span className="absolute inset-y-0 left-0 w-[3px] bg-solar" />}
                    {/* line 1 (mobile) / first columns (desktop) */}
                    <div className="flex items-center justify-between gap-2 md:contents">
                      <span className="num flex items-center gap-1.5 text-[13px] font-medium md:block">
                        {fmtTime(s.start)}
                        {s.is_now && <span className="rounded-full bg-solar px-1.5 py-px text-[9px] font-bold uppercase text-ink-950 md:ml-1">Now</span>}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 md:contents">
                        <span className={clsx("truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{stateLabel(s, data.reserve_pct)}</span>
                        <span className="ml-auto md:hidden"><CarChips s={s} /></span>
                      </span>
                      <span className={clsx("num shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold md:w-fit", BAND[s.band])}>{rp(s.import_p)}</span>
                      <span className="num hidden text-xs md:block" style={{ color: "var(--muted)" }}>{rp(s.export_p)}</span>
                    </div>
                    {/* line 2 (mobile) / remaining columns (desktop) */}
                    <div className="mt-1.5 flex items-center gap-3 whitespace-nowrap text-xs md:contents" style={{ color: "var(--muted)" }}>
                      <SocBar a={s.soc_pct} b={s.soc_end_pct} />
                      <span className="num hidden text-right text-xs md:block">{s.battery_kwh ? `${s.battery_kwh > 0 ? "+" : "−"}${Math.abs(s.battery_kwh).toFixed(2)}` : "·"}</span>
                      <span className="num flex items-center gap-2 md:contents">
                        <span className={clsx("md:text-right", (s.pv_kwh ?? 0) > 0.005 ? "text-solar" : "hidden md:block")}><Sun size={11} className="mr-0.5 inline md:hidden" />{(s.pv_kwh ?? 0).toFixed(2)}</span>
                        <span className="md:text-right"><Home size={11} className="mr-0.5 inline md:hidden" />{(s.load_kwh ?? 0).toFixed(2)}</span>
                      </span>
                      <span className="hidden md:block"><CarChips s={s} /></span>
                      <span className={clsx("num ml-auto md:ml-0 md:text-right", (s.cost_gbp ?? 0) < 0 && "text-batt")}>{s.cost_gbp ? gbp(s.cost_gbp, true) : "£0.00"}</span>
                      <span className="num w-12 text-right font-medium md:w-auto" style={{ color: "var(--text)" }}>{gbp(s.total_gbp)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlanHeaderNote({ data }: { data: PlanViewData }) {
  return (
    <span>
      {data.mode ?? "Predbat"} · plan from {data.generated ? fmtTime(data.generated) : "—"} · to {data.summary.horizon_end ? `${dayName(data.summary.horizon_end)} ${fmtTime(data.summary.horizon_end)}` : "—"}
    </span>
  );
}
