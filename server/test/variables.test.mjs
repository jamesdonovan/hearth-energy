import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hearth-vars-"));
process.env.DATA_DIR = dir;

const {
  defaultVariables,
  mergeVariables,
  collectEntityIds,
  deriveActions,
  validateVariables,
  getVariables,
  saveVariables,
  resetVariables,
  _resetCache,
  chargerSocIds,
} = await import("../src/variables.ts");

before(() => {
  _resetCache();
});

after(() => {
  _resetCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("defaults include example vehicles and a percentage SoC charge limit for car 2", () => {
  const v = defaultVariables();
  assert.equal(v.vehicles.length, 2);
  const tesla = v.vehicles.find((c) => c.id === "car_1");
  const ev9 = v.vehicles.find((c) => c.id === "car_2");
  assert.equal(tesla.name, "Car 1");
  assert.equal(tesla.kind, "tesla_iog");
  assert.equal(tesla.charger_id, "tesla_charger");
  assert.equal(ev9.name, "Car 2");
  assert.equal(ev9.kind, "kia");
  assert.equal(ev9.charger_id, "ohme_epod");
  assert.equal(ev9.charge_limit, "number.kia_ac_charging_limit");
  assert.ok(v.chargers.some((c) => c.id === "ohme_epod" && c.kind === "ohme"));
  assert.equal(v.tariff.off_peak_start, "23:30");
  assert.equal(v.tariff.off_peak_end, "05:30");
  assert.ok(!String(JSON.stringify(v)).includes("red_arrow"));
  assert.ok(!String(JSON.stringify(v)).includes("19l4039450"));
});

test("first boot with no file matches defaults (behaviour unchanged)", () => {
  _resetCache();
  const got = getVariables();
  const def = defaultVariables();
  assert.equal(got.site.pw_soc, def.site.pw_soc);
  assert.equal(got.vehicles[0].soc, def.vehicles[0].soc);
  assert.equal(got.vehicles[1].charge_limit, def.vehicles[1].charge_limit);
  assert.equal(got.predbat.mode, def.predbat.mode);
});

test("merge is migration-safe: unknown keys dropped, missing fields filled from defaults", () => {
  const merged = mergeVariables({
    site: { pw_soc: "sensor.custom_soc", not_a_field: "x" },
    vehicles: [{ id: "car_1", name: "Car 1", soc: "sensor.custom_tesla" }],
  });
  assert.equal(merged.site.pw_soc, "sensor.custom_soc");
  assert.equal(merged.site.pw_load_power, defaultVariables().site.pw_load_power);
  assert.equal("not_a_field" in merged.site, false);
  const tesla = merged.vehicles.find((c) => c.id === "car_1");
  assert.equal(tesla.soc, "sensor.custom_tesla");
  assert.equal(tesla.charge_limit, defaultVariables().vehicles[0].charge_limit);
  // A provided vehicles array is authoritative (add/remove). Omitted vehicles keeps the defaults.
  assert.equal(merged.vehicles.length, 1);
  assert.equal(mergeVariables({ site: { pw_soc: "sensor.x" } }).vehicles.length, 2);
});

test("collectEntityIds includes Powerwall energy and Octopus export previous-day rates", () => {
  const ids = new Set(collectEntityIds(defaultVariables()));
  for (const id of [
    "sensor.powerwall_solar_exported",
    "sensor.powerwall_battery_imported_from_grid",
    "sensor.powerwall_battery_imported_from_solar",
    "event.octopus_energy_electricity_mpan_export_serial_export_previous_day_rates",
  ]) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});

test("Ohme vehicle battery is refused as a car SoC", () => {
  const v = mergeVariables({
    vehicles: defaultVariables().vehicles.map((c) =>
      c.id === "car_2" ? { ...c, soc: "sensor.ohme_epod_vehicle_battery" } : c,
    ),
  });
  const r = validateVariables(v);
  assert.ok(r.errors.some((e) => /ohme|vehicle.battery|SoC/i.test(e)), r.errors.join("; "));
  assert.ok(chargerSocIds(v).has("sensor.ohme_epod_vehicle_battery"));
});

test("amps current-limit used as charge limit is a warning, not a hard error", () => {
  const v = mergeVariables({
    vehicles: defaultVariables().vehicles.map((c) =>
      c.id === "car_2" ? { ...c, charge_limit: "sensor.kia_ev_charging_current_limit" } : c,
    ),
  });
  const r = validateVariables(v);
  assert.equal(r.errors.length, 0, r.errors.join("; "));
  assert.ok(r.warnings.some((w) => /amp/i.test(w) || /current_limit/i.test(w)), r.warnings.join("; "));
});

test("deriveActions is limited to predefined control roles", () => {
  const actions = deriveActions(defaultVariables());
  const keys = actions.map((a) => `${a.domain}.${a.service}:${a.entityId}`);
  assert.ok(keys.some((k) => k.includes("input_boolean.car_2_boost")));
  assert.ok(keys.some((k) => k.includes("switch.tesla_charge")));
  assert.ok(keys.some((k) => k.includes("select.ohme_epod_charge_mode")));
  assert.ok(keys.some((k) => k.includes("select.predbat_mode")));
  assert.ok(keys.some((k) => k.includes("switch.predbat_set_read_only")));
  // no arbitrary entity, e.g. a sensor, gets a control action
  assert.equal(actions.filter((a) => a.entityId.startsWith("sensor.")).length, 0);
});

test("save writes variables.json and a backup, reset restores defaults", () => {
  _resetCache();
  const first = saveVariables({
    ...defaultVariables(),
    site: { ...defaultVariables().site, pw_soc: "sensor.custom_soc" },
  });
  assert.equal(first.ok, true, first.errors.join("; "));
  assert.ok(fs.existsSync(path.join(dir, "variables.json")));
  const second = saveVariables({
    ...getVariables(),
    site: { ...getVariables().site, pw_soc: "sensor.another_soc" },
  });
  assert.equal(second.ok, true);
  assert.ok(fs.existsSync(path.join(dir, "variables.json.bak")));
  const bak = JSON.parse(fs.readFileSync(path.join(dir, "variables.json.bak"), "utf8"));
  assert.equal(bak.site.pw_soc, "sensor.custom_soc");
  const reset = resetVariables();
  assert.equal(reset.ok, true);
  assert.equal(getVariables().site.pw_soc, defaultVariables().site.pw_soc);
});
