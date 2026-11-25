// Run: npm test  (node --test; Node ≥ 22.6 strips the TypeScript types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowModel, FLOW_FIXTURES } from "../src/lib/flowModel.ts";

const edges = (name) => Object.fromEntries(flowModel(FLOW_FIXTURES[name].input).flows.map((f) => [f.id, +f.kw.toFixed(3)]));
const dirs = (name) => flowModel(FLOW_FIXTURES[name].input).flows.map((f) => `${f.from}>${f.to}`).sort();

test("charging from grid: grid feeds home and battery; home feeds the car; nothing flows into the grid", () => {
  assert.deepEqual(edges("grid_charging"), { grid_home: 7.6, grid_battery: 5, home_tesla: 7.2 });
  assert.ok(!dirs("grid_charging").some((d) => d.endsWith(">grid")));
});

test("charging from solar: solar feeds home and battery; the home never feeds the battery", () => {
  assert.deepEqual(edges("solar_charging"), { solar_home: 0.8, solar_battery: 3.4 });
  assert.ok(!dirs("solar_charging").includes("home>battery"));
});

test("discharging to house: battery → home only", () => {
  assert.deepEqual(dirs("discharging"), ["battery>home"]);
});

test("exporting solar: solar → home and solar → grid", () => {
  assert.deepEqual(edges("solar_export"), { solar_home: 0.7, solar_grid: 4.3 });
});

test("battery force export: battery → home and battery → grid", () => {
  assert.deepEqual(edges("battery_export"), { battery_home: 0.5, battery_grid: 4.5 });
});

test("lines under 20 W are idle", () => {
  assert.deepEqual(dirs("idle_noise"), ["battery>home"]);
});

test("sign conventions: + battery is discharge, − grid is export", () => {
  const m = flowModel({ solar: 0, load: 1, battery: 1, grid: 0 });
  assert.equal(m.batteryDischarge, 1);
  const e = flowModel({ solar: 3, load: 1, battery: 0, grid: -2 });
  assert.equal(e.gridExport, 2);
  assert.equal(e.gridImport, 0);
});

test("every fixture balances: sources = sinks", () => {
  for (const [name, f] of Object.entries(FLOW_FIXTURES)) {
    const m = flowModel(f.input);
    const into = (n) => m.flows.filter((x) => x.to === n).reduce((a, x) => a + x.kw, 0);
    const out = (n) => m.flows.filter((x) => x.from === n).reduce((a, x) => a + x.kw, 0);
    if (m.batteryCharge >= 0.02) assert.ok(Math.abs(into("battery") - m.batteryCharge) < 1e-9, name);
    if (m.gridExport >= 0.02) assert.ok(Math.abs(into("grid") - m.gridExport) < 1e-9, name);
    if (m.solar >= 0.02) assert.ok(Math.abs(out("solar") - m.solar) < 1e-9, name);
  }
});
