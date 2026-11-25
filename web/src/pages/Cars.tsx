import { useEffect, useState } from "react";
import { timeAxisProps, fmtTimeFull, useWidth } from "../lib/chartAxis";
import { useHa, usePoll } from "../lib/store";
import { chargerForVehicle, ev9Of, teslaOf, vehiclePower } from "../lib/variables";
import type { VehicleConfig } from "../lib/api";
import { num, st } from "../lib/derived";
import { fmtGbp, fmtKwh, fmtPct, fmtTime, fmtTimeDate } from "../lib/format";
import { Card, CardHeader } from "../components/Card";
import { fetchCarCosts, fetchCars, fetchHistory, type CarNight, type CarPlan, type CarsData, type CostPeriod } from "../lib/api";
import { CarDataBadge, carBadgeText, fmtWhen, staleCls, useCarStatus } from "../components/CarData";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const p2gbp = (p: number | null | undefined) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);

export function Cars() {
  const { data: cars, err } = usePoll(fetchCars, 120000);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cars</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Plans come from Predbat; actuals come from each car and its linked charger. Configure vehicles and chargers in Settings → Variables.
        </p>
      </div>
      {err && <p className="text-sm text-gridin">{err}</p>}
      <LastNight data={cars} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TeslaCard plan={cars?.plan.vehicles?.tesla ?? cars?.plan.tesla ?? undefined} iog={cars?.iog} night={cars?.last_night.vehicles?.tesla ?? cars?.last_night.tesla ?? undefined} />
        <Ev9Card plan={cars?.plan.vehicles?.ev9 ?? cars?.plan.ev9 ?? undefined} night={cars?.last_night.vehicles?.ev9 ?? cars?.last_night.ev9 ?? undefined} />
        <ExtraVehicleCards cars={cars} />
      </div>
      <CostsCard />
    </div>
  );
}

// ---------------- planned vs actual ----------------

const TONE: Record<string, string> = { batt: "bg-batt/15 text-batt", gridin: "bg-gridin/15 text-gridin", solar: "bg-solar/15 text-solar" };

function verdict(n: CarNight, complete = true): { label: string; tone: string } {
  if (!complete) return { label: "In progress", tone: "muted" };
  if (!n.plan_recorded) return { label: n.actual_kwh > 0.5 ? "Charged · no plan on record" : "No plan on record", tone: "muted" };
  const planned = n.planned_kwh ?? 0;
  if (planned < 0.5 && n.actual_kwh < 0.5) return { label: "Nothing planned", tone: "muted" };
  if (planned < 0.5) return { label: "Charged outside plan", tone: "solar" };
  const r = n.actual_kwh / planned;
  if (r < 0.5) return { label: "Under plan", tone: "gridin" };
  if (r > 1.3) return { label: "Over plan", tone: "solar" };
  return { label: "On plan", tone: "batt" };
}

function LastNight({ data }: { data: CarsData | null }) {
  const w = data?.last_night.window;
  return (
    <Card>
      <CardHeader
        label="Planned vs actual"
        title={w ? `Night of ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${w.date}T12:00:00Z`))}` : "Last night"}
        right={<span className="text-xs" style={{ color: "var(--muted)" }}>{w ? `${fmtTimeDate(w.start)} → ${fmtTimeDate(w.end)}${w.complete ? "" : " (in progress)"}` : ""}</span>}
      />
      {!data ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(data.last_night.vehicles ? Object.values(data.last_night.vehicles) : [data.last_night.tesla, data.last_night.ev9].filter(Boolean) as NonNullable<typeof data.last_night.tesla>[]).map((n) => {
            const v = verdict(n, w?.complete ?? true);
            return (
              <div key={n.car} className="rounded-xl p-4" style={{ background: "color-mix(in srgb, var(--bg-elev) 60%, transparent)", boxShadow: "0 0 0 1px var(--line)" }}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold">{n.name || n.car}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[v.tone] || ""}`} style={v.tone === "muted" ? { background: "var(--bg-elev)", color: "var(--muted)" } : undefined}>
                    {v.label}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="label text-left">
                      <th className="pb-1 font-medium" />
                      <th className="pb-1 text-right font-medium">Planned</th>
                      <th className="pb-1 text-right font-medium">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    <Tr k="Energy" a={n.plan_recorded ? fmtKwh(n.planned_kwh) : "—"} b={fmtKwh(n.actual_kwh)} />
                    <Tr k="Cost" a={n.plan_recorded ? p2gbp(n.planned_cost_p) : "—"} b={fmtGbp(n.actual_cost_gbp)} />
                    <Tr k="Morning SoC" a={n.planned_morning_soc != null ? fmtPct(n.planned_morning_soc) : "—"} b={fmtPct(n.soc_end)} />
                    <Tr k="Window" a={n.planned_slots.length ? `${fmtTime(n.planned_slots[0].start)}–${fmtTime(n.planned_slots[n.planned_slots.length - 1].end)}` : "—"} b={n.actual_first_on ? `${fmtTime(n.actual_first_on)}–${fmtTime(n.actual_last_on)}` : "—"} />
                  </tbody>
                </table>
                <div className="mt-3 space-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  <div>
                    SoC {fmtPct(n.soc_start)} → {fmtPct(n.soc_end)}
                    {n.soc_gain_kwh != null ? ` (+${n.soc_gain_kwh.toFixed(1)} kWh in the battery)` : ""}
                    {n.actual_cheap_share != null ? ` · ${Math.round(n.actual_cheap_share * 100)}% at cheap rate` : ""}
                  </div>
                  <div>Measured by {n.energy_source.replace("sensor.", "")}</div>
                  {!n.plan_recorded && <div>Predbat had no plan for this car in Home Assistant's history for that evening.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Tr({ k, a, b }: { k: string; a: string; b: string }) {
  return (
    <tr className="border-t" style={{ borderColor: "var(--line)" }}>
      <td className="py-1.5 font-sans" style={{ color: "var(--muted)" }}>{k}</td>
      <td className="py-1.5 text-right">{a}</td>
      <td className="py-1.5 text-right font-medium">{b}</td>
    </tr>
  );
}

// ---------------- car cards ----------------

function PredbatPlan({ plan }: { plan?: CarPlan }) {
  if (!plan) return null;
  return (
    <div className="mt-5 rounded-xl p-3" style={{ background: "var(--bg-elev)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Predbat plan</span>
        <span className="text-xs" style={{ color: plan.slot_active ? "#3ddc97" : "var(--muted)" }}>{plan.slot_active ? "Slot open now" : plan.slots.length ? `${plan.slots.length} slot${plan.slots.length > 1 ? "s" : ""}` : "No slots"}</span>
      </div>
      {plan.slots.length ? (
        <ul className="space-y-1 text-sm">
          {plan.slots.map((s, i) => (
            <li key={i} className="flex justify-between">
              <span>{fmtTimeDate(s.start)}–{fmtTime(s.end)}</span>
              <span className="num" style={{ color: "var(--muted)" }}>
                {s.kwh?.toFixed(1) ?? "—"} kWh · {s.rate_p?.toFixed(1) ?? "—"}p · {p2gbp(s.cost_p)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{plan.soc_now != null && plan.soc_now >= 99 ? "Battery full: nothing to charge." : "Predbat has not scheduled any charging."}</p>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Stat k="Planned" v={fmtKwh(plan.planned_kwh)} />
        <Stat k="Cost" v={p2gbp(plan.planned_cost_p)} />
        <Stat k={`By ${fmtTime(plan.morning_at)}`} v={fmtPct(plan.soc_morning)} />
      </dl>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--muted)" }}>{k}</dt>
      <dd className="num font-medium">{v}</dd>
    </div>
  );
}

function TeslaCard({ plan, iog, night }: { plan?: CarPlan; iog?: CarsData["iog"]; night?: CarNight }) {
  const { entities, variables: cfg } = useHa();
  const v = teslaOf(cfg);
  const id = v?.id || "tesla";
  const soc = num(entities, v?.soc);
  const range = num(entities, v?.range);
  const added = v?.energy_added ? num(entities, v.energy_added) : null;
  const plugged = v?.plugged ? st(entities, v.plugged) === "on" : false;
  const charging = st(entities, v?.charging) || "—";
  const power = vehiclePower(entities, cfg, v);
  const limit = num(entities, v?.charge_limit);
  const target = v?.iog_charge_target ? num(entities, v.iog_charge_target) : null;
  const ready = v?.iog_target_time ? st(entities, v.iog_target_time) : null;
  const iogState = v?.iog_state ? st(entities, v.iog_state) : null;
  const loc = v?.location ? st(entities, v.location) : null;
  const data = useCarStatus(id);
  const name = v?.name || "Car 1";
  const chargeHistoryId = chargerForVehicle(cfg, v)?.power || v?.charging_power;

  return (
    <Card>
      <CardHeader label="Tesla · Intelligent Octopus Go" title={name} right={<span className={staleCls(data.stale)}><StatusPill on={plugged} label={plugged ? "Plugged in" : loc || "Away"} /></span>} />
      <div className="-mt-1 mb-4"><CarDataBadge car={id} /></div>
      {data.stale && <LostNote name={name} status={data} predbat="Predbat reads the car's SoC and charge limit from these entities, so it currently sees them as unknown." />}
      <div className={staleCls(data.stale)}>
        <SoCBlock soc={soc} range={range} charging={charging} power={power} />
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        <KV k="Charge limit / IOG target" v={`${fmtPct(limit)} / ${fmtPct(target)} by ${ready || "—"}`} stale={data.stale} />
        <KV k="Intelligent state" v={prettyIog(iogState)} />
        <KV k="Energy added (car, this session)" v={fmtKwh(added, 2)} stale={data.stale} />
        <KV k="Charged last night" v={night ? `${fmtKwh(night.actual_kwh)} · ${fmtGbp(night.actual_cost_gbp)}` : "—"} />
      </dl>
      <PredbatPlan plan={plan} />
      <Slots title="Upcoming IOG dispatches" items={iog?.planned || []} empty="No upcoming dispatches yet. Octopus usually publishes these in the evening." />
      <Slots title="Completed IOG dispatches (recent)" items={(iog?.completed || []).slice(-6).reverse()} showKwh />
      {chargeHistoryId ? <ChargeHistory entityId={chargeHistoryId} label="Charger power (kW), last 48 hours" /> : null}
    </Card>
  );
}

function Ev9Card({ plan, night }: { plan?: CarPlan; night?: CarNight }) {
  const { entities, variables: cfg } = useHa();
  const v = ev9Of(cfg);
  const ch = chargerForVehicle(cfg, v);
  const id = v?.id || "ev9";
  const soc = num(entities, v?.soc);
  const range = num(entities, v?.range);
  const plugged = v?.plugged ? st(entities, v.plugged) === "on" : false;
  const kiaCharging = v?.charging ? st(entities, v.charging) === "on" : false;
  const kiaPower = v?.charging_power ? num(entities, v.charging_power) : null;
  const ohmeStatus = st(entities, ch?.status) || "—";
  const mode = st(entities, ch?.mode) || "unavailable";
  const ohmePower = ch?.power ? num(entities, ch.power) : num(entities, "sensor.ohme_epod_power");
  const power = vehiclePower(entities, cfg, v);
  const kiaLimit = num(entities, v?.charge_limit);
  const target = ch?.target ? num(entities, ch.target) : null;
  const remaining = v?.charge_duration ? num(entities, v.charge_duration) : null;
  const updated = v?.as_of ? st(entities, v.as_of) : null;
  const boost = v?.boost ? st(entities, v.boost) === "on" : false;
  const loc = v?.location ? st(entities, v.location) : null;
  const effMiKwh = v?.economy ? num(entities, v.economy) : null;
  const data = useCarStatus(id);
  const name = v?.name || "Car 2";
  const chName = ch?.name || "Ohme";
  const chargeHistoryId = ch?.power || v?.charging_power;

  return (
    <Card>
      <CardHeader
        label={`${v?.kind === "kia" ? "Kia" : "Vehicle"} ${name} · ${chName}${v?.predbat_index != null ? ` · Predbat car ${v.predbat_index}` : ""}`}
        title={name}
        right={
          <div className="flex gap-2">
            {boost && <StatusPill on label="Boost" />}
            <span className={staleCls(data.stale)}><StatusPill on={plugged} label={plugged ? "Plugged in" : loc || "Away"} /></span>
          </div>
        }
      />
      <div className="-mt-1 mb-4"><CarDataBadge car={id} /></div>
      {data.stale && <LostNote name={name} status={data} predbat="Predbat reads this car's SoC from the configured vehicle entities, so it currently sees it as unknown." />}
      <div className={staleCls(data.stale)}>
        <SoCBlock soc={soc} range={range} charging={kiaCharging ? "charging" : ohmeStatus} power={power} />
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        <KV k="Kia status" v={`${kiaCharging ? "Charging" : "Not charging"}${kiaPower ? ` · ${kiaPower.toFixed(1)} kW` : ""}${remaining ? ` · ${Math.round(remaining)} min left` : ""}`} stale={data.stale} />
        <KV k={chName} v={`${ohmeStatus.replaceAll("_", " ")} · ${mode.replaceAll("_", " ")}${ohmePower != null ? ` · ${ohmePower.toFixed(1)} kW` : ""}`} />
        <KV k="Limits" v={`${name} ${fmtPct(kiaLimit)} · ${chName} ${fmtPct(target)}`} stale={data.stale} />
        <KV k="Charged last night" v={night ? `${fmtKwh(night.actual_kwh)} · ${fmtGbp(night.actual_cost_gbp)}` : "—"} />
        <KV k="Efficiency (Kia)" v={effMiKwh != null ? `${effMiKwh.toFixed(1)} mi/kWh` : "—"} />
        <KV k="Car data updated" v={updated ? fmtTimeDate(updated) : "—"} />
      </dl>
      <PredbatPlan plan={plan} />
      <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        SoC and charging status come from the car integration, never from the Ohme vehicle-battery sensor. Energy is measured from the linked charger's power reading (the car's own charging power is the fallback). Boost on Overview forces a charge now.
      </p>
      {chargeHistoryId ? <ChargeHistory entityId={chargeHistoryId} label={`${chName} power, last 48 hours`} /> : null}
    </Card>
  );
}


function ExtraVehicleCards({ cars }: { cars?: CarsData | null }) {
  const { variables: cfg } = useHa();
  const known = new Set([teslaOf(cfg)?.id, ev9Of(cfg)?.id, "tesla", "ev9", "car_1", "car_2"]);
  const extras = (cfg?.vehicles || []).filter((v) => !known.has(v.id));
  if (!extras.length) return null;
  return (
    <>
      {extras.map((v) => (
        <GenericVehicleCard
          key={v.id}
          v={v}
          plan={cars?.plan.vehicles?.[v.id]}
          night={cars?.last_night.vehicles?.[v.id]}
        />
      ))}
    </>
  );
}

function GenericVehicleCard({ v, plan, night }: { v: VehicleConfig; plan?: CarPlan; night?: CarNight }) {
  const { entities, variables: cfg } = useHa();
  const ch = chargerForVehicle(cfg, v);
  const soc = num(entities, v.soc);
  const range = v.range ? num(entities, v.range) : null;
  const plugged = v.plugged ? st(entities, v.plugged) === "on" : false;
  const loc = v.location ? st(entities, v.location) : null;
  const charging = v.charging ? st(entities, v.charging) : ch?.status ? st(entities, ch.status) : null;
  const power = vehiclePower(entities, cfg, v);
  const limit = v.charge_limit ? num(entities, v.charge_limit) : null;
  const target = ch?.target ? num(entities, ch.target) : null;
  const data = useCarStatus(v.id);
  return (
    <Card>
      <CardHeader
        label={ch ? `${v.name} · ${ch.name}` : v.name}
        title={v.name}
        right={<span className={staleCls(data.stale)}><StatusPill on={plugged} label={plugged ? "Plugged in" : loc || "Away"} /></span>}
      />
      <div className="-mt-1 mb-4"><CarDataBadge car={v.id} /></div>
      {data.stale && <LostNote name={v.name} status={data} predbat="Predbat will see an unknown SoC / charge limit until the car entities return." />}
      <div className={staleCls(data.stale)}>
        <SoCBlock soc={soc} range={range} charging={charging || "—"} power={power} />
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        <KV k="Charge limit" v={fmtPct(limit)} stale={data.stale} />
        {ch && <KV k={ch.name} v={`${st(entities, ch.status || "") || "—"} · ${fmtPct(target)}`} />}
        <KV k="Charged last night" v={night ? `${fmtKwh(night.actual_kwh)} · ${fmtGbp(night.actual_cost_gbp)}` : "—"} />
      </dl>
      <PredbatPlan plan={plan} />
      {(ch?.power || v.charging_power) && <ChargeHistory entityId={ch?.power || v.charging_power || ""} label="Charge power, last 48 hours" />}
    </Card>
  );
}

// ---------------- monthly cost ----------------

function CostsCard() {
  const { data, err } = usePoll(fetchCarCosts, 10 * 60000);
  return (
    <Card>
      <CardHeader label="Charging cost per car" title="This month and last" />
      {err && <p className="text-sm text-gridin">{err}</p>}
      {!data ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading statistics…</p>
      ) : (
        <>
          <CostsFreshness data={data} />
          <div className="grid gap-4 md:grid-cols-2">
            {[data.this_month, data.last_month].map((p) => (
              <CostPeriodView key={p.label} p={p} />
            ))}
          </div>
          <details className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            <summary className="cursor-pointer select-none">How this is calculated</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {data.method.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Card>
  );
}

function CostsFreshness({ data }: { data: import("../lib/api").CarCosts }) {
  const { variables: cfg } = useHa();
  const tv = teslaOf(cfg);
  const ev = ev9Of(cfg);
  const t = useCarStatus(tv?.id || "car_1");
  const e = useCarStatus(ev?.id || "car_2");
  const lost = [
    { s: t, name: tv?.name || "Car 1", car: tv?.id || "car_1" },
    { s: e, name: ev?.name || "Car 2", car: ev?.id || "car_2" },
  ].filter((x) => x.s.stale);
  if (!lost.length) return null;
  void data;
  return (
    <div className="mb-4 space-y-2">
      {lost.map((x) => (
        <div key={x.car} className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          <CarDataBadge car={x.car} />
          <span>{x.name}'s charger power has no readings since then, so any charging during the outage is missing from this month until the data returns ({carBadgeText(x.s, x.car).split(" · ")[0].toLowerCase()}).</span>
        </div>
      ))}
    </div>
  );
}

function CostPeriodView({ p }: { p: CostPeriod }) {
  const { variables: cfg } = useHa();
  const tName = teslaOf(cfg)?.name || "Car 1";
  const eName = ev9Of(cfg)?.name || "Car 2";
  const tesla = p.tesla || { kwh: 0, cost_gbp: 0, cheap_share: null, miles: null, p_per_mile: null, mi_per_kwh: null };
  const ev = p.ev9 || { kwh: 0, cost_gbp: 0, cheap_share: null, miles: null, p_per_mile: null, mi_per_kwh: null };
  const total = tesla.cost_gbp + ev.cost_gbp;
  const tShare = total > 0 ? (tesla.cost_gbp / total) * 100 : 50;
  return (
    <div className="rounded-xl p-4" style={{ background: "color-mix(in srgb, var(--bg-elev) 60%, transparent)", boxShadow: "0 0 0 1px var(--line)" }}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{p.label}</span>
        <span className="num text-xl">{fmtGbp(p.total_gbp)}</span>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-elev)" }}>
        <div className="h-full bg-gridin/80" style={{ width: `${tShare}%` }} />
        <div className="h-full bg-car" style={{ width: `${100 - tShare}%` }} />
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="label text-left">
            <th className="pb-1 font-medium" />
            <th className="pb-1 text-right font-medium">kWh</th>
            <th className="pb-1 text-right font-medium">Cost</th>
            <th className="pb-1 text-right font-medium">At cheap rate</th>
            <th className="pb-1 text-right font-medium">p/mile</th>
          </tr>
        </thead>
        <tbody className="num">
          <tr className="border-t" style={{ borderColor: "var(--line)" }}>
            <td className="py-1.5 font-sans"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gridin/80" />{tName}</td>
            <td className="py-1.5 text-right">{tesla.kwh.toFixed(0)}</td>
            <td className="py-1.5 text-right">{fmtGbp(tesla.cost_gbp)}</td>
            <td className="py-1.5 text-right">{tesla.cheap_share != null ? `${Math.round(tesla.cheap_share * 100)}%` : "—"}</td>
            <td className="py-1.5 text-right">{tesla.p_per_mile != null ? `${tesla.p_per_mile.toFixed(1)}p` : "—"}</td>
          </tr>
          <tr className="border-t" style={{ borderColor: "var(--line)" }}>
            <td className="py-1.5 font-sans"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-car" />{eName}</td>
            <td className="py-1.5 text-right">{ev.kwh.toFixed(0)}</td>
            <td className="py-1.5 text-right">{fmtGbp(ev.cost_gbp)}</td>
            <td className="py-1.5 text-right">{ev.cheap_share != null ? `${Math.round(ev.cheap_share * 100)}%` : "—"}</td>
            <td className="py-1.5 text-right">{ev.p_per_mile != null ? `${ev.p_per_mile.toFixed(1)}p` : "—"}</td>
          </tr>
        </tbody>
      </table>
      {ev.miles != null && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {eName} drove {ev.miles.toFixed(0)} mi{ev.mi_per_kwh != null ? ` · ${ev.mi_per_kwh.toFixed(2)} mi per home kWh` : ""}
        </p>
      )}
    </div>
  );
}

// ---------------- shared bits ----------------

type Dispatch = { start?: string; end?: string; kwh?: number | null; source?: string | null };

function SoCBlock({ soc, range, charging, power }: { soc: number | null; range: number | null; charging: string; power: number | null }) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="num text-5xl font-medium leading-none text-car">{fmtPct(soc)}</div>
        <div className="text-right text-sm" style={{ color: "var(--muted)" }}>
          <div>{range != null ? `${Math.round(range)} mi` : "Range —"}</div>
          <div className="capitalize">{charging.replaceAll("_", " ")}</div>
          {power != null && power > 0.05 && <div>{power.toFixed(2)} kW</div>}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-elev)" }}>
        <div className="h-full rounded-full bg-car" style={{ width: `${Math.max(0, Math.min(100, soc ?? 0))}%` }} />
      </div>
    </div>
  );
}

function LostNote({ name, status, predbat }: { name: string; status: ReturnType<typeof useCarStatus>; predbat: string }) {
  return (
    <div className="mb-4 rounded-xl px-3 py-2.5 text-xs leading-relaxed ring-1 ring-solar/30" style={{ background: "color-mix(in srgb, var(--bg-elev) 70%, transparent)" }}>
      <span className="font-semibold text-solar">Showing last known values.</span>{" "}
      <span style={{ color: "var(--muted)" }}>
        Home Assistant has reported {name} as “{status.live_state || "unknown"}” since {fmtWhen(status.lost_since)}; the car was last seen at {fmtWhen(status.last_seen)}. {predbat} It usually clears the next time the car wakes.
      </span>
    </div>
  );
}

function KV({ k, v, stale }: { k: string; v: string; stale?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${stale ? "opacity-45" : ""}`}>
      <dt style={{ color: "var(--muted)" }}>{k}</dt>
      <dd className="max-w-[62%] text-right font-medium">{v}</dd>
    </div>
  );
}

function StatusPill({ on, label }: { on: boolean; label: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-batt/15 text-batt" : ""}`} style={!on ? { color: "var(--muted)", background: "var(--bg-elev)" } : undefined}>{label}</span>;
}

function Slots({ title, items, empty, showKwh }: { title: string; items: Dispatch[]; empty?: string; showKwh?: boolean }) {
  return (
    <div className="mt-5">
      <div className="label mb-2">{title}</div>
      {items.length ? (
        <ul className="space-y-1.5 text-sm">
          {items.map((s, i) => (
            <li key={i} className="flex justify-between rounded-lg px-3 py-2" style={{ background: "var(--bg-elev)" }}>
              <span>{fmtTimeDate(s.start)}–{fmtTime(s.end)}</span>
              <span style={{ color: "var(--muted)" }}>{showKwh && s.kwh != null ? `${s.kwh.toFixed(2)} kWh` : s.kwh != null ? `~${s.kwh.toFixed(1)} kWh` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{empty || "None"}</p>
      )}
    </div>
  );
}

function prettyIog(s: string | null) {
  if (!s) return "—";
  return s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function ChargeHistory({ entityId, label }: { entityId: string; label: string }) {
  const [pts, setPts] = useState<{ t: string; v: number }[] | null>(null);
  const [ref, width] = useWidth();
  const [winStart, setWinStart] = useState(() => Date.now() - 48 * 3600 * 1000);
  const winEnd = winStart + 48 * 3600 * 1000;
  // Numeric time axis: stepped power held to "now" so the last state extends to the right edge.
  const series = (pts || []).map((p) => ({ ts: Date.parse(p.t), v: p.v })).filter((p) => Number.isFinite(p.ts));
  if (series.length) series.push({ ts: Math.max(winEnd, series[series.length - 1].ts), v: series[series.length - 1].v });
  useEffect(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 48 * 3600 * 1000);
    setWinStart(start.getTime());
    fetchHistory([entityId], start.toISOString(), end.toISOString())
      .then((r) => {
        const s = r.series[0];
        setPts((s?.points || []).filter((p) => typeof p.v === "number").map((p) => ({ t: p.t, v: p.v as number })));
      })
      .catch(() => setPts([]));
  }, [entityId]);
  return (
    <div className="mt-6">
      <div className="label mb-2">{label}</div>
      <div ref={ref} className="h-[150px]">
        {pts && pts.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="ts" {...timeAxisProps(winStart, winEnd, width - 40)} />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} width={32} tickFormatter={(v) => `${v}`} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}
                labelFormatter={fmtTimeFull}
                formatter={(v: number) => [`${Number(v).toFixed(2)} kW`, "Power"]}
              />
              <Area type="stepAfter" dataKey="v" stroke="#22d3ee" fill="rgba(34,211,238,0.18)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--muted)" }}>
            {pts ? "No charger power in this window" : "Loading…"}
          </div>
        )}
      </div>
    </div>
  );
}

