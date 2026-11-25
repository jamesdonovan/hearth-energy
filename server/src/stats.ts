import { getVariables } from "./variables.js";
import type { HaClient } from "./ha.js";
import { num } from "./ha.js";
import { buildFinancials } from "./financials.js";

type DayPoint = { date: string; value: number | null };

function londonDate(iso: string): string {
  // Europe/London calendar date
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function endOfDayValues(series: { last_changed?: string; last_updated?: string; state: string; time?: string }[]): DayPoint[] {
  const byDay = new Map<string, { t: string; v: number }>();
  for (const p of series) {
    const ts = p.last_changed || p.last_updated || p.time || "";
    if (!ts) continue;
    if (p.state === "unknown" || p.state === "unavailable" || p.state === "") continue;
    const v = Number(p.state);
    if (!Number.isFinite(v)) continue;
    const d = londonDate(ts);
    const prev = byDay.get(d);
    if (!prev || ts >= prev.t) byDay.set(d, { t: ts, v });
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, x]) => ({ date, value: x.v }));
}

function flattenHistory(raw: unknown): Record<string, { last_changed?: string; state: string }[]> {
  const out: Record<string, { last_changed?: string; state: string }[]> = {};
  if (!Array.isArray(raw)) return out;
  for (const series of raw as { entity_id?: string; last_changed?: string; state?: string }[][]) {
    if (!Array.isArray(series) || !series.length) continue;
    const id = series[0]?.entity_id || "unknown";
    // minimal_response omits entity_id after the first point
    out[id] = series.map((p) => ({ last_changed: p.last_changed, state: String(p.state ?? "") }));
  }
  return out;
}

function statEntities() {
  const { predbat: p, site: s, tariff: t } = getVariables();
  return {
    cost_today: p.cost_today,
    cost_yesterday: p.cost_yesterday,
    savings_yesterday_predbat: p.savings_yesterday_predbat,
    import_energy_h0: p.import_energy_h0,
    export_energy_h0: p.export_energy_h0,
    pv_energy_h0: p.pv_energy_h0,
    load_energy_h0: p.load_energy_h0,
    pv_today: p.pv_today,
    pv_tomorrow: p.pv_tomorrow,
    battery_charged: s.pw_batt_charged,
    battery_discharged: s.pw_batt_discharged,
    accumulative_cost: t.import_accumulative_cost,
    accumulative_consumption: t.import_accumulative_consumption,
    previous_accumulative_consumption: t.import_previous_accumulative_consumption,
    previous_accumulative_cost: t.import_previous_accumulative_cost,
    export_previous_accumulative_consumption: t.export_previous_accumulative_consumption,
    export_previous_accumulative_cost: t.export_previous_accumulative_cost,
    cost_today_import: p.cost_today_import,
    cost_today_export: p.cost_today_export,
    savings_yesterday_pvbat: p.savings_yesterday_pvbat,
    battery_cycle_best: p.battery_cycle_best,
    soc_max_calculated: p.soc_max_calculated,
  };
}

export async function buildStats(ha: HaClient) {
  const e = statEntities();
  const end = new Date();
  const start = new Date(end.getTime() - 32 * 24 * 3600 * 1000);
  let hist: Record<string, { last_changed?: string; state: string }[]> = {};
  try {
    const raw = await ha.history(Object.values(e), start.toISOString(), end.toISOString(), true);
    hist = flattenHistory(raw);
  } catch (err) {
    console.error("stats history failed", err);
  }

  const daily = {
    cost_p: endOfDayValues(hist[e.cost_today] || []),
    import_kwh: endOfDayValues(hist[e.import_energy_h0] || []),
    export_kwh: endOfDayValues(hist[e.export_energy_h0] || []),
    solar_kwh: endOfDayValues(hist[e.pv_energy_h0] || []),
    load_kwh: endOfDayValues(hist[e.load_energy_h0] || []),
    pv_forecast_kwh: endOfDayValues(hist[e.pv_today] || []),
    savings_p: endOfDayValues(hist[e.savings_yesterday_predbat] || []),
    battery_charged_kwh: endOfDayValues(hist[e.battery_charged] || []),
  };

  const today = londonDate(new Date().toISOString());
  const yesterday = londonDate(new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  const last = (arr: DayPoint[], date: string) => arr.find((d) => d.date === date)?.value ?? null;
  const sumLast = (arr: DayPoint[], days: number) => {
    const cut = londonDate(new Date(Date.now() - days * 24 * 3600 * 1000).toISOString());
    // include today and previous (days-1)
    const slice = arr.filter((d) => d.date >= cut && d.date <= today && d.value != null);
    if (!slice.length) return null;
    return slice.reduce((a, b) => a + (b.value || 0), 0);
  };

  const live = ha.getAll();
  const todayLive = {
    cost_p: num(live[e.cost_today]),
    cost_import_p: num(live[e.cost_today_import]),
    cost_export_p: num(live[e.cost_today_export]),
    import_kwh: num(live[e.import_energy_h0]),
    export_kwh: num(live[e.export_energy_h0]),
    solar_kwh: num(live[e.pv_energy_h0]),
    load_kwh: num(live[e.load_energy_h0]),
    pv_forecast_kwh: num(live[e.pv_today]),
    pv_forecast_tomorrow_kwh: num(live[e.pv_tomorrow]),
    savings_yesterday_p: num(live[e.savings_yesterday_predbat]),
    savings_yesterday_pvbat_p: num(live[e.savings_yesterday_pvbat]),
    cost_yesterday_p: num(live[e.cost_yesterday]),
    octopus_import_cost_gbp: num(live[e.accumulative_cost]),
    octopus_import_kwh: num(live[e.accumulative_consumption]),
    octopus_import_yesterday_kwh: num(live[e.previous_accumulative_consumption]),
    octopus_import_yesterday_gbp: num(live[e.previous_accumulative_cost]),
    octopus_export_yesterday_kwh: num(live[e.export_previous_accumulative_consumption]),
    octopus_export_yesterday_gbp: num(live[e.export_previous_accumulative_cost]),
    battery_cycle_plan_kwh: num(live[e.battery_cycle_best]),
    soc_max_kwh: num(live[e.soc_max_calculated]),
  };

  const socMax = todayLive.soc_max_kwh || 13.48;
  const cyclesFrom = (kwh: number | null) => (kwh == null ? null : kwh / socMax);

  let fin7: Awaited<ReturnType<typeof buildFinancials>> | null = null;
  let fin30: Awaited<ReturnType<typeof buildFinancials>> | null = null;
  try {
    [fin7, fin30] = await Promise.all([buildFinancials(ha, 7), buildFinancials(ha, 30)]);
  } catch (err) {
    console.error("stats financials rollup failed", err);
  }

  return {
    today: todayLive,
    yesterday: {
      date: yesterday,
      cost_p: todayLive.cost_yesterday_p ?? last(daily.cost_p, yesterday),
      import_kwh: last(daily.import_kwh, yesterday),
      export_kwh: last(daily.export_kwh, yesterday),
      solar_kwh: last(daily.solar_kwh, yesterday),
      load_kwh: last(daily.load_kwh, yesterday),
      pv_forecast_kwh: last(daily.pv_forecast_kwh, yesterday),
      savings_p: todayLive.savings_yesterday_p,
    },
    last7: {
      cost_p: sumLast(daily.cost_p.filter((d) => d.date < today), 7) ?? (fin7?.current.net_cost_gbp != null ? fin7.current.net_cost_gbp * 100 : null),
      // today is in progress; 7d uses completed days where possible plus today live
      import_kwh: fin7?.current.import_kwh ?? add(sumLast(daily.import_kwh.filter((d) => d.date < today), 7), todayLive.import_kwh),
      export_kwh: fin7?.current.export_kwh ?? add(sumLast(daily.export_kwh.filter((d) => d.date < today), 7), todayLive.export_kwh),
      solar_kwh: fin7?.current.solar_kwh ?? add(sumLast(daily.solar_kwh.filter((d) => d.date < today), 7), todayLive.solar_kwh),
      savings_p: fin7?.current.predbat_savings_gbp != null ? fin7.current.predbat_savings_gbp * 100 : sumLast(daily.savings_p, 7),
      battery_cycles: cyclesFrom(sumLast(daily.battery_charged_kwh.filter((d) => d.date < today), 7)),
      import_cost_gbp: fin7?.current.import_cost_gbp ?? null,
      export_earnings_gbp: fin7?.current.export_earnings_gbp ?? null,
      net_cost_gbp: fin7?.current.net_cost_gbp ?? null,
    },
    last30: {
      import_kwh: fin30?.current.import_kwh ?? add(sumLast(daily.import_kwh.filter((d) => d.date < today), 30), todayLive.import_kwh),
      export_kwh: fin30?.current.export_kwh ?? add(sumLast(daily.export_kwh.filter((d) => d.date < today), 30), todayLive.export_kwh),
      solar_kwh: fin30?.current.solar_kwh ?? add(sumLast(daily.solar_kwh.filter((d) => d.date < today), 30), todayLive.solar_kwh),
      savings_p: fin30?.current.predbat_savings_gbp != null ? fin30.current.predbat_savings_gbp * 100 : sumLast(daily.savings_p, 30),
      battery_cycles: cyclesFrom(sumLast(daily.battery_charged_kwh.filter((d) => d.date < today), 30)),
      import_cost_gbp: fin30?.current.import_cost_gbp ?? null,
      export_earnings_gbp: fin30?.current.export_earnings_gbp ?? null,
      net_cost_gbp: fin30?.current.net_cost_gbp ?? null,
    },
    daily,
    pvAccuracy: daily.solar_kwh.map((a) => {
      const f = daily.pv_forecast_kwh.find((x) => x.date === a.date);
      return {
        date: a.date,
        actual: a.value,
        forecast: f?.value ?? null,
      };
    }),
  };
}

function add(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}
