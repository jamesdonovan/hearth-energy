import { DayBudgetLine } from "../components/DayBudget";
import { CarDataBadge, staleCls, useCarStatus, type CarKey } from "../components/CarData";
import { useMemo, useState } from "react";
import { useHa } from "../lib/store";
import { chargerForVehicle, ev9Of, flowIdsFrom, predbatId, siteId, tariffId, teslaOf } from "../lib/variables";
import { attr, cheapImport, flows, num, options, st } from "../lib/derived";
import { fmtHours, fmtKw, fmtKwh, fmtPence, fmtPct, fmtRateGbp, windowLabel } from "../lib/format";
import { Card, CardHeader, Metric } from "../components/Card";
import { PowerFlow } from "../components/PowerFlow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { postAction } from "../lib/api";
import { Link } from "react-router-dom";
import { TonightCard } from "../components/TonightCard";

type Pending = {
  title: string;
  body: string;
  danger?: boolean;
  run: () => Promise<void>;
};

export function Overview() {
  const { entities, loading, error, variables: cfg } = useHa();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [keepDraft, setKeepDraft] = useState<number | null>(null);

  const tesla = teslaOf(cfg);
  const ev9 = ev9Of(cfg);
  const ev9Ch = chargerForVehicle(cfg, ev9);
  const pwSoc = siteId(cfg, "pw_soc");
  const importRate = tariffId(cfg, "import_rate");
  const importNext = tariffId(cfg, "import_next_rate");
  const exportRate = tariffId(cfg, "export_current_rate");
  const exportNext = tariffId(cfg, "export_next_rate");
  const f = flows(entities, flowIdsFrom(cfg));
  const soc = num(entities, pwSoc);
  const socKwh = num(entities, predbatId(cfg, "soc_kw_h0", "predbat.soc_kw_h0"));
  const hoursLeft = num(entities, predbatId(cfg, "best_battery_hours_left", "predbat.best_battery_hours_left"));
  const importGbp = num(entities, importRate);
  const nextImportGbp = num(entities, importNext);
  const exportGbp = num(entities, exportRate);
  const nextExportGbp = num(entities, exportNext);
  const importStart = attr<string>(entities, importRate, "start");
  const importEnd = attr<string>(entities, importRate, "end");
  const nextImportStart = attr<string>(entities, importNext, "start");
  const nextImportEnd = attr<string>(entities, importNext, "end");
  const exportStart = attr<string>(entities, exportRate, "start");
  const offPeak = cheapImport(entities, tariffId(cfg, "off_peak"));
  const costToday = num(entities, predbatId(cfg, "cost_today", "predbat.cost_today"));
  const savingsY = num(entities, predbatId(cfg, "savings_yesterday_predbat", "predbat.savings_yesterday_predbat"));
  const statusId = predbatId(cfg, "status", "predbat.status");
  const modeId = predbatId(cfg, "mode", "select.predbat_mode");
  const status = st(entities, statusId) || "—";
  const mode = st(entities, modeId) || "—";
  const chargeStart = st(entities, predbatId(cfg, "best_charge_start", "predbat.best_charge_start"));
  const chargeEnd = st(entities, predbatId(cfg, "best_charge_end", "predbat.best_charge_end"));
  const exportStartP = st(entities, predbatId(cfg, "best_export_start", "predbat.best_export_start"));
  const exportEndP = st(entities, predbatId(cfg, "best_export_end", "predbat.best_export_end"));
  const lowStart = st(entities, predbatId(cfg, "low_rate_start", "predbat.low_rate_start"));
  const nextAction = useMemo(() => {
    if (status && status !== "Demand") return `Now: ${status}`;
    if (exportStartP) return `Next export ${exportStartP}–${exportEndP || ""}`.trim();
    if (chargeStart) return `Next charge ${chargeStart}–${chargeEnd || ""}`.trim();
    return "Following solar and house load";
  }, [status, chargeStart, chargeEnd, exportStartP, exportEndP]);

  const keepId = predbatId(cfg, "best_soc_keep", "input_number.predbat_best_soc_keep");
  const keep = num(entities, keepId) ?? 0;
  const keepValue = keepDraft ?? keep;
  const keepMax = Number(cfg?.site?.pw_capacity_kwh) || 13.5;
  const readOnlyId = predbatId(cfg, "set_read_only", "switch.predbat_set_read_only");
  const readOnly = st(entities, readOnlyId) === "on";
  const boostId = ev9?.boost;
  const boost = boostId ? st(entities, boostId) === "on" : false;
  const ohmeModeId = ev9Ch?.mode;
  const ohmeMode = st(entities, ohmeModeId);
  const ohmeAvail = ohmeMode != null;
  const teslaSwitchId = tesla?.charge_switch;
  const teslaCharge = st(entities, teslaSwitchId) === "on";
  const teslaName = tesla?.name || "Car 1";
  const ev9Name = ev9?.name || "Car 2";
  const ev9ChName = ev9Ch?.name || "Ohme";

  function confirm(p: Pending) {
    setActionError(null);
    setPending(p);
  }
  async function apply() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await pending.run();
      setPending(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !Object.keys(entities).length) {
    return <div style={{ color: "var(--muted)" }}>Connecting to Home Assistant…</div>;
  }
  if (error && !Object.keys(entities).length) {
    return <div className="text-gridin">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Live house power, tariffs and the next Predbat move.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 ${offPeak ? "bg-batt/15 text-batt" : "bg-gridin/15 text-gridin"}`}>
            {offPeak ? "Off-peak import" : "Peak import"}
          </span>
          <span className="rounded-full bg-white/5 px-2.5 py-1" style={{ color: "var(--muted)" }}>
            Predbat {status}
          </span>
        </div>
      </div>

      <Card pad={false} className="overflow-hidden p-4 sm:p-5">
        <CardHeader label="Live flow" title="Site right now" />
        <PowerFlow entities={entities} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Metric
            label="Powerwall"
            value={fmtPct(soc, 1)}
            hint={`${fmtKwh(socKwh, 2)} · ${
              f.batteryCharge > 0.05
                ? `charging ${fmtKw(f.batteryCharge)}`
                : f.batteryDischarge > 0.05
                  ? `discharging ${fmtKw(f.batteryDischarge)}`
                  : "idle"
            }`}
            tone="batt"
          />
          <div className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
            Plan reaches reserve in {fmtHours(hoursLeft)}
          </div>
        </Card>
        <Card>
          <Metric
            label="Import rate"
            value={fmtRateGbp(importGbp)}
            hint={`${windowLabel(importStart, importEnd)} · next ${fmtRateGbp(nextImportGbp)} at ${windowLabel(nextImportStart, nextImportEnd)}`}
            tone={offPeak ? "batt" : "gridin"}
          />
        </Card>
        <Card>
          <Metric
            label="Export rate"
            value={fmtRateGbp(exportGbp)}
            hint={`This slot ${windowLabel(exportStart, attr<string>(entities, exportRate, "end"))} · next ${fmtRateGbp(nextExportGbp)}`}
            tone="gridout"
          />
        </Card>
        <Card>
          <Metric label="Cost today" value={fmtPence(costToday)} hint={`Yesterday Predbat saved ${fmtPence(savingsY)}`} />
          <DayBudgetLine />
          <div className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Solar so far {fmtKwh(num(entities, predbatId(cfg, "pv_energy_h0", "predbat.pv_energy_h0")))} · house {fmtKwh(num(entities, predbatId(cfg, "load_energy_h0", "predbat.load_energy_h0")))}
          </div>
        </Card>
      </div>

      <TonightCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader label="Predbat" title={mode} right={<Link to="/energy" className="text-xs text-gridout">Open plan →</Link>} />
          <div className="space-y-3 text-sm">
            <Row k="Status" v={status} />
            <Row k="Next action" v={nextAction} />
            <Row k="Cheap import" v={lowStart ? `from ${lowStart}` : "—"} />
            <Row k="Read only" v={readOnly ? "On — Predbat will not control" : "Off — Predbat is in control"} />
            <Row k="Version" v={String(attr(entities, statusId, "version") || attr(entities, predbatId(cfg, "version", "update.predbat_version"), "installed_version") || "—")} />
          </div>
        </Card>

        <Card>
          <CardHeader label={tesla?.kind === "tesla_iog" ? "Tesla" : tesla?.kind || "Vehicle"} title={teslaName} right={<Link to="/cars" className="text-xs text-gridout">Cars →</Link>} />
          <div className="-mt-1 mb-3"><CarDataBadge car={tesla?.id || "tesla"} /></div>
          <CarMini
            car={tesla?.id || "tesla"}
            soc={num(entities, tesla?.soc)}
            range={num(entities, tesla?.range)}
            rangeUnit="mi"
            plugged={tesla?.plugged ? st(entities, tesla.plugged) === "on" : false}
            charging={st(entities, tesla?.charging)}
            limit={num(entities, tesla?.charge_limit)}
            slotOn={tesla?.predbat_slot ? st(entities, tesla.predbat_slot) === "on" : false}
            next={slotHint(entities, tesla?.predbat_slot || "binary_sensor.predbat_car_charging_slot", tesla?.iog_dispatching || undefined)}
          />
        </Card>
        <Card>
          <CardHeader label={ev9?.kind === "kia" ? "Kia" : ev9?.kind || "Vehicle"} title={ev9Ch ? `${ev9Name} · ${ev9ChName}` : ev9Name} right={<Link to="/cars" className="text-xs text-gridout">Cars →</Link>} />
          <div className="-mt-1 mb-3"><CarDataBadge car={ev9?.id || "ev9"} /></div>
          <CarMini
            car={ev9?.id || "ev9"}
            soc={num(entities, ev9?.soc)}
            range={num(entities, ev9?.range)}
            rangeUnit="mi"
            plugged={ev9?.plugged ? st(entities, ev9.plugged) === "on" : false}
            charging={st(entities, ev9Ch?.status || ev9?.charging)}
            limit={num(entities, ev9?.charge_limit || ev9Ch?.target)}
            slotOn={ev9?.predbat_slot ? st(entities, ev9.predbat_slot) === "on" : false}
            next={slotHint(entities, ev9?.predbat_slot || "binary_sensor.predbat_car_charging_slot_1")}
            boost={boost}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          label="Controls"
          title="Key actions"
          right={<span className="text-xs" style={{ color: "var(--muted)" }}>Each change asks for confirmation</span>}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            {boostId && <ToggleRow
              label={`${ev9Name} Boost`}
              hint="Turns off peak protection and Predbat Ohme control, then forces max charge."
              on={boost}
              onToggle={() =>
                confirm({
                  title: boost ? `Turn ${ev9Name} Boost off?` : `Turn ${ev9Name} Boost on?`,
                  danger: !boost,
                  body: boost
                    ? "This re-enables Prevent Peak Charge and the Predbat Ohme slot automation, then sets Ohme to match the Predbat slot (max charge if the slot is open, otherwise paused)."
                    : "This will switch off peak-rate protection and Predbat’s Ohme automation, then set the charger to max charge. Only use this when you intentionally want to charge the car now, including at peak rates.",
                  run: () =>
                    postAction({
                      domain: "input_boolean",
                      service: boost ? "turn_off" : "turn_on",
                      entity_id: boostId,
                    }).then(() => undefined),
                })
              }
            />}
            {ohmeModeId && <SelectRow
              label={`${ev9ChName} charge mode`}
              value={ohmeAvail ? ohmeMode! : "unavailable"}
              disabled={!ohmeAvail}
              hint={!ohmeAvail ? "The charger select is unavailable while the session is finished. It usually returns after a replug." : "Direct Ohme mode. Prefer the boost control if you also need to lift peak protection."}
              opts={ohmeAvail ? options(entities, ohmeModeId) : ["unavailable"]}
              onChange={(option) =>
                confirm({
                  title: `Set ${ev9ChName} to ${option}?`,
                  danger: option === "max_charge",
                  body: `This changes ${ohmeModeId} from ${ohmeMode ?? "unavailable"} to ${option}.`,
                  run: () =>
                    postAction({
                      domain: "select",
                      service: "select_option",
                      entity_id: ohmeModeId,
                      option,
                    }).then(() => undefined),
                })
              }
            />}
            {teslaSwitchId && <ToggleRow
              label={`${teslaName} charge`}
              hint={`Tesla charge switch is currently ${teslaCharge ? "on" : "off"}.`}
              on={teslaCharge}
              onToggle={() =>
                confirm({
                  title: teslaCharge ? `Stop charging ${teslaName}?` : `Start charging ${teslaName}?`,
                  danger: !teslaCharge,
                  body: `This toggles ${teslaSwitchId} on the car. Intelligent Octopus usually manages charging; use this only as a manual override.`,
                  run: () =>
                    postAction({
                      domain: "switch",
                      service: teslaCharge ? "turn_off" : "turn_on",
                      entity_id: teslaSwitchId,
                    }).then(() => undefined),
                })
              }
            />}
          </div>
          <div className="space-y-4">
            <SelectRow
              label="Predbat mode"
              value={mode}
              opts={options(entities, modeId)}
              onChange={(option) =>
                confirm({
                  title: `Set Predbat to “${option}”?`,
                  danger: option === "Monitor",
                  body: `This changes how Predbat controls the Powerwall, from “${mode}” to “${option}”.`,
                  run: () =>
                    postAction({
                      domain: "select",
                      service: "select_option",
                      entity_id: modeId,
                      option,
                    }).then(() => undefined),
                })
              }
            />
            <ToggleRow
              label="Predbat read only"
              hint="When on, Predbat still plans but will not send commands to the Powerwall."
              on={readOnly}
              onToggle={() =>
                confirm({
                  title: readOnly ? "Leave read-only mode?" : "Put Predbat in read only?",
                  danger: !readOnly,
                  body: readOnly
                    ? "Predbat will start sending charge and discharge commands to the Powerwall again."
                    : "Predbat will keep calculating a plan but will not change the Powerwall until you turn this off.",
                  run: () =>
                    postAction({
                      domain: "switch",
                      service: readOnly ? "turn_off" : "turn_on",
                      entity_id: readOnlyId,
                    }).then(() => undefined),
                })
              }
            />
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>Best SoC keep</span>
                <span className="num text-batt">{keepValue.toFixed(1)} kWh</span>
              </div>
              <input
                type="range"
                min={0}
                max={keepMax}
                step={0.1}
                value={keepValue}
                onChange={(e) => setKeepDraft(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={keepDraft == null || keepDraft === keep}
                  className="rounded-lg bg-batt px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-40"
                  onClick={() =>
                    confirm({
                      title: `Set best SoC keep to ${keepValue.toFixed(1)} kWh?`,
                      body: `Predbat will try to hold at least ${keepValue.toFixed(1)} kWh in the Powerwall through the evening. It is currently ${keep.toFixed(1)} kWh.`,
                      run: async () => {
                        await postAction({
                          domain: "input_number",
                          service: "set_value",
                          entity_id: keepId,
                          value: keepValue,
                        });
                        setKeepDraft(null);
                      },
                    })
                  }
                >
                  Apply
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([{ id: predbatId(cfg, "manual_charge", "select.predbat_manual_charge"), key: "manual_charge" }, { id: predbatId(cfg, "manual_export", "select.predbat_manual_export"), key: "manual_export" }, { id: predbatId(cfg, "manual_freeze_charge", "select.predbat_manual_freeze_charge"), key: "freeze_charge" }, { id: predbatId(cfg, "manual_freeze_export", "select.predbat_manual_freeze_export"), key: "freeze_export" }]).map(({ id, key }) => (
                <SelectRow
                  key={key}
                  compact
                  label={
                    key === "manual_charge"
                      ? "Force charge"
                      : key === "manual_export"
                        ? "Force export"
                        : key === "freeze_charge"
                          ? "Freeze charge"
                          : "Freeze export"
                  }
                  value={st(entities, id) || "off"}
                  opts={["off", ...options(entities, id).filter((o) => o !== "off").slice(0, 16)]}
                  onChange={(option) =>
                    confirm({
                      title: `Set ${key.replaceAll("_", " ")} to ${option}?`,
                      danger: option !== "off",
                      body: "This is a Predbat manual override for a half-hour slot. Choose off to clear it.",
                      run: () =>
                        postAction({
                          domain: "select",
                          service: "select_option",
                          entity_id: id,
                          option,
                        }).then(() => undefined),
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!pending}
        title={pending?.title || ""}
        body={pending?.body || ""}
        danger={pending?.danger}
        busy={busy}
        error={actionError}
        onCancel={() => { setPending(null); setActionError(null); }}
        onConfirm={apply}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className="max-w-[60%] text-right font-medium">{v}</span>
    </div>
  );
}

function CarMini({
  car, soc, range, rangeUnit, plugged, charging, limit, slotOn, next, boost,
}: {
  car: CarKey;
  soc: number | null;
  range: number | null;
  rangeUnit: string;
  plugged: boolean;
  charging: string | null;
  limit: number | null;
  slotOn: boolean;
  next: string;
  boost?: boolean;
}) {
  const { stale } = useCarStatus(car);
  return (
    <div className="space-y-3 text-sm">
      <div className={`flex items-end justify-between ${staleCls(stale)}`}>
        <div className="num text-3xl font-medium text-car">{fmtPct(soc)}</div>
        <div style={{ color: "var(--muted)" }}>{range != null ? `${Math.round(range)} ${rangeUnit}` : " "}</div>
      </div>
      <div className={`flex flex-wrap gap-2 text-xs ${staleCls(stale)}`}>
        <Chip on={plugged} label={plugged ? "Plugged in" : "Unplugged"} />
        <Chip on={slotOn} label={slotOn ? "Predbat slot" : "No slot"} />
        {boost && <Chip on label="Boost" />}
      </div>
      <div className={`space-y-3 ${staleCls(stale)}`}>
        <Row k="Status" v={charging || "—"} />
        <Row k="Target" v={fmtPct(limit)} />
      </div>
      <Row k="Next slot" v={next} />
    </div>
  );
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${on ? "bg-batt/15 text-batt" : "bg-white/5"}`} style={!on ? { color: "var(--muted)" } : undefined}>
      {label}
    </span>
  );
}

function ToggleRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{hint}</p>}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-batt" : "bg-white/15"}`}
        aria-pressed={on}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${on ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function SelectRow({
  label, value, opts, onChange, hint, disabled, compact,
}: {
  label: string;
  value: string;
  opts: string[];
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <div className={`mb-1 ${compact ? "text-xs" : "text-sm font-medium"}`}>{label}</div>
      <select
        disabled={disabled || opts.length === 0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border-0 px-3 py-2 text-sm outline-none disabled:opacity-50"
        style={{ background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" }}
      >
        {!opts.includes(value) && <option value={value}>{value}</option>}
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{hint}</p>}
    </label>
  );
}

function slotHint(entities: Record<string, import("../lib/api").HaEntity>, predSlot: string, iog?: string) {
  if (st(entities, predSlot) === "on") return "Open now";
  const planned = attr<unknown[]>(entities, predSlot, "planned") || [];
  if (Array.isArray(planned) && planned.length) {
    const first = planned[0] as Record<string, unknown>;
    const fmt = (v: unknown) => {
      const m = String(v ?? "").match(/^\d{2}-\d{2}[ T](\d{2}:\d{2})/);
      return m ? m[1] : String(v ?? "");
    };
    if (first.start) return `Predbat ${fmt(first.start)}–${fmt(first.end)}`;
    return "Planned";
  }
  if (iog) {
    const next = attr<string>(entities, iog, "next_start");
    if (next) return `IOG ${windowLabel(next, attr<string>(entities, iog, "next_end"))}`;
    const list = attr<unknown[]>(entities, iog, "planned_dispatches") || [];
    if (list.length) {
      const f = list[0] as { start?: string; end?: string };
      return `IOG ${windowLabel(f.start, f.end)}`;
    }
  }
  return "None scheduled";
}
