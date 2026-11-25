# Recommended entity ids

Hearth ships with **example placeholders**, not a live household. Replace them in Settings → Variables. Entity ids in Home Assistant usually include the device or vehicle name; the strings below use generic prefixes (`powerwall`, `tesla`, `kia`, `ohme_epod`, `mpan`, `serial`).

Angle-bracket tokens such as `<MPAN>` and `<SERIAL>` are documentation only. In an entity id they become lowercase letters or digits, for example `sensor.octopus_energy_electricity_mpan_serial_current_rate` until you substitute your real MPAN and meter serial.

## Tesla Powerwall (official Tesla / Tessie / similar)

The official Tesla Powerwall integration names entities after the gateway or site, often `my_home_percentage_charged` or `powerwall_…`. Map these Home Energy roles:

| Hearth role | Typical entity | Notes |
| --- | --- | --- |
| Powerwall SoC | `sensor.powerwall_percentage_charged` | `%` |
| Battery power | `sensor.powerwall_battery_power` | kW, **+ discharging / − charging** |
| Grid power | `sensor.powerwall_grid_power` | kW, **+ import / − export** |
| Load power | `sensor.powerwall_load_power` | Whole-home kW, usually including car chargers |
| Solar power | `sensor.powerwall_solar_power` | kW, ≥ 0 |
| Grid imported / exported | `sensor.powerwall_grid_imported` / `_exported` | Daily or lifetime kWh |
| Solar generated / exported | `sensor.powerwall_solar_generated` / `_exported` | kWh |
| Home usage | `sensor.powerwall_home_usage` | kWh |
| Battery charged / discharged | `sensor.powerwall_battery_charged` / `_discharged` | kWh |
| Battery from grid / solar | `sensor.powerwall_battery_imported_from_grid` / `_from_solar` | kWh |
| Operation mode, backup reserve, allow export, storm watch | `select` / `number` / `switch` / `binary_sensor` counterparts | Optional |
| Capacity | `13.5` kWh | Typical Powerwall 2 / 3 usable capacity; edit if yours differs |

If your integration created `_2` suffixes (duplicate devices), pick the live ones.

## Tesla Fleet / Tesla custom component (car)

Example vehicle prefix `tesla` (often the car's name instead):

| Role | Typical entity |
| --- | --- |
| SoC | `sensor.tesla_battery_level` |
| Range | `sensor.tesla_battery_range` |
| Charge limit | `number.tesla_charge_limit` |
| Plugged in | `binary_sensor.tesla_charge_cable` |
| Charging / charger power | `sensor.tesla_charging`, `sensor.tesla_charger_power` |
| Charge switch | `switch.tesla_charge` |
| Time to full / energy added / charge rate | `sensor.tesla_time_to_full_charge`, `sensor.tesla_charge_energy_added`, `sensor.tesla_charge_rate` |
| Location | `device_tracker.tesla_location` (Hearth uses `home` / `not_home` only) |
| Connectivity | `binary_sensor.tesla_status` (on = awake) |

**Intelligent Octopus Go** entities from the official Octopus Energy integration look like:

```
binary_sensor.octopus_energy_<ACCOUNT_UUID>_intelligent_dispatching
sensor.octopus_energy_<ACCOUNT_UUID>_intelligent_state
sensor.octopus_energy_<ACCOUNT_UUID>_intelligent_state_of_charge
number.octopus_energy_<ACCOUNT_UUID>_intelligent_charge_target
select.octopus_energy_<ACCOUNT_UUID>_intelligent_target_time
switch.octopus_energy_<ACCOUNT_UUID>_intelligent_smart_charge
switch.octopus_energy_<ACCOUNT_UUID>_intelligent_bump_charge
```

The example defaults use the token `account_uuid` in place of `<ACCOUNT_UUID>`.

Tesla Fleet often reports `unknown` after a Home Assistant restart while the car is asleep. Hearth holds the last valid reading. You can also add trigger-based last-known sensors in Home Assistant (same pattern as Kia, below) if Predbat should keep a stable SoC.

## Kia UVO (`kia_uvo`)

Example prefix `kia`:

| Role | Typical entity |
| --- | --- |
| SoC | `sensor.kia_ev_battery_level` |
| Range | `sensor.kia_ev_range` |
| Charge limit (SoC %) | `number.kia_ac_charging_limit` |
| Plug | `binary_sensor.kia_ev_battery_plug` |
| Charging switch / power | `switch.kia_ev_charging`, `sensor.kia_ev_charging_power` |
| Capacity, odometer, economy, charge duration | `sensor.kia_ev_battery_capacity`, `sensor.kia_odometer`, `sensor.kia_average_fuel_economy_accumulated`, `sensor.kia_estimated_charge_duration` |
| Last updated / last scanned | `sensor.kia_last_updated_at`, `sensor.kia_last_scanned_at` |
| Location | `device_tracker.kia_location` |

**Do not** map `sensor.kia_ev_charging_current_limit` as the charge limit — that is an amps cap, even when it is shown with a `%` unit.

Kia UVO can drop all entities on a failed token refresh. Optional trigger-based template sensors (held for e.g. 72 hours) are recommended for Predbat and can be pointed at Hearth's last-known roles:

```yaml
# packages/car_last_known.yaml  (example — adjust entity ids)
template:
  - trigger:
      - platform: state
        entity_id: sensor.kia_ev_battery_level
    sensor:
      - name: Kia EV battery level last known
        unique_id: kia_ev_battery_level_last_known
        unit_of_measurement: "%"
        state: >
          {% set s = states('sensor.kia_ev_battery_level') %}
          {{ s if s not in ['unknown', 'unavailable', ''] else this.state }}
```

Repeat for range and `number.kia_ac_charging_limit` if Predbat should not see an empty charge limit.

A boost helper is just an `input_boolean` you create, e.g. `input_boolean.car_2_boost`, and optionally an automation that switches the charger to a max-charge mode.

## Ohme (ePod and others)

If the charger is named "ePod", the official Ohme integration typically creates:

| Role | Typical entity |
| --- | --- |
| Status | `sensor.ohme_epod_status` |
| Power | `sensor.ohme_epod_power` |
| Target percentage | `number.ohme_epod_target_percentage` |
| Charge mode | `select.ohme_epod_charge_mode` (`smart_charge`, `max_charge`, `paused`) |
| Energy / slots / target time | `sensor.ohme_epod_energy`, `sensor.ohme_epod_charge_slots`, `time.ohme_epod_target_time` |
| Vehicle battery (display only) | `sensor.ohme_epod_vehicle_battery` |

Never use the Ohme vehicle-battery sensor as the car's SoC. Prefer the car's own integration, and prefer the car's AC charge limit over the Ohme target for Predbat's `car_charging_limit` (the Ohme target can be rewritten when you plug in).

## Octopus Energy (official integration)

Import meter:

```
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_current_rate
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_next_rate
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_previous_rate
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_current_standing_charge
binary_sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_off_peak
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_current_accumulative_consumption
sensor.octopus_energy_electricity_<MPAN>_<SERIAL>_current_accumulative_cost
…_previous_accumulative_consumption / _cost
…_current_total_consumption / _current_total_export
event.octopus_energy_electricity_<MPAN>_<SERIAL>_current_day_rates
event.octopus_energy_electricity_<MPAN>_<SERIAL>_next_day_rates
```

Export meter (often a different `<EXPORT_SERIAL>`):

```
sensor.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_current_rate
sensor.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_next_rate
sensor.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_previous_accumulative_consumption
sensor.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_previous_accumulative_cost
event.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_current_day_rates
event.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_next_day_rates
event.octopus_energy_electricity_<MPAN>_<EXPORT_SERIAL>_export_previous_day_rates
```

Official statistics (Financials), lowercase:

```
octopus_energy:electricity_<mpan>_<serial>_previous_accumulative_cost
octopus_energy:electricity_<mpan>_<serial>_previous_accumulative_cost_peak
octopus_energy:electricity_<mpan>_<serial>_previous_accumulative_cost_off_peak
octopus_energy:electricity_<mpan>_<serial>_previous_accumulative_consumption
…_consumption_peak / _consumption_off_peak
octopus_energy:electricity_<mpan>_<export_serial>_export_previous_accumulative_cost
octopus_energy:electricity_<mpan>_<export_serial>_export_previous_accumulative_consumption
```

**Example fallback rates** (edit to your tariff): peak £0.30/kWh, off-peak £0.07/kWh, standing charge £0.60/day, cheap window 23:30–05:30 (typical Octopus Go / Intelligent Octopus Go). These are used only when live sensors are missing.

Do not commit real MPANs, meter serials or account UUIDs.

## Solcast

Hearth does not talk to Solcast directly. Point the Predbat PV forecast roles at Predbat's sensors, which Predbat can populate from Solcast (or another forecast):

```
sensor.predbat_pv_today
sensor.predbat_pv_tomorrow
sensor.predbat_pv_d2 … sensor.predbat_pv_d6
sensor.predbat_pv_forecast_h0
sensor.predbat_pv_forecast_h0_uncalibrated
```

## Predbat

Most Predbat entities are stable and already match the example defaults (`predbat.status`, `select.predbat_mode`, `predbat.plan_html`, `predbat.rates`, the SoC series, costs, and so on). Per-car slots are typically:

| Predbat car index | Slot | SoC plan | Start |
| --- | --- | --- | --- |
| 0 | `binary_sensor.predbat_car_charging_slot` | `predbat.car_soc` | `predbat.car_charging_start` |
| 1 | `binary_sensor.predbat_car_charging_slot_1` | `predbat.car_soc_1` | `predbat.car_charging_start_1` |

Set each Hearth vehicle's **Predbat car index** to match `apps.yaml`. Ready time is `select.predbat_car_charging_plan_time` (often `07:00`).

For car SoC and charge limit in Predbat, prefer last-known or the car's own entities over a wall charger.
