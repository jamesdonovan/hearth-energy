/** PowerPrint: detected appliance runs, confirm-to-learn inbox and per-appliance costs (Energy → PowerPrint). */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, HelpCircle, Lightbulb, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { ApplianceIcon } from "./ApplianceIcon";
import { SourceBar, TwoCosts, actualCost, useSolarAtExport } from "./SourceBar";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { detectPowerPrint, fetchPowerPrint, fetchPowerPrintBreakdown, labelPowerPrint, type PPEvent, type PowerPrintData } from "../lib/api";
import { usePoll } from "../lib/store";
import { Card, CardHeader } from "./Card";

const TZ = "Europe/London";
const hm = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(t));
const day = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(t));
const gbp = (g: number | null | undefined) => (g == null ? "—" : `£${g.toFixed(2)}`);
const mm = (m: number | null) => (m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} m` : ""}`.trim() : `${m} min`);

function Mini({ e }: { e: PPEvent }) {
  const data = e.series.map((v, i) => ({ i, v }));
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={[0, "dataMax"]} />
          <Area type="stepAfter" dataKey="v" stroke="#c4b5fd" fill="rgba(196,181,253,0.25)" strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Chip({ on, onClick, children, tone = "house" }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: "house" | "batt" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full px-3 py-1.5 text-xs font-medium transition",
        on ? (tone === "batt" ? "bg-batt/20 text-batt ring-1 ring-batt/50" : "bg-house/20 text-[#6d5bd0] ring-1 ring-house/60 dark:text-house") : "text-[var(--muted)]",
      )}
      style={on ? undefined : { background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}
    >
      {children}
    </button>
  );
}

function InboxItem({ e, data, onDone, preselect, highlight }: { e: PPEvent; data: PowerPrintData; onDone: () => void; preselect?: string[]; highlight?: boolean }) {
  const sug = e.suggestion;
  const [sel, setSel] = useState<string[]>(() => (preselect || []).filter((l) => data.appliances.some((a) => a.id === l)));
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => data.appliances.find((a) => a.id === id)?.name ?? id;
  const send = async (status: "confirmed" | "unsure" | "not_appliance", labels = sel) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await labelPowerPrint(e.id, { status, labels, other: other.trim() || undefined });
      if (!r.ok) throw new Error(r.error || "failed");
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  const f = e.features;
  const [solarExp] = useSolarAtExport();
  return (
    <div id={`run-${e.id}`} className={clsx("rounded-2xl p-4", highlight && "ring-2 ring-solar/70")} style={{ background: "var(--bg-elev)", boxShadow: highlight ? undefined : "0 0 0 1px var(--line)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm leading-snug">
          Looks like something ran <span className="num font-semibold">{hm(e.start)}–{hm(e.end)}</span>
          <span style={{ color: "var(--muted)" }}> {day(e.start)}</span>, <span className="num font-semibold">{f.kwh.toFixed(1)} kWh</span>,{" "}
          <span className="num font-semibold">{gbp(actualCost(e.actual_gbp ?? e.cost_gbp, e.sources?.solar_forgone_gbp, solarExp))}</span>
          {e.actual_gbp != null && e.cost_gbp - e.actual_gbp >= 0.005 ? <span style={{ color: "var(--muted)" }}> ({gbp(e.cost_gbp)} at the grid rate)</span> : null}. Which was it?
        </div>
      </div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
        {dur(f.duration_min)} · ~{f.plateau_kw.toFixed(1)} kW while on · peak {f.peak_kw.toFixed(1)} kW · {f.spikes} burst{f.spikes === 1 ? "" : "s"}
        {f.car_overlap > 0.2 ? " · car charging at the same time (less certain)" : ""}
        {e.layer === "top" ? " · on top of another appliance that was already running" : e.layer === "base" ? " · something else ran on top for part of this (split out)" : ""}
      </div>
      <div className="mt-2"><Mini e={e} /></div>
      <SourceBar s={e.sources} legend className="mt-1.5" />
      {sug && (
        <button
          type="button"
          disabled={busy}
          onClick={() => send("confirmed", sug.labels)}
          className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs"
          style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}
          title={sug.why}
        >
          <Sparkles size={14} className="shrink-0 text-solar" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{sug.labels.map(name).join(" + ")}?</span>{" "}
            <span style={{ color: "var(--muted)" }}>{Math.round(sug.confidence * 100)}% · {sug.source === "hint" ? "rule of thumb" : sug.why}</span>
          </span>
          <span className="shrink-0 rounded-full bg-batt/15 px-2 py-0.5 font-semibold text-batt">Yes</span>
        </button>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.appliances.map((a) => (
          <Chip key={a.id} on={sel.includes(a.id)} onClick={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))}>
            <span className="inline-flex items-center gap-1.5"><ApplianceIcon icon={a.icon} color={a.color} size={12} />{a.name}</span>
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={other}
          onChange={(ev) => setOther(ev.target.value)}
          placeholder="Other…"
          maxLength={40}
          className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-xs outline-none"
          style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)", color: "var(--text)" }}
        />
        <button type="button" disabled={busy || (!sel.length && !other.trim())} onClick={() => send("confirmed")} className="flex items-center gap-1 rounded-xl bg-batt/20 px-3 py-1.5 text-xs font-semibold text-batt disabled:opacity-40">
          <Check size={13} /> Confirm{sel.length + (other.trim() ? 1 : 0) > 1 ? ` (${sel.length + (other.trim() ? 1 : 0)})` : ""}
        </button>
        <button type="button" disabled={busy} onClick={() => send("unsure")} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)", color: "var(--muted)" }}>
          <HelpCircle size={13} /> Not sure
        </button>
        <button type="button" disabled={busy} onClick={() => send("not_appliance")} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)", color: "var(--muted)" }}>
          <X size={13} /> Not an appliance
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-gridin">{err}</div>}
    </div>
  );
}

const STATUS: Record<PPEvent["status"], string> = { new: "to confirm", confirmed: "confirmed", auto: "auto", unsure: "not sure", not_appliance: "not an appliance" };

export function PowerPrintPanel() {
  const [tick, setTick] = useState(0);
  const { data, err } = usePoll(() => fetchPowerPrint(30), 120000, [tick]);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [solarExp, setSolarExp] = useSolarAtExport();
  const refresh = () => setTick((t) => t + 1);
  const [deep] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { run: q.get("run"), labels: (q.get("label") || "").split(",").filter(Boolean) };
  });
  const inbox = useMemo(() => {
    const list = (data?.events || []).filter((e) => e.status === "new" && !e.open);
    const i = deep.run ? list.findIndex((e) => e.id === deep.run) : -1;
    return i > 0 ? [list[i], ...list.slice(0, i), ...list.slice(i + 1)] : list;
  }, [data, deep.run]);
  const deepDone = Boolean(deep.run && data && !inbox.some((e) => e.id === deep.run));
  useEffect(() => {
    if (deep.run && data) document.getElementById(`run-${deep.run}`)?.scrollIntoView({ block: "center" });
  }, [deep.run, Boolean(data)]);
  const history = useMemo(
    () => (data?.events || []).filter((e) => e.status !== "new" && (filter === "all" || (filter === "unsure" ? e.status === "unsure" || e.status === "not_appliance" : e.labels.includes(filter)))),
    [data, filter],
  );
  if (err) return <p className="text-sm text-gridin">{err}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading PowerPrint…</p>;
  const name = (id: string) => data.appliances.find((a) => a.id === id)?.name ?? id;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(`${data.month}-15T12:00:00Z`));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          label="PowerPrint"
          title="Which appliances ran, and what they cost"
          right={
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await detectPowerPrint().catch(() => {});
                setBusy(false);
                refresh();
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
              style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}
            >
              <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Detect now
            </button>
          }
        />
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          House load (Powerwall load minus both car chargers) in 5-minute steps. A run is ≥{data.settings.min_on_min} min at more than {data.settings.threshold_kw} kW above the rolling
          baseline, with bursts up to {data.settings.merge_gap_min} min apart merged. Cost uses the import rate in each 5 minutes (dispatch-aware). Confirm a few runs and PowerPrint
          learns; after {data.settings.auto_min_confirmations} confirmations it labels close matches automatically (you can still change them).
          {data.last_run && <> Last checked {hm(Date.parse(data.last_run))}.</>}
          {data.last_error && <span className="text-gridin"> Last error: {data.last_error}</span>}{" "}
          <Link to="/settings" className="inline-flex items-center gap-1 underline"><Settings2 size={11} /> Edit appliances</Link>
        </p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          <b style={{ color: "var(--text)" }}>Cost (electricity)</b> = every kWh at the import rate in effect, i.e. what it would have cost from the grid.{" "}
          <b style={{ color: "var(--text)" }}>Cost with energy shift</b> = what it really cost: each 5 minutes the appliance's energy is split over solar, Powerwall and grid in proportion
          to what was supplying the house; grid at that slot's rate, Powerwall at what its stored energy cost to put in (mostly the off-peak rate, solar charging free), solar free.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={solarExp} onChange={(ev) => setSolarExp(ev.target.checked)} />
          Count solar at the export rate it could have earned (instead of free)
        </label>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {data.stats.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="label mb-1 flex items-center gap-1.5"><ApplianceIcon icon={s.icon} color={s.color} size={13} />{s.name}</div>
            <TwoCosts big cost={s.cost_gbp} actual={actualCost(s.actual_gbp, s.solar_forgone_gbp, solarExp)} />
            <SourceBar s={s.sources} className="mt-2" />
            <div className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
              {s.runs} run{s.runs === 1 ? "" : "s"} in {monthLabel} · {s.kwh.toFixed(1)} kWh
              {s.runs ? <><br />{gbp(s.avg_actual_gbp)}/run · usually {mm(s.typical_start_min)} · {Math.round((s.peak_share ?? 0) * 100)}% in peak hours</> : null}
              <br />
              {s.confirmed} confirmed
            </div>
          </div>
        ))}
      </div>

      {data.nudges.length > 0 && (
        <Card>
          <CardHeader label="Savings tips" title="Runs you could move to the off-peak window" />
          <ul className="space-y-2">
            {data.nudges.map((n) => {
              const a = data.appliances.find((x) => x.id === n.appliance);
              return (
                <li key={n.appliance} className="flex items-start gap-3 rounded-xl p-3 text-sm" style={{ background: "var(--bg-elev)" }}>
                  <Lightbulb size={16} className="mt-0.5 shrink-0 text-solar" />
                  <span className="min-w-0 flex-1 leading-snug">{n.text}</span>
                  <span className="num shrink-0 rounded-full bg-batt/15 px-2 py-0.5 text-xs font-semibold text-batt" title={a?.name}>save {gbp(n.saving_gbp)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>Grid kWh bought at the peak rate × (peak − off-peak rate); energy from solar or the Powerwall already cost little, so it isn't counted. Appliances marked "can't run off-peak" in Settings, or with a fixed rate, are left out.</p>
        </Card>
      )}

      <Card>
        <CardHeader label="Inbox" title={inbox.length ? `${inbox.length} run${inbox.length === 1 ? "" : "s"} to confirm` : "All caught up"} />
        {deepDone && <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>That run is already labelled. You can change it in the history below.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {(showAll ? inbox : inbox.slice(0, 6)).map((e) => (
            <InboxItem key={e.id} e={e} data={data} onDone={refresh} highlight={e.id === deep.run} preselect={e.id === deep.run ? deep.labels : undefined} />
          ))}
        </div>
        {inbox.length > 6 && (
          <button type="button" onClick={() => setShowAll((x) => !x)} className="mt-3 text-xs underline" style={{ color: "var(--muted)" }}>
            {showAll ? "Show fewer" : `Show all ${inbox.length}`}
          </button>
        )}
      </Card>

      <Card>
        <CardHeader label="History" title="Labelled runs (last 30 days)" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
          {data.appliances.map((a) => (
            <Chip key={a.id} on={filter === a.id} onClick={() => setFilter(a.id)}>{a.name}</Chip>
          ))}
          <Chip on={filter === "unsure"} onClick={() => setFilter("unsure")}>Not sure / not an appliance</Chip>
        </div>
        {!history.length && <p className="text-sm" style={{ color: "var(--muted)" }}>Nothing labelled yet.</p>}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {history.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
              <span className="num w-28 shrink-0 text-xs" style={{ color: "var(--muted)" }}>{day(e.start).replace(/ \w+$/, "")} {hm(e.start)}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.labels.length ? e.labels.map(name).join(" + ") : <span style={{ color: "var(--muted)" }}>—</span>}
                <span className={clsx("ml-2 rounded-full px-1.5 py-px text-[10px]", e.status === "auto" ? "bg-solar/15 text-[#a16207] dark:text-solar" : "")} style={e.status === "auto" ? undefined : { background: "var(--line)", color: "var(--muted)" }}>
                  {STATUS[e.status]}{e.status === "auto" && e.suggestion ? ` ${Math.round(e.suggestion.confidence * 100)}%` : ""}
                </span>
              </span>
              <SourceBar s={e.sources} className="hidden w-20 shrink-0 sm:block" />
              <span className="num shrink-0 text-xs">{e.features.kwh.toFixed(1)} kWh</span>
              <span className="num w-24 shrink-0 text-right text-xs" title={`${gbp(e.cost_effective_gbp ?? e.cost_gbp)} at the grid rate`}>
                {gbp(actualCost(e.actual_gbp ?? e.cost_effective_gbp ?? e.cost_gbp, e.sources?.solar_forgone_gbp, solarExp))}
                <span className="block text-[10px]" style={{ color: "var(--muted)" }}>{gbp(e.cost_effective_gbp ?? e.cost_gbp)} grid rate</span>
              </span>
              <button type="button" onClick={async () => { await labelPowerPrint(e.id, { status: "new" }).catch(() => {}); refresh(); }} className="shrink-0 text-[11px] underline" style={{ color: "var(--muted)" }}>
                change
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Financials: what the labelled appliances cost in the selected period. */
export function PowerPrintBreakdownCard({ start, end, importCost }: { start: string; end: string; importCost: number | null | undefined }) {
  const { data } = usePoll(() => fetchPowerPrintBreakdown(start, end), 0, [start, end]);
  const [solarExp] = useSolarAtExport();
  if (!data) return null;
  const max = Math.max(0.01, ...data.appliances.map((a) => a.cost_gbp), data.unlabelled.cost_gbp);
  const partial = data.data_from && data.data_from > start;
  const act = (c: { actual_gbp: number; solar_forgone_gbp: number }) => actualCost(c.actual_gbp, c.solar_forgone_gbp, solarExp);
  return (
    <Card>
      <CardHeader
        label="PowerPrint"
        title="Appliances in this period"
        right={<Link to="/energy?tab=powerprint" className="text-xs underline" style={{ color: "var(--muted)" }}>Open PowerPrint</Link>}
      />
      {!data.appliances.length && !data.unlabelled.runs ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No detected appliance runs in this period{partial ? ` (PowerPrint data starts ${data.data_from})` : ""}.</p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div><div className="label">Cost (electricity)</div><div className="num text-xl font-medium">{gbp(data.total.cost_gbp)}</div></div>
            <div><div className="label">With energy shift</div><div className="num text-xl font-medium">{gbp(act(data.total))}</div></div>
            <div><div className="label">Saved by solar + Powerwall</div><div className="num text-xl font-medium text-batt">{gbp(data.total.cost_gbp - (act(data.total) ?? 0))}</div></div>
          </div>
          <SourceBar s={data.total.sources} legend className="mb-4" />
          <ul className="space-y-3">
            {data.appliances.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: a.color }} />{a.name} <span className="text-xs" style={{ color: "var(--muted)" }}>· {a.runs} run{a.runs === 1 ? "" : "s"} · {a.kwh.toFixed(1)} kWh</span></span>
                  <span className="text-right">
                    <span className="num font-medium">{gbp(act(a))}</span>
                    <span className="ml-2 text-[11px]" style={{ color: "var(--muted)" }}>{gbp(a.cost_gbp)} electricity</span>
                  </span>
                </div>
                <div style={{ width: `${Math.max(8, (a.cost_gbp / max) * 100)}%` }}>
                  <SourceBar s={a.sources} className="mt-1" />
                </div>
              </li>
            ))}
            {data.unlabelled.runs > 0 && (
              <li className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--muted)" }}>
                <span>Not yet confirmed · {data.unlabelled.runs} run{data.unlabelled.runs === 1 ? "" : "s"} · {data.unlabelled.kwh.toFixed(1)} kWh</span>
                <span className="num">{gbp(act(data.unlabelled))} <span className="text-[11px]">({gbp(data.unlabelled.cost_gbp)} electricity)</span></span>
              </li>
            )}
          </ul>
          <p className="mt-3 text-[11px]" style={{ color: "var(--muted)" }}>
            Labelled appliances at the grid rate: {gbp(data.total.cost_gbp)}
            {importCost ? ` (${Math.round((data.total.cost_gbp / importCost) * 100)}% of the period's ${gbp(importCost)} import cost)` : ""}. "With energy shift" prices the solar, Powerwall and grid share of each 5 minutes
            {solarExp ? " (solar at the export rate)" : " (solar free)"}
            {partial ? `; PowerPrint data starts ${data.data_from}, so earlier days aren't covered` : ""}.
          </p>
        </>
      )}
    </Card>
  );
}

/** Wall: compact PowerPrint tile (today). */
export function PowerPrintWallTile() {
  const { data } = usePoll(() => fetchPowerPrint(1), 300000);
  if (!data) return null;
  const today = data.stats.filter((s) => s.today_runs > 0).sort((a, b) => b.today_gbp - a.today_gbp);
  const todayTotal = today.reduce((t, s) => t + s.today_gbp, 0);
  const todayActual = today.reduce((t, s) => t + (s.today_actual_gbp ?? s.today_gbp), 0);
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
      <div>
        <div className="label">PowerPrint today</div>
        <div className="num text-3xl font-medium">{gbp(todayActual)}</div>
        <div className="text-sm" style={{ color: "var(--muted)" }}>{gbp(todayTotal)} at the grid rate{todayTotal - todayActual >= 0.005 ? ` · saved ${gbp(todayTotal - todayActual)}` : ""}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2 text-base">
        {today.length ? (
          today.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "var(--bg-elev)" }}>
              <ApplianceIcon icon={s.icon} color={s.color} size={16} /> {s.name} <span className="num" style={{ color: "var(--muted)" }}>{gbp(s.today_actual_gbp ?? s.today_gbp)}</span>
            </span>
          ))
        ) : (
          <span style={{ color: "var(--muted)" }}>No confirmed appliance runs yet today.</span>
        )}
      </div>
      {data.inbox_total > 0 && <span className="rounded-full bg-house/20 px-3 py-1 text-base text-[#6d5bd0] dark:text-house">{data.inbox_total} to confirm</span>}
    </div>
  );
}
