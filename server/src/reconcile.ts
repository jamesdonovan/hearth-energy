/** Octopus official kWh vs Powerwall grid import/export, plus optional meter fill for missing official days. */
import type { HaClient, StatisticPoint } from "./ha.js";
import { addDays, londonDate, londonInstant } from "./time.js";
import { getVariables } from "./variables.js";
import { type Period, addDaysStr } from "./period.js";

export const MISMATCH_ABS_KWH = 0.3;
export const MISMATCH_PCT = 10;

export type ReconcileKind = "export" | "import";

export type ReconcileDay = {
  date: string;
  official_kwh: number | null;
  meter_kwh: number | null;
  filled_kwh: number | null;
  powerwall_kwh: number | null;
  /** filled (or official, if not filling) minus Powerwall. */
  diff_kwh: number | null;
  /** Difference as a percentage of the Powerwall figure. */
  diff_pct: number | null;
  official_missing: boolean;
  filled_from_meter: boolean;
  mismatch: boolean;
};

export type ReconcileTotals = {
  official_kwh: number;
  official_days: number;
  powerwall_kwh: number;
  powerwall_days: number;
  filled_kwh: number;
  filled_days: number;
  meter_kwh: number;
  meter_days: number;
  /** Official total vs Powerwall total over the whole range (may cover different day counts). */
  abs_diff_kwh: number | null;
  pct_diff: number | null;
  overlap_official_kwh: number;
  overlap_powerwall_kwh: number;
  overlap_days: number;
  overlap_abs_diff_kwh: number | null;
  overlap_pct_diff: number | null;
  filled_abs_diff_kwh: number | null;
  filled_pct_diff: number | null;
  mismatch_days: number;
  missing_official_days: string[];
};

export type ReconcileMonthRow = {
  month: string;
  official_kwh: number;
  official_days: number;
  powerwall_kwh: number;
  powerwall_days: number;
  filled_kwh: number;
  filled_days: number;
  meter_kwh: number;
  missing_official_days: number;
  mismatch_days: number;
  diff_kwh: number | null;
  diff_pct: number | null;
  mismatch: boolean;
};

export type ReconcileSeries = {
  kind: ReconcileKind;
  official_id: string | null;
  powerwall_id: string | null;
  meter_id: string | null;
  days: ReconcileDay[];
  months: ReconcileMonthRow[];
  totals: ReconcileTotals;
};

export type ReconcileResult = {
  period: Period;
  fill_missing: boolean;
  timezone: "Europe/London";
  mismatch_abs_kwh: number;
  mismatch_pct: number;
  export: ReconcileSeries;
  import: ReconcileSeries;
};

export function listDates(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= endInclusive) {
    out.push(cur);
    cur = addDaysStr(cur, 1);
    if (out.length > 1500) break;
  }
  return out;
}

export function r3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function pick(map: Map<string, number>, date: string): number | null {
  const v = map.get(date);
  return v == null || !Number.isFinite(v) ? null : v;
}

function pctOf(diff: number, base: number): number | null {
  if (base === 0) return diff === 0 ? 0 : null;
  return (diff / base) * 100;
}

export function isMismatch(diffKwh: number | null, diffPct: number | null, absThr = MISMATCH_ABS_KWH, pctThr = MISMATCH_PCT): boolean {
  if (diffKwh == null) return false;
  if (Math.abs(diffKwh) > absThr) return true;
  if (diffPct != null && Math.abs(diffPct) > pctThr) return true;
  return false;
}

/** Official Octopus daily stats: prefer `state` (day's kWh), else `change`. Dated on the consumption day (London). */
export function officialDaily(pts: StatisticPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!pts) return m;
  for (const p of pts) {
    const v = p.state ?? p.change;
    if (v == null || !Number.isFinite(v)) continue;
    m.set(londonDate(p.start), v);
  }
  return m;
}

/** Accumulating energy sensors (Powerwall, meter totals): prefer `change`, else `state`. */
export function changeDaily(pts: StatisticPoint[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!pts) return m;
  for (const p of pts) {
    const v = p.change ?? p.state;
    if (v == null || !Number.isFinite(v)) continue;
    m.set(londonDate(p.start), v);
  }
  return m;
}

export function buildSeries(
  kind: ReconcileKind,
  dates: string[],
  official: Map<string, number>,
  powerwall: Map<string, number>,
  meter: Map<string, number>,
  fillMissing: boolean,
  ids: { official_id: string | null; powerwall_id: string | null; meter_id: string | null },
): ReconcileSeries {
  const days: ReconcileDay[] = dates.map((date) => {
    const official_kwh = pick(official, date);
    const meter_kwh = pick(meter, date);
    const powerwall_kwh = pick(powerwall, date);
    const official_missing = official_kwh == null;
    const filled_from_meter = Boolean(fillMissing && official_missing && meter_kwh != null);
    const filled_kwh = official_kwh != null ? official_kwh : filled_from_meter ? meter_kwh : null;
    let diff_kwh: number | null = null;
    let diff_pct: number | null = null;
    if (filled_kwh != null && powerwall_kwh != null) {
      diff_kwh = r3(filled_kwh - powerwall_kwh);
      const p = pctOf(diff_kwh, powerwall_kwh);
      diff_pct = p == null ? null : r3(p);
    }
    return {
      date,
      official_kwh: official_kwh == null ? null : r3(official_kwh),
      meter_kwh: meter_kwh == null ? null : r3(meter_kwh),
      filled_kwh: filled_kwh == null ? null : r3(filled_kwh),
      powerwall_kwh: powerwall_kwh == null ? null : r3(powerwall_kwh),
      diff_kwh,
      diff_pct,
      official_missing,
      filled_from_meter,
      mismatch: isMismatch(diff_kwh, diff_pct),
    };
  });
  return {
    kind,
    official_id: ids.official_id,
    powerwall_id: ids.powerwall_id,
    meter_id: ids.meter_id,
    days,
    months: groupByMonth(days, fillMissing),
    totals: totalsFromDays(days, fillMissing),
  };
}

export function totalsFromDays(days: ReconcileDay[], fillMissing: boolean): ReconcileTotals {
  let official_kwh = 0, official_days = 0;
  let powerwall_kwh = 0, powerwall_days = 0;
  let filled_kwh = 0, filled_days = 0;
  let meter_kwh = 0, meter_days = 0;
  let overlap_official_kwh = 0, overlap_powerwall_kwh = 0, overlap_days = 0;
  const missing_official_days: string[] = [];
  let mismatch_days = 0;
  for (const d of days) {
    if (d.official_kwh != null) {
      official_kwh += d.official_kwh;
      official_days += 1;
    } else {
      missing_official_days.push(d.date);
    }
    if (d.powerwall_kwh != null) {
      powerwall_kwh += d.powerwall_kwh;
      powerwall_days += 1;
    }
    if (d.meter_kwh != null) {
      meter_kwh += d.meter_kwh;
      meter_days += 1;
    }
    if (d.filled_kwh != null) {
      filled_kwh += d.filled_kwh;
      filled_days += 1;
    }
    if (d.official_kwh != null && d.powerwall_kwh != null) {
      overlap_official_kwh += d.official_kwh;
      overlap_powerwall_kwh += d.powerwall_kwh;
      overlap_days += 1;
    }
    if (d.mismatch) mismatch_days += 1;
  }
  official_kwh = r3(official_kwh);
  powerwall_kwh = r3(powerwall_kwh);
  filled_kwh = r3(filled_kwh);
  meter_kwh = r3(meter_kwh);
  overlap_official_kwh = r3(overlap_official_kwh);
  overlap_powerwall_kwh = r3(overlap_powerwall_kwh);

  const rangeDiff = official_days || powerwall_days ? r3(official_kwh - powerwall_kwh) : null;
  const filledDiff = filled_days || powerwall_days ? r3(filled_kwh - powerwall_kwh) : null;
  const overlapDiff = overlap_days ? r3(overlap_official_kwh - overlap_powerwall_kwh) : null;

  return {
    official_kwh,
    official_days,
    powerwall_kwh,
    powerwall_days,
    filled_kwh,
    filled_days,
    meter_kwh,
    meter_days,
    abs_diff_kwh: rangeDiff,
    pct_diff: rangeDiff == null ? null : (pctOf(rangeDiff, powerwall_kwh) == null ? null : r3(pctOf(rangeDiff, powerwall_kwh) as number)),
    overlap_official_kwh,
    overlap_powerwall_kwh,
    overlap_days,
    overlap_abs_diff_kwh: overlapDiff,
    overlap_pct_diff: overlapDiff == null ? null : (pctOf(overlapDiff, overlap_powerwall_kwh) == null ? null : r3(pctOf(overlapDiff, overlap_powerwall_kwh) as number)),
    filled_abs_diff_kwh: fillMissing ? filledDiff : null,
    filled_pct_diff: fillMissing && filledDiff != null
      ? (pctOf(filledDiff, powerwall_kwh) == null ? null : r3(pctOf(filledDiff, powerwall_kwh) as number))
      : null,
    mismatch_days,
    missing_official_days,
  };
}

export function groupByMonth(days: ReconcileDay[], fillMissing: boolean): ReconcileMonthRow[] {
  const groups = new Map<string, ReconcileDay[]>();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    const list = groups.get(m) ?? [];
    list.push(d);
    groups.set(m, list);
  }
  return [...groups.entries()].map(([month, list]) => {
    const t = totalsFromDays(list, fillMissing);
    const compare = fillMissing ? t.filled_kwh : t.official_kwh;
    const compareDays = fillMissing ? t.filled_days : t.official_days;
    const diff_kwh = compareDays || t.powerwall_days ? r3(compare - t.powerwall_kwh) : null;
    const diff_pct = diff_kwh == null ? null : (pctOf(diff_kwh, t.powerwall_kwh) == null ? null : r3(pctOf(diff_kwh, t.powerwall_kwh) as number));
    return {
      month,
      official_kwh: t.official_kwh,
      official_days: t.official_days,
      powerwall_kwh: t.powerwall_kwh,
      powerwall_days: t.powerwall_days,
      filled_kwh: t.filled_kwh,
      filled_days: t.filled_days,
      meter_kwh: t.meter_kwh,
      missing_official_days: t.missing_official_days.length,
      mismatch_days: t.mismatch_days,
      diff_kwh,
      diff_pct,
      mismatch: t.mismatch_days > 0 || t.missing_official_days.length > 0,
    };
  });
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function reconcileToCsv(result: ReconcileResult): string {
  const headers = [
    "date",
    "official_export_kwh",
    "meter_export_kwh",
    "filled_export_kwh",
    "powerwall_export_kwh",
    "diff_export_kwh",
    "diff_export_pct_of_powerwall",
    "official_export_missing",
    "export_filled_from_meter",
    "export_mismatch",
    "official_import_kwh",
    "meter_import_kwh",
    "filled_import_kwh",
    "powerwall_import_kwh",
    "diff_import_kwh",
    "diff_import_pct_of_powerwall",
    "official_import_missing",
    "import_filled_from_meter",
    "import_mismatch",
  ];
  const exp = new Map(result.export.days.map((d) => [d.date, d]));
  const imp = new Map(result.import.days.map((d) => [d.date, d]));
  const dates = result.export.days.length ? result.export.days.map((d) => d.date) : result.import.days.map((d) => d.date);
  const lines = [headers.join(",")];
  for (const date of dates) {
    const e = exp.get(date);
    const i = imp.get(date);
    lines.push(
      [
        date,
        csvCell(e?.official_kwh),
        csvCell(e?.meter_kwh),
        csvCell(e?.filled_kwh),
        csvCell(e?.powerwall_kwh),
        csvCell(e?.diff_kwh),
        csvCell(e?.diff_pct),
        csvCell(e?.official_missing),
        csvCell(e?.filled_from_meter),
        csvCell(e?.mismatch),
        csvCell(i?.official_kwh),
        csvCell(i?.meter_kwh),
        csvCell(i?.filled_kwh),
        csvCell(i?.powerwall_kwh),
        csvCell(i?.diff_kwh),
        csvCell(i?.diff_pct),
        csvCell(i?.official_missing),
        csvCell(i?.filled_from_meter),
        csvCell(i?.mismatch),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function nonempty(id: string | undefined | null): string | null {
  const s = (id ?? "").trim();
  return s ? s : null;
}

export async function buildReconcile(ha: HaClient, period: Period, fillMissing: boolean): Promise<ReconcileResult> {
  const t = getVariables().tariff;
  const s = getVariables().site;
  const officialExp = nonempty(t.official.export_kwh);
  const officialImp = nonempty(t.official.import_kwh);
  const pwExp = nonempty(s.pw_grid_exported);
  const pwImp = nonempty(s.pw_grid_imported);
  const meterExp = nonempty(t.import_total_export);
  const meterImp = nonempty(t.import_total_consumption);

  const ids = [officialExp, officialImp, pwExp, pwImp, meterExp, meterImp].filter((x): x is string => !!x);
  const startIso = londonInstant(period.start, 0, 0).toISOString();
  const endIso = londonInstant(addDays(period.end, 1), 0, 0).toISOString();
  const stats = ids.length ? await ha.statisticsDuringPeriod(ids, startIso, endIso, "day") : {};

  const dates = listDates(period.start, period.end);
  const exp = buildSeries(
    "export",
    dates,
    officialDaily(officialExp ? stats[officialExp] : undefined),
    changeDaily(pwExp ? stats[pwExp] : undefined),
    changeDaily(meterExp ? stats[meterExp] : undefined),
    fillMissing,
    { official_id: officialExp, powerwall_id: pwExp, meter_id: meterExp },
  );
  const imp = buildSeries(
    "import",
    dates,
    officialDaily(officialImp ? stats[officialImp] : undefined),
    changeDaily(pwImp ? stats[pwImp] : undefined),
    changeDaily(meterImp ? stats[meterImp] : undefined),
    fillMissing,
    { official_id: officialImp, powerwall_id: pwImp, meter_id: meterImp },
  );

  return {
    period,
    fill_missing: fillMissing,
    timezone: "Europe/London",
    mismatch_abs_kwh: MISMATCH_ABS_KWH,
    mismatch_pct: MISMATCH_PCT,
    export: exp,
    import: imp,
  };
}
