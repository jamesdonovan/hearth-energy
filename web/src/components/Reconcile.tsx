import { useEffect, useState } from "react";
import { fetchReconcile, reconcileCsvUrl, type PeriodSel, type ReconcileData, type ReconcileDay, type ReconcileSeries } from "../lib/api";
import { fmtKwh } from "../lib/format";
import { Card, CardHeader, Metric } from "./Card";
import { PeriodPicker, RECONCILE_PRESETS, fmtDay, londonToday, validPeriod } from "./PeriodPicker";

const LS_PERIOD = "hearth.reconcile.period";
const LS_FILL = "hearth.reconcile.fill";
const LS_GRAIN = "hearth.reconcile.grain";
const allowed = RECONCILE_PRESETS.map((p) => p.key);

function initialPeriod(): PeriodSel {
  const q = new URLSearchParams(window.location.search);
  const fromUrl = validPeriod({ key: q.get("period") as PeriodSel["key"], start: q.get("start") ?? undefined, end: q.get("end") ?? undefined }, allowed);
  if (fromUrl) return fromUrl;
  try {
    const saved = validPeriod(JSON.parse(localStorage.getItem(LS_PERIOD) || "null"), allowed);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return { key: "last_month" };
}

function initialFill(): boolean {
  const q = new URLSearchParams(window.location.search).get("fill");
  if (q === "0" || q === "false") return false;
  if (q === "1" || q === "true") return true;
  try {
    const saved = localStorage.getItem(LS_FILL);
    if (saved === "0") return false;
    if (saved === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function remember(p: PeriodSel, fill: boolean) {
  try {
    localStorage.setItem(LS_PERIOD, JSON.stringify(p));
    localStorage.setItem(LS_FILL, fill ? "1" : "0");
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams(window.location.search);
  q.set("tab", "reconciliation");
  q.set("period", p.key);
  if (p.key === "custom" && p.start && p.end) {
    q.set("start", p.start);
    q.set("end", p.end);
  } else {
    q.delete("start");
    q.delete("end");
  }
  if (fill) q.delete("fill");
  else q.set("fill", "0");
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtDiff(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(3)} kWh`;
}

function fmtMonth(m: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));
}

export function ReconcilePanel() {
  const [period, setPeriodState] = useState<PeriodSel>(initialPeriod);
  const [fill, setFillState] = useState<boolean>(initialFill);
  const today = londonToday();
  const setPeriod = (p: PeriodSel) => {
    setPeriodState(p);
    remember(p, fill);
  };
  const setFill = (v: boolean) => {
    setFillState(v);
    remember(period, v);
  };
  const periodKey = `${period.key}:${period.start ?? ""}:${period.end ?? ""}:${fill ? 1 : 0}`;
  const [data, setData] = useState<ReconcileData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [grain, setGrain] = useState<"day" | "month" | "auto">(() => {
    try {
      const v = localStorage.getItem(LS_GRAIN);
      if (v === "month" || v === "day" || v === "auto") return v;
    } catch {
      /* ignore */
    }
    return "auto";
  });

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchReconcile(period, fill)
      .then((d) => {
        if (!live) return;
        setData(d);
        setErr(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  useEffect(() => {
    remember(period, fill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthRows = useMonthRows(grain, data?.period.days ?? 0);

  return (
    <div className="space-y-6">
      <PeriodPicker
        presets={RECONCILE_PRESETS}
        period={period}
        onChange={setPeriod}
        today={today}
        ariaLabel="Reconciliation period"
        leading={
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Compare official Octopus daily kWh (dated on the consumption day) with Powerwall grid import and export.
            Days where official statistics are missing — for example the clock-change day — can be filled from the
            import meter’s lifetime total.
          </p>
        }
        trailing={
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={fill}
              onChange={(e) => setFill(e.target.checked)}
              className="rounded"
            />
            Fill missing official days from the meter
          </label>
        }
      />

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: "var(--muted)" }}>
          <span>
            {data.period.key === "custom" ? "Custom range" : data.period.label}: {fmtDay(data.period.start)} – {fmtDay(data.period.end)}
            {data.period.includes_today ? " (today so far)" : ""} · {data.period.days} day{data.period.days === 1 ? "" : "s"}
            {" · "}highlight if |diff| &gt; {data.mismatch_abs_kwh} kWh or &gt; {data.mismatch_pct}%
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {loading && <span>Updating…</span>}
            {data.period.days > 31 && (
              <div className="flex rounded-full p-0.5" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }} role="group" aria-label="Table grouping">
                {([
                  ["day", "By day"],
                  ["month", "By month"],
                ] as const).map(([k, label]) => {
                  const on = (k === "month" ? monthRows : !monthRows);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setGrain(k);
                        try {
                          localStorage.setItem(LS_GRAIN, k);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "bg-white/10" : ""}`}
                      style={{ color: on ? "var(--text)" : "var(--muted)" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <a
              href={reconcileCsvUrl(period, fill)}
              className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium"
              style={{ color: "var(--text)" }}
              download
            >
              Export CSV
            </a>
          </div>
        </div>
      )}

      {err && <div className="text-sm text-gridin">{err}</div>}
      {loading && !data && <div className="text-sm" style={{ color: "var(--muted)" }}>Loading official and Powerwall statistics from Home Assistant…</div>}

      {data && (
        <>
          <SeriesBlock title="Export" hint="Official export vs Powerwall grid exported" series={data.export} fill={data.fill_missing} grain={monthRows ? "month" : "day"} />
          <SeriesBlock title="Import" hint="Official import vs Powerwall grid imported" series={data.import} fill={data.fill_missing} grain={monthRows ? "month" : "day"} />
        </>
      )}
    </div>
  );
}

function useMonthRows(grain: "day" | "month" | "auto", days: number) {
  if (grain === "month") return true;
  if (grain === "day") return false;
  return days > 62;
}

function SeriesBlock({
  title,
  hint,
  series,
  fill,
  grain,
}: {
  title: string;
  hint: string;
  series: ReconcileSeries;
  fill: boolean;
  grain: "day" | "month";
}) {
  const t = series.totals;
  const unconfigured = !series.official_id && !series.powerwall_id;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader label="Octopus reconciliation" title={title} right={<span className="text-xs" style={{ color: "var(--muted)" }}>{hint}</span>} />
        {unconfigured ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Map the official Octopus {title.toLowerCase()} statistic and the Powerwall grid {title.toLowerCase()}ed sensor in Settings → Variables to compare this series.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Official Octopus"
              value={fmtKwh(t.official_kwh, 3)}
              hint={`${t.official_days} day${t.official_days === 1 ? "" : "s"} with official statistics`}
              tone={title === "Export" ? "gridout" : "gridin"}
            />
            <Metric
              label="Powerwall"
              value={fmtKwh(t.powerwall_kwh, 3)}
              hint={`${t.powerwall_days} day${t.powerwall_days === 1 ? "" : "s"}`}
              tone="batt"
            />
            <Metric
              label="Difference"
              value={fmtDiff(t.abs_diff_kwh)}
              hint={`${fmtPct(t.pct_diff)} of Powerwall (official total vs Powerwall total)`}
            />
            <Metric
              label={fill ? "With meter fill" : "Missing official"}
              value={fill ? fmtKwh(t.filled_kwh, 3) : String(t.missing_official_days.length)}
              hint={
                fill
                  ? `${fmtDiff(t.filled_abs_diff_kwh)} · ${fmtPct(t.filled_pct_diff)} vs Powerwall`
                  : t.missing_official_days.length
                    ? t.missing_official_days.length <= 3
                      ? t.missing_official_days.map((d) => fmtDay(d)).join(", ")
                      : `${t.missing_official_days.length} days, including ${fmtDay(t.missing_official_days[0])}`
                    : "All official days present"
              }
            />
          </div>
        )}
        {!unconfigured && t.missing_official_days.length > 0 && (
          <div className="mt-4 rounded-xl px-4 py-2 text-sm" style={{ background: "rgba(245, 180, 60, 0.12)", color: "#f5b43c" }}>
            Official statistics missing on {t.missing_official_days.length} day{t.missing_official_days.length === 1 ? "" : "s"}
            {t.missing_official_days.length <= 5 ? `: ${t.missing_official_days.map((d) => fmtDay(d)).join(", ")}` : ""}.
            {fill ? " Figures in the filled column use the import-meter daily change for those days." : " Turn on meter fill to estimate those days from the meter total."}
          </div>
        )}
        {!unconfigured && t.overlap_days > 0 && t.official_days !== t.powerwall_days && (
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            On the {t.overlap_days} day{t.overlap_days === 1 ? "" : "s"} both sources cover: official {fmtKwh(t.overlap_official_kwh, 3)} vs Powerwall {fmtKwh(t.overlap_powerwall_kwh, 3)} ({fmtDiff(t.overlap_abs_diff_kwh)}, {fmtPct(t.overlap_pct_diff)}).
          </p>
        )}
      </Card>

      {!unconfigured && grain === "month" && (
        <Card pad={false}>
          <div className="p-5 pb-2">
            <CardHeader label="By month" title={`${title} totals`} />
          </div>
          <MonthTable series={series} fill={fill} />
        </Card>
      )}
      {!unconfigured && grain === "day" && (
        <Card pad={false}>
          <div className="p-5 pb-2">
            <CardHeader label="By day" title={`${title} comparison`} />
          </div>
          <DayTable days={series.days} fill={fill} />
        </Card>
      )}
    </div>
  );
}

function DayTable({ days, fill }: { days: ReconcileDay[]; fill: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
            <th className="px-5 py-2 font-medium">Date</th>
            <th className="px-3 py-2 text-right font-medium">Official</th>
            {fill && <th className="px-3 py-2 text-right font-medium">Filled</th>}
            <th className="px-3 py-2 text-right font-medium">Powerwall</th>
            <th className="px-3 py-2 text-right font-medium">Diff</th>
            <th className="px-3 py-2 text-right font-medium">%</th>
            <th className="px-5 py-2 font-medium">Flag</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const highlight = d.mismatch || d.official_missing;
            const bg = d.official_missing ? "rgba(245, 180, 60, 0.12)" : d.mismatch ? "rgba(240, 113, 103, 0.14)" : undefined;
            return (
              <tr key={d.date} style={{ background: bg, boxShadow: highlight ? "inset 0 -1px 0 var(--line)" : "inset 0 -1px 0 var(--line)" }}>
                <td className="whitespace-nowrap px-5 py-2">{fmtDay(d.date)}</td>
                <td className="num px-3 py-2 text-right">{d.official_kwh == null ? "—" : d.official_kwh.toFixed(3)}</td>
                {fill && (
                  <td className="num px-3 py-2 text-right">
                    {d.filled_kwh == null ? "—" : d.filled_kwh.toFixed(3)}
                    {d.filled_from_meter ? <span className="ml-1 text-[10px] uppercase" style={{ color: "#f5b43c" }}>meter</span> : null}
                  </td>
                )}
                <td className="num px-3 py-2 text-right">{d.powerwall_kwh == null ? "—" : d.powerwall_kwh.toFixed(3)}</td>
                <td className="num px-3 py-2 text-right">{fmtDiff(d.diff_kwh)}</td>
                <td className="num px-3 py-2 text-right">{fmtPct(d.diff_pct)}</td>
                <td className="px-5 py-2 text-xs">
                  {d.official_missing ? "Missing official" : d.mismatch ? "Mismatch" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthTable({ series, fill }: { series: ReconcileSeries; fill: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
            <th className="px-5 py-2 font-medium">Month</th>
            <th className="px-3 py-2 text-right font-medium">Official</th>
            {fill && <th className="px-3 py-2 text-right font-medium">Filled</th>}
            <th className="px-3 py-2 text-right font-medium">Powerwall</th>
            <th className="px-3 py-2 text-right font-medium">Diff</th>
            <th className="px-3 py-2 text-right font-medium">%</th>
            <th className="px-5 py-2 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {series.months.map((m) => {
            const bg = m.mismatch ? "rgba(240, 113, 103, 0.10)" : undefined;
            const flags = [
              m.missing_official_days ? `${m.missing_official_days} missing official` : "",
              m.mismatch_days ? `${m.mismatch_days} mismatch` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={m.month} style={{ background: bg, boxShadow: "inset 0 -1px 0 var(--line)" }}>
                <td className="whitespace-nowrap px-5 py-2">{fmtMonth(m.month)}</td>
                <td className="num px-3 py-2 text-right">
                  {m.official_kwh.toFixed(3)}
                  <span className="ml-1 text-[10px]" style={{ color: "var(--muted)" }}>({m.official_days}d)</span>
                </td>
                {fill && <td className="num px-3 py-2 text-right">{m.filled_kwh.toFixed(3)}</td>}
                <td className="num px-3 py-2 text-right">
                  {m.powerwall_kwh.toFixed(3)}
                  <span className="ml-1 text-[10px]" style={{ color: "var(--muted)" }}>({m.powerwall_days}d)</span>
                </td>
                <td className="num px-3 py-2 text-right">{fmtDiff(m.diff_kwh)}</td>
                <td className="num px-3 py-2 text-right">{fmtPct(m.diff_pct)}</td>
                <td className="px-5 py-2 text-xs">{flags}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
