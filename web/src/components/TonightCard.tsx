import { BatteryCharging, Car, MoonStar } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchTonight, type CarPlan, type TonightData } from "../lib/api";
import { usePoll } from "../lib/store";
import { fmtKwh, fmtPct, fmtTime, fmtTimeDate, windowLabel } from "../lib/format";
import { Card, CardHeader } from "./Card";
import { CarDataBadge, staleCls, useCarStatus } from "./CarData";

const p2gbp = (p: number | null | undefined) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);

export function TonightCard({ big = false, data: given }: { big?: boolean; data?: TonightData | null }) {
  const { data: fetched, err } = usePoll(fetchTonight, given !== undefined ? 0 : 120000);
  const data = given !== undefined ? given : fetched;
  const pw = data?.powerwall;
  const total = (pw?.charge_cost_p ?? 0) + (data?.tesla?.planned_cost_p ?? 0) + (data?.ev9?.planned_cost_p ?? 0);
  return (
    <Card>
      <CardHeader
        label="Tonight's plan"
        title={data ? `Now → ${fmtTimeDate(data.until)}` : "Loading…"}
        right={
          <div className="text-right">
            <div className="label">Planned charging</div>
            <div className={`num font-medium ${big ? "text-3xl" : "text-xl"}`}>{data ? p2gbp(total) : "—"}</div>
          </div>
        }
      />
      {err && <p className="text-sm text-gridin">{err}</p>}
      {data && (
        <div className={`grid gap-4 ${big ? "lg:grid-cols-3" : "md:grid-cols-3"}`}>
          <Column icon={<BatteryCharging size={16} />} title="Powerwall" tone="text-batt">
            {pw ? (
              <>
                <SocLine now={pw.soc_now} morning={pw.soc_morning} big={big} />
                <ul className="mt-3 space-y-1.5 text-sm">
                  {pw.windows.length ? (
                    pw.windows.map((w, i) => (
                      <li key={i} className="flex justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--bg-elev)" }}>
                        <span className={w.type === "charge" ? "text-batt" : w.type === "export" ? "text-gridout" : "text-solar"}>
                          {w.type === "charge" ? "Charge" : w.type === "export" ? "Export" : "Hold"} {windowLabel(w.start, w.end)}
                        </span>
                        <span className="num" style={{ color: "var(--muted)" }}>
                          {w.target ? `→${w.target}% · ` : ""}
                          {w.type === "export" ? `${(w.export_rate_p ?? 0).toFixed(1)}p` : `${(w.import_rate_p ?? 0).toFixed(1)}p`}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li style={{ color: "var(--muted)" }}>No charge or export windows planned.</li>
                  )}
                </ul>
                <dl className="mt-3 space-y-1 text-sm">
                  <KV k="Grid charge" v={`${fmtKwh(pw.charge_kwh)} · ${p2gbp(pw.charge_cost_p)}`} />
                  {pw.export_kwh > 0 && <KV k="Planned export" v={`${fmtKwh(pw.export_kwh)} · +${p2gbp(pw.export_earn_p)}`} />}
                  {pw.soc_min != null && <KV k="Lowest" v={`${fmtPct(pw.soc_min)} at ${fmtTime(pw.soc_min_at)}`} />}
                </dl>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Predbat plan unavailable.</p>
            )}
          </Column>
          {data.tesla && <CarColumn plan={data.tesla} big={big} note={iogNote(data)} />}
          {data.ev9 && <CarColumn plan={data.ev9} big={big} note="Predbat plans this car; a linked charger (for example an Ohme) can carry out the slots." />}
        </div>
      )}
      {!big && (
        <div className="mt-4 flex justify-end text-xs">
          <Link to="/energy" className="text-gridout">Full plan →</Link>
        </div>
      )}
    </Card>
  );
}

function iogNote(d: TonightData) {
  if (!d.tesla) return "";
  if (d.tesla.iog_active) return "IOG is dispatching now.";
  if (d.tesla.iog_extra?.length) return `IOG extra slot ${d.tesla.iog_extra.map((x) => windowLabel(x.start, x.end)).join(", ")}: the house is on the cheap rate then.`;
  if (d.tesla.iog_planned?.length) return `IOG has ${d.tesla.iog_planned.length} dispatch${d.tesla.iog_planned.length > 1 ? "es" : ""} planned.`;
  return "Intelligent Octopus has not published dispatches yet.";
}

function CarColumn({ plan, big, note }: { plan: CarPlan; big: boolean; note: string }) {
  const status = useCarStatus(plan.car);
  return (
    <Column icon={<Car size={16} />} title={plan.name || "Car"} tone="text-car">
      <div className="mb-2">
        <CarDataBadge car={plan.car} hideOnline />
      </div>
      <div className={staleCls(status.stale)}>
        <SocLine now={plan.soc_now} morning={plan.soc_morning} big={big} />
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {plan.slots.length ? (
          plan.slots.map((s, i) => (
            <li key={i} className="flex justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--bg-elev)" }}>
              <span className="text-car">{windowLabel(s.start, s.end)}</span>
              <span className="num" style={{ color: "var(--muted)" }}>
                {s.kwh != null ? `${s.kwh.toFixed(1)} kWh` : ""} {s.rate_p != null ? `· ${s.rate_p.toFixed(1)}p` : ""}
              </span>
            </li>
          ))
        ) : (
          <li style={{ color: "var(--muted)" }}>{plan.soc_now != null && plan.soc_now >= 99 ? "Full — nothing to charge." : "No charging planned."}</li>
        )}
      </ul>
      <dl className="mt-3 space-y-1 text-sm">
        <KV k="Planned" v={plan.planned_kwh ? `${fmtKwh(plan.planned_kwh)} · ${p2gbp(plan.planned_cost_p)}` : "Nothing planned"} />
        {plan.slot_active && <KV k="Status" v="Charging slot open now" />}
      </dl>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{note}</p>
      {status.stale && (
        <p className="mt-2 text-xs text-solar">
          SoC shown is the last known value. Predbat is reading the car as {status.live_state || "unknown"}, so its plan for this car may be off until the car reports again.
        </p>
      )}
    </Column>
  );
}

function Column({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "color-mix(in srgb, var(--bg-elev) 60%, transparent)", boxShadow: "0 0 0 1px var(--line)" }}>
      <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${tone}`}>
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function SocLine({ now, morning, big }: { now: number | null; morning: number | null; big: boolean }) {
  return (
    <div className="flex items-end gap-2">
      <span className={`num font-medium ${big ? "text-4xl" : "text-2xl"}`}>{fmtPct(now)}</span>
      <span className="pb-1 text-sm" style={{ color: "var(--muted)" }}>
        <MoonStar size={12} className="mr-1 inline" />
        → {fmtPct(morning)} by morning
      </span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: "var(--muted)" }}>{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  );
}
