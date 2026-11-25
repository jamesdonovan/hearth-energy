import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRuns, DEFAULTS, classify } from "../src/powerprint-core.ts";
const o = { ...DEFAULTS, londonMinute: (t) => Math.floor((t / 60000) % 1440), rateFallback: () => 0.373 };
const mk = (fn, n = 288) => Array.from({ length: n }, (_, i) => { const kw = fn(i); return { t: i * 300000, kw, max: kw, car: 0, rate: null }; });
test("one 2 h 3 kW step on a 0.4 kW baseline is one run of ~6 kWh", () => {
  const r = detectRuns(mk((i) => 0.4 + (i >= 100 && i < 124 ? 3 : 0)), o);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].features.kwh - 6) < 0.2, String(r[0].features.kwh));
  assert.equal(r[0].features.duration_min, 120);
});
test("two heating bursts 20 min apart merge into one run with 2 spikes", () => {
  const r = detectRuns(mk((i) => 0.3 + ((i >= 100 && i < 104) || (i >= 108 && i < 112) ? 2 : 0)), o);
  assert.equal(r.length, 1);
  assert.equal(r[0].features.spikes, 2);
});
test("short blips are ignored", () => {
  assert.equal(detectRuns(mk((i) => 0.3 + (i === 50 ? 3 : 0)), o).length, 0);
});
test("classifier picks the nearer centroid", () => {
  const f = (p, d) => ({ duration_min: d, kwh: (p * d) / 60, peak_kw: p, plateau_kw: p, spikes: 1, duty: 1, start_min: 1430, baseline_kw: 0.3, car_overlap: 0 });
  const prof = new Array(16).fill(1);
  const s = classify(f(3.1, 120), prof, [{ key: "hot-tub", features: f(3.2, 115), profile: prof }, { key: "heater", features: f(1.4, 200), profile: prof }]);
  assert.equal(s.key, "hot-tub");
  assert.ok(s.confidence > 0.5);
});
test("a 30-min quiet gap splits back-to-back appliances into two runs", () => {
  const r = detectRuns(mk((i) => 0.3 + (i >= 100 && i < 112 ? 2.5 : 0) + (i >= 125 && i < 140 ? 1.8 : 0)), o);
  assert.equal(r.length, 2);
});
test("a second appliance on top of a steady one becomes its own 'top' run", () => {
  // 3 kW for 2 h, plus 2.4 kW for 25 min in the middle
  const r = detectRuns(mk((i) => 0.3 + (i >= 100 && i < 124 ? 3 : 0) + (i >= 108 && i < 113 ? 2.4 : 0)), o);
  const top = r.find((x) => x.layer === "top");
  const base = r.find((x) => x.layer === "base");
  assert.ok(top && base, JSON.stringify(r.map((x) => x.layer)));
  assert.ok(Math.abs(base.features.kwh - 6) < 0.3, String(base.features.kwh));
  assert.ok(Math.abs(top.features.kwh - 1) < 0.3, String(top.features.kwh));
});
import { attributeSources, batteryCostSeries } from "../src/powerprint-core.ts";
test("sources split in proportion to supply; battery priced at what it cost to fill", () => {
  const fb = () => 0.373;
  // 12 slots charging 4 kW from the grid at 5.6p, then 12 slots: 1 kW solar + 2 kW battery + 1 kW grid at 37.3p
  const sm = [];
  for (let i = 0; i < 12; i++) sm.push({ t: i * 300000, kw: 0.5, max: 0.5, car: 0, rate: 0.056, solar: 0, batt: -4, grid: 4.5, load: 0.5 });
  for (let i = 12; i < 24; i++) sm.push({ t: i * 300000, kw: 4, max: 4, car: 0, rate: 0.373, solar: 1, batt: 2, grid: 1, load: 4, exportRate: 0.15 });
  const bc = batteryCostSeries(sm, fb, 0.056);
  const src = attributeSources(sm, 12, new Array(12).fill(2), bc, fb); // appliance 2 kW for 1 h = 2 kWh
  assert.equal(src.solar_kwh, 0.5);
  assert.equal(src.battery_kwh, 1);
  assert.equal(src.grid_kwh, 0.5);
  assert.ok(Math.abs(src.battery_rate_p - 5.6) < 0.2, String(src.battery_rate_p));
  // 0.5 kWh × 37.3p + 1 kWh × 5.6p ≈ £0.243; at the import rate it would be 2 × 37.3p = £0.746
  assert.ok(Math.abs(src.cost_actual_gbp - 0.243) < 0.01, String(src.cost_actual_gbp));
  assert.ok(Math.abs(src.solar_forgone_gbp - 0.075) < 0.005);
});
