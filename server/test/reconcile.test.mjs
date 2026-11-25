import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parsePeriod } from "../src/period.ts";
import {
  buildSeries,
  officialDaily,
  r3,
  reconcileToCsv,
  totalsFromDays,
} from "../src/reconcile.ts";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/october-2026-export-reconcile.json"), "utf8"),
);

function mapsFromFixture(rows) {
  const official = new Map();
  const powerwall = new Map();
  const meter = new Map();
  const dates = [];
  for (const r of rows) {
    dates.push(r.date);
    if (r.official != null) official.set(r.date, r.official);
    if (r.powerwall != null) powerwall.set(r.date, r.powerwall);
    if (r.meter != null) meter.set(r.date, r.meter);
  }
  return { dates, official, powerwall, meter };
}

describe("parsePeriod calendar presets", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  it("resolves last month to October 2026 from 25 Nov 2026", () => {
    const p = parsePeriod({ period: "last_month" }, now, "last_month");
    assert.equal(p.key, "last_month");
    assert.equal(p.start, "2026-10-01");
    assert.equal(p.end, "2026-10-31");
    assert.equal(p.days, 31);
    assert.equal(p.includes_today, false);
  });
  it("resolves this month as 1 Nov–25 Nov 2026", () => {
    const p = parsePeriod({ period: "this_month" }, now);
    assert.equal(p.start, "2026-11-01");
    assert.equal(p.end, "2026-11-25");
    assert.equal(p.days, 25);
    assert.equal(p.includes_today, true);
  });
  it("resolves 7d as the last seven London days including today", () => {
    const p = parsePeriod({ period: "7d" }, now);
    assert.equal(p.start, "2026-11-19");
    assert.equal(p.end, "2026-11-25");
    assert.equal(p.days, 7);
  });
  it("keeps existing Financials 14d default", () => {
    const p = parsePeriod({}, now);
    assert.equal(p.key, "14d");
    assert.equal(p.start, "2026-11-12");
    assert.equal(p.end, "2026-11-25");
  });
  it("accepts a custom October 2026 range", () => {
    const p = parsePeriod({ period: "custom", start: "2026-10-01", end: "2026-10-31" }, now);
    assert.equal(p.start, "2026-10-01");
    assert.equal(p.end, "2026-10-31");
    assert.equal(p.days, 31);
  });
});

describe("October 2026 export reconciliation", () => {
  const { dates, official, powerwall, meter } = mapsFromFixture(fixture);

  it("matches official 613.897 kWh over 30 days, Powerwall 616.103 over 31, 25 Oct missing, meter 7.708", () => {
    const series = buildSeries("export", dates, official, powerwall, meter, true, {
      official_id: "official.export_kwh",
      powerwall_id: "pw_grid_exported",
      meter_id: "import_total_export",
    });
    const t = series.totals;
    assert.equal(t.official_kwh, 613.897);
    assert.equal(t.official_days, 30);
    assert.equal(t.powerwall_kwh, 616.103);
    assert.equal(t.powerwall_days, 31);
    assert.deepEqual(t.missing_official_days, ["2026-10-25"]);
    const oct25 = series.days.find((d) => d.date === "2026-10-25");
    assert.ok(oct25);
    assert.equal(oct25.official_missing, true);
    assert.equal(oct25.official_kwh, null);
    assert.equal(oct25.meter_kwh, 7.708);
    assert.equal(oct25.filled_from_meter, true);
    assert.equal(oct25.filled_kwh, 7.708);
    assert.equal(oct25.powerwall_kwh, 7.718);
    assert.equal(oct25.mismatch, false);
    assert.equal(t.filled_kwh, 621.605);
    assert.equal(t.abs_diff_kwh, r3(613.897 - 616.103));
    assert.equal(t.filled_abs_diff_kwh, r3(621.605 - 616.103));
  });

  it("highlights days with abs diff > 0.3 kWh or > 10%", () => {
    const series = buildSeries("export", dates, official, powerwall, meter, true, {
      official_id: "o",
      powerwall_id: "p",
      meter_id: "m",
    });
    const flagged = series.days.filter((d) => d.mismatch).map((d) => d.date);
    const expected = fixture.filter((r) => r.flag).map((r) => r.date);
    assert.deepEqual(flagged, expected);
    assert.equal(flagged.length, 8);
    assert.ok(!flagged.includes("2026-10-25"));
  });

  it("leaves 25 Oct unfilled when fill is off, and still reports it missing", () => {
    const series = buildSeries("export", dates, official, powerwall, meter, false, {
      official_id: "o",
      powerwall_id: "p",
      meter_id: "m",
    });
    const oct25 = series.days.find((d) => d.date === "2026-10-25");
    assert.equal(oct25.filled_from_meter, false);
    assert.equal(oct25.filled_kwh, null);
    assert.equal(oct25.official_missing, true);
    assert.equal(oct25.mismatch, false);
    assert.equal(series.totals.official_kwh, 613.897);
    assert.equal(series.totals.filled_kwh, 613.897);
    assert.equal(series.totals.filled_abs_diff_kwh, null);
  });

  it("dates official statistics on the consumption day, including the DST-end boundary", () => {
    // 1 Oct 2026 00:00 BST = 2026-09-30T23:00:00Z
    // 25 Oct 2026 00:00 BST = 2026-10-24T23:00:00Z (DST still in effect at midnight)
    const pts = [
      { start: Date.parse("2026-09-30T23:00:00Z"), state: 18.593 },
      { start: Date.parse("2026-10-24T23:00:00Z"), state: 7.708 },
    ];
    const map = officialDaily(pts);
    assert.equal(map.get("2026-10-01"), 18.593);
    assert.equal(map.get("2026-10-25"), 7.708);
  });

  it("exports a CSV that includes the missing official day and monthly totals inputs", () => {
    const series = buildSeries("export", dates, official, powerwall, meter, true, {
      official_id: "o",
      powerwall_id: "p",
      meter_id: "m",
    });
    const empty = buildSeries("import", dates, new Map(), new Map(), new Map(), true, {
      official_id: null,
      powerwall_id: null,
      meter_id: null,
    });
    const csv = reconcileToCsv({
      period: parsePeriod({ period: "custom", start: "2026-10-01", end: "2026-10-31" }, new Date("2026-11-25T12:00:00Z")),
      fill_missing: true,
      timezone: "Europe/London",
      mismatch_abs_kwh: 0.3,
      mismatch_pct: 10,
      export: series,
      import: empty,
    });
    assert.match(csv, /^date,official_export_kwh,/);
    assert.match(csv, /2026-10-25,,7.708,7.708,7.718,/);
    assert.match(csv, /2026-10-03,/);
  });

  it("groups October as a single month row with the same totals", () => {
    const series = buildSeries("export", dates, official, powerwall, meter, true, {
      official_id: "o",
      powerwall_id: "p",
      meter_id: "m",
    });
    assert.equal(series.months.length, 1);
    assert.equal(series.months[0].month, "2026-10");
    assert.equal(series.months[0].official_kwh, 613.897);
    assert.equal(series.months[0].powerwall_kwh, 616.103);
    assert.equal(series.months[0].missing_official_days, 1);
    assert.equal(series.months[0].mismatch_days, 8);
    assert.equal(series.months[0].mismatch, true);
  });
});

describe("totalsFromDays rounding", () => {
  it("rounds kWh totals to 3 decimal places", () => {
    const days = [
      {
        date: "2026-10-01",
        official_kwh: 1.111,
        meter_kwh: null,
        filled_kwh: 1.111,
        powerwall_kwh: 1.11,
        diff_kwh: 0.001,
        diff_pct: 0.09,
        official_missing: false,
        filled_from_meter: false,
        mismatch: false,
      },
      {
        date: "2026-10-02",
        official_kwh: 2.222,
        meter_kwh: null,
        filled_kwh: 2.222,
        powerwall_kwh: 2.22,
        diff_kwh: 0.002,
        diff_pct: 0.09,
        official_missing: false,
        filled_from_meter: false,
        mismatch: false,
      },
    ];
    const t = totalsFromDays(days, true);
    assert.equal(t.official_kwh, 3.333);
    assert.equal(t.powerwall_kwh, 3.33);
  });
});
