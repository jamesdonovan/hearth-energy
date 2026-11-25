import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  fetchVariables,
  importVariables,
  resetVariables,
  saveVariables,
  searchEntities,
  type ChargerKind,
  type EntityHint,
  type FieldMeta,
  type OfficialStats,
  type ValidationIssue,
  type VariablesConfig,
  type VariablesSchema,
  type VehicleKind,
} from "../lib/api";
import { useHa } from "../lib/store";
import { blankCharger, blankVehicle } from "../lib/variables";
import { Card, CardHeader } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";

function groupFields(fields: FieldMeta[]) {
  const groups: { name: string; fields: FieldMeta[] }[] = [];
  for (const f of fields) {
    const last = groups[groups.length - 1];
    if (last && last.name === f.group) last.fields.push(f);
    else groups.push({ name: f.group, fields: [f] });
  }
  return groups;
}

function inputStyle(): React.CSSProperties {
  return { background: "var(--bg-elev)", color: "var(--text)", boxShadow: "0 0 0 1px var(--line)" };
}

function EntityPicker({
  value,
  onChange,
  domains,
  units,
  optional,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  domains?: string[];
  units?: string[];
  optional?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<EntityHint[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const domain = domains?.length === 1 ? domains[0] : "";
      searchEntities(q, domain, 40)
        .then((r) => {
          let list = r.entities;
          if (domains && domains.length > 1) list = list.filter((e) => domains.includes(e.domain));
          setHits(list);
        })
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, domains]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={box} className="relative">
      <input
        value={q}
        placeholder={placeholder || (optional ? "Optional entity id" : "entity_id")}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value.trim());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl px-3 py-2 font-mono text-xs outline-none sm:text-sm"
        style={inputStyle()}
        autoComplete="off"
        spellCheck={false}
      />
      {open && hits.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl py-1 text-sm shadow-lg"
          style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line), 0 12px 40px rgba(0,0,0,.35)" }}
        >
          {hits.map((h) => (
            <li key={h.entity_id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-white/5"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(h.entity_id);
                  setQ(h.entity_id);
                  setOpen(false);
                }}
              >
                <div className="font-mono text-xs">{h.entity_id}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {[h.friendly_name, h.unit, h.state].filter(Boolean).join(" · ")}
                  {units?.length && h.unit && !units.includes(h.unit) ? " · unexpected unit" : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldInput({
  meta,
  value,
  onChange,
}: {
  meta: FieldMeta;
  value: string | number | null | undefined;
  onChange: (v: string | number | null) => void;
}) {
  if (meta.kind === "number") {
    return (
      <input
        type="number"
        step="any"
        value={value == null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-40 rounded-xl px-3 py-2 text-sm outline-none"
        style={inputStyle()}
      />
    );
  }
  if (meta.kind === "time") {
    return (
      <input
        type="time"
        value={String(value || "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-36 rounded-xl px-3 py-2 text-sm outline-none"
        style={inputStyle()}
      />
    );
  }
  if (meta.kind === "select" && meta.options) {
    return (
      <select
        value={String(value || "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
        style={inputStyle()}
      >
        {meta.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (meta.kind === "stat" || meta.kind === "string") {
    return (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full rounded-xl px-3 py-2 font-mono text-xs outline-none sm:text-sm"
        style={inputStyle()}
        placeholder={meta.kind === "stat" ? "octopus_energy:…" : meta.optional ? "Optional" : ""}
      />
    );
  }
  return (
    <EntityPicker
      value={String(value ?? "")}
      onChange={(id) => onChange(id)}
      domains={meta.domains}
      units={meta.units}
      optional={meta.optional}
    />
  );
}

function FieldList({
  fields,
  get,
  set,
}: {
  fields: FieldMeta[];
  get: (key: string) => string | number | null | undefined;
  set: (key: string, v: string | number | null) => void;
}) {
  return (
    <div className="space-y-6">
      {groupFields(fields).map((g) => (
        <div key={g.name}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {g.name}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f.key} className="block">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{f.label}</span>
                  {f.optional && (
                    <span className="text-[10px] uppercase" style={{ color: "var(--muted)" }}>
                      optional
                    </span>
                  )}
                  {f.units?.length ? (
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {f.units.join(" / ")}
                    </span>
                  ) : null}
                </div>
                <FieldInput meta={f} value={get(f.key)} onChange={(v) => set(f.key, v)} />
                {f.hint && (
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {f.hint}
                  </p>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const VEHICLE_KINDS: { value: VehicleKind; label: string }[] = [
  { value: "tesla_iog", label: "Tesla (Intelligent Octopus Go)" },
  { value: "kia", label: "Kia / UVO" },
  { value: "other", label: "Other" },
];
const CHARGER_KINDS: { value: ChargerKind; label: string }[] = [
  { value: "ohme", label: "Ohme" },
  { value: "tesla", label: "Tesla (Fleet / wall connector)" },
  { value: "other", label: "Other" },
];

function identityFields(item: { id: string; name: string; kind: string }, kinds: { value: string; label: string }[], onChange: (patch: Record<string, unknown>) => void) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <label className="block">
        <div className="mb-1 text-sm font-medium">Name</div>
        <input value={item.name} onChange={(e) => onChange({ name: e.target.value })} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle()} />
      </label>
      <label className="block">
        <div className="mb-1 text-sm font-medium">Kind</div>
        <select value={item.kind} onChange={(e) => onChange({ kind: e.target.value })} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle()}>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <div className="mb-1 text-sm font-medium">Id</div>
        <div className="rounded-xl px-3 py-2 font-mono text-xs" style={{ ...inputStyle(), opacity: 0.8 }}>
          {item.id}
        </div>
      </label>
    </div>
  );
}

type Pending = { title: string; body: ReactNode; danger?: boolean; label?: string; run: () => Promise<void> };

export function VariablesEditor() {
  const { refreshVariables } = useHa();
  const [schema, setSchema] = useState<VariablesSchema | null>(null);
  const [saved, setSaved] = useState<VariablesConfig | null>(null);
  const [draft, setDraft] = useState<VariablesConfig | null>(null);
  const [writable, setWritable] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchVariables()
      .then((r) => {
        setSchema(r.schema);
        setSaved(r.variables);
        setDraft(structuredClone(r.variables));
        setWritable(r.data_writable);
        setWarnings(r.warnings || []);
        setIssues(r.issues || []);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const dirty = useMemo(() => (saved && draft ? JSON.stringify(saved) !== JSON.stringify(draft) : false), [saved, draft]);

  function applyResult(r: { variables: VariablesConfig; warnings?: string[]; issues?: ValidationIssue[]; data_writable?: boolean }) {
    setSaved(r.variables);
    setDraft(structuredClone(r.variables));
    setWarnings(r.warnings || []);
    setIssues(r.issues || []);
    if (r.data_writable != null) setWritable(r.data_writable);
    refreshVariables();
  }

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    setSaveErr(null);
    try {
      await pending.run();
      setPending(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function set(fn: (d: VariablesConfig) => void) {
    setDraft((d) => {
      if (!d) return d;
      const n = structuredClone(d);
      fn(n);
      return n;
    });
  }

  if (err) return <p className="text-gridin">{err}</p>;
  if (!schema || !draft) return <p style={{ color: "var(--muted)" }}>Loading variables…</p>;

  const assigned = new Set(draft.vehicles.map((v) => v.charger_id).filter(Boolean));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          label="Variables"
          title="What Hearth reads from Home Assistant"
          right={
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {writable ? (dirty ? "Unsaved changes" : "Saved") : "Data folder is not writable"}
            </span>
          }
        />
        <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Defaults match today's entity ids, so the first boot is unchanged. Changes apply live — no rebuild and no container restart. Control actions stay limited to predefined roles (boost, charge switch, charger mode, Predbat controls). Hearth never uses an Ohme vehicle-battery sensor as a car's SoC.
        </p>
        <nav className="mb-4 flex flex-wrap gap-2 text-sm">
          {[
            ["variables-home", "Home Energy"],
            ["variables-vehicles", "Vehicles"],
            ["variables-tariff", "Energy Tariff"],
            ["variables-predbat", "Predbat"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full px-3 py-1" style={{ background: "var(--bg-elev)", boxShadow: "0 0 0 1px var(--line)" }}>
              {label}
            </a>
          ))}
        </nav>
        {flash && <p className="mb-3 text-sm text-batt">{flash}</p>}
        {warnings.length > 0 && (
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-solar">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {issues.filter((i) => i.level === "warning").length > 0 && !warnings.length && (
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-solar">
            {issues.filter((i) => i.level === "warning").map((i) => (
              <li key={i.path}>{i.message}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            className="rounded-lg bg-batt px-3 py-1.5 text-sm font-semibold text-ink-950 disabled:opacity-40"
            onClick={() =>
              setPending({
                title: "Save variables?",
                body: "Hearth will rebuild its allow-list from this configuration and start following the new entities immediately. Existing settings, alerts and the Telegram token are not touched.",
                label: "Save variables",
                run: async () => {
                  const r = await saveVariables(draft);
                  applyResult(r);
                  setFlash("Variables saved");
                  setTimeout(() => setFlash(null), 4000);
                },
              })
            }
          >
            Save
          </button>
          <button
            type="button"
            disabled={!dirty || busy}
            className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
            style={{ boxShadow: "0 0 0 1px var(--line)" }}
            onClick={() => setDraft(structuredClone(saved))}
          >
            Discard
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
            style={{ boxShadow: "0 0 0 1px var(--line)" }}
            onClick={async () => {
              const r = await fetch("/api/variables/export");
              const blob = await r.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "hearth-variables.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
            style={{ boxShadow: "0 0 0 1px var(--line)" }}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"
            style={{ boxShadow: "0 0 0 1px var(--line)" }}
            onClick={() =>
              setPending({
                title: "Reset variables to defaults?",
                danger: true,
                label: "Reset to defaults",
                body: "This restores the built-in example entity ids (a Tesla on Intelligent Octopus Go as Car 1, a Kia with an Ohme ePod as Car 2, and example Powerwall / Octopus / Predbat sensors). A backup of the previous file is kept as variables.json.bak.",
                run: async () => {
                  const r = await resetVariables();
                  applyResult(r);
                  setFlash("Reset to defaults");
                  setTimeout(() => setFlash(null), 4000);
                },
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then((text) => {
                let payload: unknown;
                try {
                  payload = JSON.parse(text);
                } catch {
                  setSaveErr("That file is not valid JSON");
                  return;
                }
                setPending({
                  title: "Import variables?",
                  body: "This replaces the Variables configuration only. Settings, alerts and the Telegram token are not imported.",
                  label: "Import",
                  run: async () => {
                    const r = await importVariables(payload);
                    applyResult(r);
                    setFlash("Variables imported");
                    setTimeout(() => setFlash(null), 4000);
                  },
                });
              });
            }}
          />
        </div>
        {saveErr && <p className="mt-3 text-sm text-gridin">{saveErr}</p>}
      </Card>

      <section id="variables-home">
        <Card>
          <CardHeader label="1 · Home Energy" title="Powerwall, solar, home consumption and export" />
          <FieldList
            fields={schema.site}
            get={(k) => draft.site[k]}
            set={(k, v) => set((d) => void (d.site[k] = v as never))}
          />
        </Card>
      </section>

      <section id="variables-vehicles">
        <Card>
          <CardHeader label="2 · Vehicles" title="Cars Hearth depends on, and their chargers" />
          <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Each car has the key entities Hearth uses: SoC, range, charge limit, plugged / charging, last-known sources, and Predbat plan slots. Link a charger (for example an Ohme ePod: status, power, target, mode) to a car, or add a standalone charger and assign it later. The charge limit must be a percentage SoC target such as <span className="font-mono">number.kia_ac_charging_limit</span> — a <span className="font-mono">*_charging_current_limit</span> sensor is usually an amps cap, not a SoC limit. Never use a charger's vehicle-battery sensor as the car's SoC (Ohme's is unreliable).
          </p>
          <div className="space-y-6">
            {draft.vehicles.map((v, i) => (
              <div key={v.id} className="rounded-2xl p-4" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">{v.name}</h3>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-gridin"
                    onClick={() =>
                      setPending({
                        title: `Remove ${v.name}?`,
                        danger: true,
                        label: "Remove vehicle",
                        body: "This only drops the car from Hearth's configuration. It does not change Home Assistant or Predbat.",
                        run: async () => {
                          set((d) => void d.vehicles.splice(i, 1));
                          setPending(null);
                        },
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
                {identityFields(v, VEHICLE_KINDS, (patch) => set((d) => Object.assign(d.vehicles[i], patch)))}
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">Linked charger</div>
                    <select
                      value={v.charger_id || ""}
                      onChange={(e) => set((d) => void (d.vehicles[i].charger_id = e.target.value || null))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                      style={inputStyle()}
                    >
                      <option value="">None</option>
                      {draft.chargers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">Predbat car index</div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={v.predbat_index ?? ""}
                      onChange={(e) => set((d) => void (d.vehicles[i].predbat_index = e.target.value === "" ? null : Number(e.target.value)))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                      style={inputStyle()}
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">Idle before last-known (min)</div>
                    <input
                      type="number"
                      min={0}
                      value={v.idle_min}
                      onChange={(e) => set((d) => void (d.vehicles[i].idle_min = Number(e.target.value)))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                      style={inputStyle()}
                    />
                  </label>
                </div>
                <FieldList
                  fields={schema.vehicle.filter((f) => !["name", "kind", "charger_id", "predbat_index", "idle_min"].includes(f.key))}
                  get={(k) => (v as unknown as Record<string, string | number | null>)[k]}
                  set={(k, val) => set((d) => void ((d.vehicles[i] as unknown as Record<string, unknown>)[k] = val))}
                />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <AddRow
              label="Add vehicle"
              kinds={VEHICLE_KINDS}
              onAdd={(name, kind) =>
                set((d) => d.vehicles.push(blankVehicle(name, kind as VehicleKind, new Set(d.vehicles.map((x) => x.id)))))
              }
            />
          </div>

          <h3 className="mb-3 mt-8 text-base font-semibold">Chargers</h3>
          <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
            A charger can be linked to a car above, or left standalone and assigned later.
          </p>
          <div className="space-y-6">
            {draft.chargers.map((c, i) => (
              <div key={c.id} className="rounded-2xl p-4" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{c.name}</h3>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {assigned.has(c.id) ? `Linked to ${draft.vehicles.filter((v) => v.charger_id === c.id).map((v) => v.name).join(", ")}` : "Standalone — not assigned to a car"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-gridin"
                    onClick={() =>
                      setPending({
                        title: `Remove ${c.name}?`,
                        danger: true,
                        label: "Remove charger",
                        body: "Vehicles currently linked to this charger will be unassigned.",
                        run: async () => {
                          set((d) => {
                            for (const v of d.vehicles) if (v.charger_id === c.id) v.charger_id = null;
                            d.chargers.splice(i, 1);
                          });
                          setPending(null);
                        },
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
                {identityFields(c, CHARGER_KINDS, (patch) => set((d) => Object.assign(d.chargers[i], patch)))}
                <FieldList
                  fields={schema.charger.filter((f) => !["name", "kind"].includes(f.key))}
                  get={(k) => (c as unknown as Record<string, string | number | null>)[k]}
                  set={(k, val) => set((d) => void ((d.chargers[i] as unknown as Record<string, unknown>)[k] = val))}
                />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <AddRow
              label="Add charger"
              kinds={CHARGER_KINDS}
              onAdd={(name, kind) =>
                set((d) => d.chargers.push(blankCharger(name, kind as ChargerKind, new Set(d.chargers.map((x) => x.id)))))
              }
            />
          </div>
        </Card>
      </section>

      <section id="variables-tariff">
        <Card>
          <CardHeader label="3 · Energy Tariff" title="Octopus rates, official statistics and the off-peak window" />
          <FieldList
            fields={schema.tariff}
            get={(k) => draft.tariff[k] as string | number}
            set={(k, v) => set((d) => void ((d.tariff as Record<string, unknown>)[k] = v))}
          />
          <div className="mt-8">
            <FieldList
              fields={schema.official}
              get={(k) => (draft.tariff.official as OfficialStats)[k as keyof OfficialStats]}
              set={(k, v) => set((d) => void ((d.tariff.official as OfficialStats)[k as keyof OfficialStats] = String(v ?? "")))}
            />
          </div>
        </Card>
      </section>

      <section id="variables-predbat">
        <Card>
          <CardHeader label="4 · Predbat" title="Predbat-specific entities" />
          <FieldList
            fields={schema.predbat}
            get={(k) => draft.predbat[k]}
            set={(k, v) => set((d) => void (d.predbat[k] = String(v ?? "")))}
          />
          <div className="mt-8">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Extra subscribe
            </h3>
            <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              Optional extra entity ids to keep on the allow-list and in the live cache, on top of the structured fields above.
            </p>
            <div className="space-y-2">
              {draft.extra_subscribe.map((id, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <EntityPicker
                      value={id}
                      onChange={(v) =>
                        set((d) => {
                          d.extra_subscribe[i] = v;
                        })
                      }
                      optional
                    />
                  </div>
                  <button type="button" className="text-xs text-gridin" onClick={() => set((d) => void d.extra_subscribe.splice(i, 1))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 text-sm"
              onClick={() => set((d) => void d.extra_subscribe.push(""))}
            >
              <Plus className="h-3.5 w-3.5" /> Add entity
            </button>
          </div>
        </Card>
      </section>

      <ConfirmDialog
        open={!!pending}
        title={pending?.title || ""}
        body={pending?.body}
        confirmLabel={pending?.label || "Confirm"}
        danger={pending?.danger}
        busy={busy}
        error={saveErr}
        onCancel={() => {
          if (!busy) {
            setPending(null);
            setSaveErr(null);
          }
        }}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function AddRow({ label, kinds, onAdd }: { label: string; kinds: { value: string; label: string }[]; onAdd: (name: string, kind: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(kinds[0].value);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
          Name
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle()} />
      </label>
      <label className="block">
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
          Kind
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle()}>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg bg-batt px-3 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim(), kind);
          setName("");
        }}
      >
        <Plus className="h-3.5 w-3.5" /> {label}
      </button>
    </div>
  );
}
