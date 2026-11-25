/** Settings → PowerPrint appliances: add, rename, colour/icon, rate override, shiftable, merge, delete. */
import { useState } from "react";
import clsx from "clsx";
import { Merge, Pencil, Plus, Trash2 } from "lucide-react";
import { fetchPowerPrint, manageAppliance, type PPAppliance, type PowerPrintData } from "../lib/api";
import { usePoll } from "../lib/store";
import { Card, CardHeader } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { ApplianceIcon, ICONS } from "./ApplianceIcon";

const field = { background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)", color: "var(--text)" };

function Row({ a, data, onChanged }: { a: PPAppliance; data: PowerPrintData; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(a.name);
  const [color, setColor] = useState(a.color || "#94a3b8");
  const [icon, setIcon] = useState(a.icon || "plug");
  const [rate, setRate] = useState(a.rate_override_p != null ? String(a.rate_override_p) : "");
  const [shift, setShift] = useState(a.shiftable !== false);
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState<null | "delete" | "merge">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const runs = data.events.filter((e) => e.labels.includes(a.id)).length;
  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await manageAppliance(body);
      if (!r.ok) throw new Error(r.error || "failed");
      setConfirm(null);
      onChanged();
      return true;
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const dirty = name !== a.name || color !== (a.color || "#94a3b8") || icon !== (a.icon || "plug") || rate !== (a.rate_override_p != null ? String(a.rate_override_p) : "") || shift !== (a.shiftable !== false);
  return (
    <li className="py-2.5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${a.color || "#94a3b8"}26` }}>
          <ApplianceIcon icon={a.icon} color={a.color} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{a.name}</div>
          <div className="text-[11px]" style={{ color: "var(--muted)" }}>
            {runs} labelled run{runs === 1 ? "" : "s"} · {a.rate_override_p != null ? `fixed ${a.rate_override_p}p/kWh` : "import rate"} · {a.shiftable === false ? "not shiftable" : "shiftable"}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs" style={field}>
          <Pencil size={12} /> {open ? "Close" : "Edit"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl p-3" style={{ background: "var(--bg-elev)" }}>
          <label className="block text-xs">
            <span className="label">Name</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-1.5 text-sm outline-none" style={{ ...field, background: "var(--card)" }} />
          </label>
          <div>
            <div className="label mb-1 text-xs">Colour</div>
            <div className="flex flex-wrap gap-1.5">
              {data.options.colors.map((c) => (
                <button key={c} type="button" aria-label={`colour ${c}`} onClick={() => setColor(c)} className={clsx("h-6 w-6 rounded-full", color === c && "ring-2 ring-offset-2 ring-offset-[var(--bg-elev)]")} style={{ background: c, ["--tw-ring-color" as string]: c }} />
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1 text-xs">Icon</div>
            <div className="flex flex-wrap gap-1.5">
              {data.options.icons.filter((i) => ICONS[i]).map((i) => (
                <button key={i} type="button" aria-label={i} onClick={() => setIcon(i)} className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", icon === i && "ring-1")} style={{ background: "var(--card)", ["--tw-ring-color" as string]: color }}>
                  <ApplianceIcon icon={i} color={icon === i ? color : undefined} size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="label">Rate override (p/kWh)</span>
              <input value={rate} inputMode="decimal" placeholder="blank = actual import rate" onChange={(e) => setRate(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-1.5 text-sm outline-none" style={{ ...field, background: "var(--card)" }} />
              <span className="mt-1 block text-[11px]" style={{ color: "var(--muted)" }}>For an appliance on its own meter or tariff. Its runs are priced at this flat rate.</span>
            </label>
            <label className="flex items-start gap-2 text-xs sm:pt-5">
              <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} className="mt-0.5" />
              <span>
                Can run off-peak
                <span className="block text-[11px]" style={{ color: "var(--muted)" }}>Used for the "shift to 23:30–05:30" savings tips.</span>
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!dirty || busy} onClick={() => call({ op: "update", id: a.id, name, color, icon, shiftable: shift, rate_override_p: rate.trim() === "" ? null : Number(rate) }).then((ok) => ok && setOpen(false))} className="rounded-lg bg-batt/20 px-3 py-1.5 text-xs font-semibold text-batt disabled:opacity-40">
              Save
            </button>
            <span className="mx-1 h-4 w-px" style={{ background: "var(--line)" }} />
            <select value={into} onChange={(e) => setInto(e.target.value)} className="rounded-lg px-2 py-1.5 text-xs" style={{ ...field, background: "var(--card)" }}>
              <option value="">Merge into…</option>
              {data.appliances.filter((x) => x.id !== a.id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
            <button type="button" disabled={!into || busy} onClick={() => setConfirm("merge")} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40" style={{ ...field, background: "var(--card)" }}>
              <Merge size={12} /> Merge
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm("delete")} className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-gridin" style={{ ...field, background: "var(--card)" }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
          {err && <div className="text-xs text-gridin">{err}</div>}
        </div>
      )}
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete ${a.name}?`}
        body={`${runs} labelled run${runs === 1 ? "" : "s"} lose this label; runs with no other label go back to the inbox. What PowerPrint learned for ${a.name} is dropped.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        error={err}
        onCancel={() => setConfirm(null)}
        onConfirm={() => call({ op: "delete", id: a.id })}
      />
      <ConfirmDialog
        open={confirm === "merge"}
        title={`Merge ${a.name} into ${data.appliances.find((x) => x.id === into)?.name ?? "…"}?`}
        body={`All ${runs} run${runs === 1 ? "" : "s"} labelled ${a.name} are relabelled, and ${a.name} is removed.`}
        confirmLabel="Merge"
        busy={busy}
        error={err}
        onCancel={() => setConfirm(null)}
        onConfirm={() => call({ op: "merge", id: a.id, into })}
      />
    </li>
  );
}

export function ApplianceEditor() {
  const [tick, setTick] = useState(0);
  const { data, err } = usePoll(() => fetchPowerPrint(120), 0, [tick]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => setTick((t) => t + 1);
  return (
    <Card>
      <CardHeader label="PowerPrint" title="Appliances" />
      {err && <p className="text-sm text-gridin">{err}</p>}
      {data && (
        <>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {data.appliances.map((a) => (
              <Row key={`${a.id}-${a.name}-${a.color}-${a.icon}-${a.rate_override_p}-${a.shiftable}`} a={a} data={data} onChanged={refresh} />
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const r = await manageAppliance({ op: "add", name: name.trim() }).catch((x) => ({ ok: false, error: String(x) }));
              setMsg(r.ok ? null : r.error || "failed");
              if (r.ok) {
                setName("");
                refresh();
              }
            }}
          >
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Add an appliance…" className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm outline-none" style={field} />
            <button type="submit" disabled={!name.trim()} className="flex items-center gap-1 rounded-lg bg-batt/20 px-3 py-1.5 text-xs font-semibold text-batt disabled:opacity-40">
              <Plus size={13} /> Add
            </button>
          </form>
          {msg && <p className="mt-2 text-xs text-gridin">{msg}</p>}
          <p className="mt-3 text-[11px]" style={{ color: "var(--muted)" }}>Changes are saved on the Hearth server and recorded in the audit log. Nothing is sent to Home Assistant.</p>
        </>
      )}
    </Card>
  );
}
