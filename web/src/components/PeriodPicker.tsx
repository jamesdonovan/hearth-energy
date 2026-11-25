import { useEffect, useState, type ReactNode } from "react";
import type { PeriodKey, PeriodSel } from "../lib/api";

export const FINANCIALS_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "4d", label: "4D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "6m", label: "6M" },
  { key: "12m", label: "12M" },
  { key: "custom", label: "Custom" },
];

export const RECONCILE_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "6m", label: "6M" },
  { key: "12m", label: "12M" },
  { key: "custom", label: "Custom" },
];

export const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function shiftDate(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function validPeriod(p: Partial<PeriodSel> | null | undefined, allowed?: PeriodKey[]): PeriodSel | null {
  if (!p || !p.key) return null;
  if (allowed && !allowed.includes(p.key)) return null;
  if (p.key === "custom") return isDate(p.start) && isDate(p.end) && p.start <= p.end ? { key: "custom", start: p.start, end: p.end } : null;
  const keys: PeriodKey[] = ["1d", "4d", "7d", "14d", "30d", "6m", "12m", "this_month", "last_month"];
  if (!keys.includes(p.key)) return null;
  if (allowed && !allowed.includes(p.key)) return null;
  return { key: p.key };
}

export function fmtDay(d: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
}

export function PeriodPicker({
  presets,
  period,
  onChange,
  today,
  leading,
  trailing,
  ariaLabel = "Period",
}: {
  presets: { key: PeriodKey; label: string }[];
  period: PeriodSel;
  onChange: (p: PeriodSel) => void;
  today: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  ariaLabel?: string;
}) {
  const [showCustom, setShowCustom] = useState(period.key === "custom");
  const [draft, setDraft] = useState<{ start: string; end: string }>(() => ({
    start: period.key === "custom" && period.start ? period.start : shiftDate(today, -29),
    end: period.key === "custom" && period.end ? period.end : today,
  }));
  useEffect(() => {
    if (period.key === "custom" && period.start && period.end) {
      setShowCustom(true);
      setDraft({ start: period.start, end: period.end });
    }
  }, [period.key, period.start, period.end]);

  const draftOk = isDate(draft.start) && isDate(draft.end) && draft.start <= draft.end && draft.end <= today;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {leading}
        <div className="flex flex-wrap items-center gap-3">
          {trailing}
          <div className="flex max-w-full flex-wrap rounded-full p-1" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }} role="group" aria-label={ariaLabel}>
            {presets.map((w) => {
              const on = w.key === "custom" ? showCustom || period.key === "custom" : !showCustom && period.key === w.key;
              return (
                <button
                  key={w.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (w.key === "custom") setShowCustom(true);
                    else {
                      setShowCustom(false);
                      onChange({ key: w.key });
                    }
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${on ? "bg-white/10" : ""}`}
                  style={{ color: on ? "var(--text)" : "var(--muted)" }}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {showCustom && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl p-4"
          style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (draftOk) onChange({ key: "custom", start: draft.start, end: draft.end });
          }}
        >
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            From
            <input
              type="date"
              aria-label="Start date"
              value={draft.start}
              max={draft.end || today}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm"
              style={{ color: "var(--text)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            To
            <input
              type="date"
              aria-label="End date"
              value={draft.end}
              min={draft.start}
              max={today}
              onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm"
              style={{ color: "var(--text)" }}
            />
          </label>
          <button type="submit" disabled={!draftOk} className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium disabled:opacity-40">
            Show range
          </button>
          {!draftOk && <span className="text-xs text-gridin">Pick a start on or before the end, ending today or earlier.</span>}
          {period.key === "custom" && period.start && period.end && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Showing {fmtDay(period.start)} – {fmtDay(period.end)}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
