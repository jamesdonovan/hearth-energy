import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BellRing, Maximize, X } from "lucide-react";
import { useHa, usePoll } from "../lib/store";
import { cheapImport, flows, num, st } from "../lib/derived";
import { ev9Of, flowIdsFrom, predbatId, siteId, tariffId, teslaOf, vehiclePower } from "../lib/variables";
import { fmtKw, fmtPct, fmtPence, fmtRateGbp } from "../lib/format";
import { PowerFlow } from "../components/PowerFlow";
import { TonightCard } from "../components/TonightCard";
import { PowerPrintWallTile } from "../components/PowerPrint";
import { RateChart } from "../components/PlanChart";
import { fetchDayCost, fetchPlan, fetchPlanView, fetchTonight } from "../lib/api";
import { PlanCharts, PlanHeaderNote, PlanSummary } from "../components/PlanView";
import { CarDataBadge, staleCls, useCarStatus, type CarKey } from "../components/CarData";
import { applyTheme } from "../lib/theme";

const PANELS = ["Now", "Tonight", "Plan", "Cars", "Rates"] as const;

export function Wall() {
  const { entities, connected, alerts, variables: cfg } = useHa();
  const tesla = teslaOf(cfg);
  const ev9 = ev9Of(cfg);
  const [i, setI] = useState(0);
  const [clock, setClock] = useState(new Date());
  const rotate = Number(localStorage.getItem("hearth-wall-rotate") || 20);
  const { data: tonight } = usePoll(fetchTonight, 120000);
  const { data: plan } = usePoll(fetchPlan, 300000);
  const { data: day } = usePoll(fetchDayCost, 120000);
  const { data: planView } = usePoll(fetchPlanView, 300000);

  useEffect(() => {
    applyTheme();
    const t = setInterval(() => setClock(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!rotate) return;
    const t = setInterval(() => setI((x) => (x + 1) % PANELS.length), rotate * 1000);
    return () => clearInterval(t);
  }, [rotate]);
  // Keep the tablet screen awake while wall mode is open.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* not supported / not allowed */
      }
    };
    req();
    const vis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      lock?.release().catch(() => {});
    };
  }, []);

  const f = flows(entities, flowIdsFrom(cfg));
  const soc = num(entities, siteId(cfg, "pw_soc"));
  const offPeak = cheapImport(entities, tariffId(cfg, "off_peak"));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(clock);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(clock);
  const top = alerts?.active[0];

  return (
    <div className="flex h-screen flex-col overflow-hidden p-5 lg:p-8" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }} onDoubleClick={() => setI((x) => (x + 1) % PANELS.length)}>
      <header className="mb-4 flex items-center justify-between gap-6">
        <div>
          <div className="num text-5xl font-medium leading-none lg:text-6xl">{time}</div>
          <div className="mt-1 text-lg" style={{ color: "var(--muted)" }}>{date}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-4 py-2 text-lg ${offPeak ? "bg-batt/15 text-batt" : "bg-gridin/15 text-gridin"}`}>{offPeak ? "Cheap rate" : "Peak rate"} · {fmtRateGbp(num(entities, tariffId(cfg, "import_rate")))}</span>
          <span className={`h-3 w-3 rounded-full ${connected ? "bg-batt" : "bg-gridin"}`} title={connected ? "Live" : "Offline"} />
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="rounded-xl p-3" style={{ background: "var(--card)" }} aria-label="Full screen">
            <Maximize size={20} />
          </button>
          <Link to="/" className="rounded-xl p-3" style={{ background: "var(--card)" }} aria-label="Exit wall mode">
            <X size={20} />
          </Link>
        </div>
      </header>

      {top && (
        <div className={`card mb-5 flex items-center gap-4 px-5 py-3 text-lg ${top.severity === "warning" ? "ring-2 ring-gridin/60" : "ring-1 ring-solar/50"}`}>
          {top.severity === "warning" ? <AlertTriangle className="shrink-0 text-gridin" size={28} /> : <BellRing className="shrink-0 text-solar" size={28} />}
          <div>
            <div className="font-semibold">{top.title}</div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>{top.body}</div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto" onClick={() => setI((x) => (x + 1) % PANELS.length)}>
        {PANELS[i] === "Now" && (
          <div className="grid h-full gap-5 lg:grid-cols-5">
            <div className="card flex items-center p-4 lg:col-span-3">
              <PowerFlow entities={entities} size="wall" />
            </div>
            <div className="grid gap-5 lg:col-span-2">
              <Big label="Powerwall" value={fmtPct(soc)} hint={f.batteryCharge > 0.05 ? `charging ${fmtKw(f.batteryCharge)}` : f.batteryDischarge > 0.05 ? `powering the house ${fmtKw(f.batteryDischarge)}` : "idle"} tone="text-batt" />
              <Big label="Solar" value={fmtKw(f.solar)} hint={`Today ${num(entities, predbatId(cfg, "pv_energy_h0", "predbat.pv_energy_h0"))?.toFixed(1) ?? "—"} kWh`} tone="text-solar" />
              <Big
                label="Cost today"
                value={fmtPence(num(entities, predbatId(cfg, "cost_today", "predbat.cost_today")))}
                tone={day?.over ? "text-gridin" : undefined}
                hint={day?.predicted_gbp != null ? `Heading for £${day.predicted_gbp.toFixed(2)} · budget £${day.budget_gbp.toFixed(2)}` : `Export ${fmtRateGbp(num(entities, tariffId(cfg, "export_current_rate")))}`}
              />
            </div>
          </div>
        )}
        {PANELS[i] === "Tonight" && (
          <div className="space-y-5">
            <PowerPrintWallTile />
            <TonightCard big data={tonight} />
          </div>
        )}
        {PANELS[i] === "Plan" && (
          planView ? (
            <div className="grid gap-5 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <div className="label mb-2">Predbat plan · <PlanHeaderNote data={planView} /></div>
                <PlanSummary data={planView} big />
              </div>
              <div className="card p-5 lg:col-span-3">
                <PlanCharts data={planView} />
              </div>
            </div>
          ) : (
            <div className="card p-8 text-lg" style={{ color: "var(--muted)" }}>Loading plan…</div>
          )
        )}
        {PANELS[i] === "Cars" && (
          <div className="grid h-full gap-5 md:grid-cols-2">
            <CarBig car={tesla?.id || "car_1"} name={tesla?.name || "Car 1"} soc={num(entities, tesla?.soc)} range={num(entities, tesla?.range)} plugged={tesla?.plugged ? st(entities, tesla.plugged) === "on" : false} kw={vehiclePower(entities, cfg, tesla)} morning={tonight?.tesla?.soc_morning ?? null} kwh={tonight?.tesla?.planned_kwh ?? null} />
            <CarBig car={ev9?.id || "car_2"} name={ev9?.name || "Car 2"} soc={num(entities, ev9?.soc)} range={num(entities, ev9?.range)} plugged={ev9?.plugged ? st(entities, ev9.plugged) === "on" : false} kw={vehiclePower(entities, cfg, ev9)} morning={tonight?.ev9?.soc_morning ?? null} kwh={tonight?.ev9?.planned_kwh ?? null} />
          </div>
        )}
        {PANELS[i] === "Rates" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <div className="label mb-2">Import · Intelligent Octopus Go</div>
              <RateChart series={plan?.octopus.import || []} importKey />
            </div>
            <div className="card p-5">
              <div className="label mb-2">Export · Agile Outgoing</div>
              <RateChart series={plan?.octopus.export || []} importKey={false} />
            </div>
          </div>
        )}
      </div>

      <footer className="mt-4 flex items-center justify-center gap-3">
        {PANELS.map((p, k) => (
          <button key={p} type="button" onClick={() => setI(k)} className={`rounded-full px-4 py-1.5 text-sm ${k === i ? "bg-white/10" : ""}`} style={{ color: k === i ? "var(--text)" : "var(--muted)" }}>
            {p}
          </button>
        ))}
      </footer>
    </div>
  );
}

function Big({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card flex flex-col justify-center px-6 py-4">
      <div className="label text-sm">{label}</div>
      <div className={`num mt-1 text-5xl font-medium xl:text-6xl ${tone || ""}`}>{value}</div>
      {hint && <div className="mt-1 text-base" style={{ color: "var(--muted)" }}>{hint}</div>}
    </div>
  );
}

function CarBig({ car, name, soc, range, plugged, kw, morning, kwh }: { car: CarKey; name: string; soc: number | null; range: number | null; plugged: boolean; kw: number | null; morning: number | null; kwh: number | null }) {
  const { stale } = useCarStatus(car);
  return (
    <div className="card flex flex-col justify-between p-8">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-semibold">{name}</div>
        <span className={`rounded-full px-4 py-1.5 text-base ${staleCls(stale)} ${plugged ? "bg-batt/15 text-batt" : ""}`} style={!plugged ? { background: "var(--bg-elev)", color: "var(--muted)" } : undefined}>{plugged ? "Plugged in" : "Not plugged in"}</span>
      </div>
      <div className="mt-3"><CarDataBadge car={car} size="lg" /></div>
      <div className={`num my-5 text-8xl font-medium text-car ${staleCls(stale)}`}>{fmtPct(soc)}</div>
      <div className={`h-3 overflow-hidden rounded-full ${staleCls(stale)}`} style={{ background: "var(--bg-elev)" }}>
        <div className="h-full rounded-full bg-car" style={{ width: `${Math.max(0, Math.min(100, soc ?? 0))}%` }} />
      </div>
      <div className="mt-5 flex justify-between text-xl" style={{ color: "var(--muted)" }}>
        <span>{range != null ? `${Math.round(range)} mi` : ""}</span>
        <span>{kw != null && kw > 0.05 ? `Charging ${kw.toFixed(1)} kW` : kwh ? `${kwh.toFixed(1)} kWh planned → ${fmtPct(morning)}` : `Morning ${fmtPct(morning)}`}</span>
      </div>
    </div>
  );
}
