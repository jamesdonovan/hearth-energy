# Setting up Hearth

## 1. Create a Home Assistant token

In Home Assistant: your profile (bottom of the sidebar) → **Security** → **Long-lived access tokens** → create a token. Copy it once. Put it only in Hearth's `.env` as `HA_TOKEN`. It must never be pasted into the browser, into `variables.json`, or into a screenshot.

Give the token a user that can read the entities you will map. If you want Hearth to change a charge switch, Predbat mode, a boost helper or a charger mode, that user also needs permission to call those services. For a read-only dashboard, set `ALLOW_ACTIONS=false`.

## 2. Docker Compose (recommended)

From the repo root:

```bash
cp .env.example .env
# Edit .env and set at least HA_URL and HA_TOKEN.
docker compose up -d --build
```

`docker-compose.yml` and `docker-compose.example.yml` are the same starting point. State is stored in `./data` on the host, mounted at `/app/data` in the container.

Open http://localhost:3000. The first load uses the built-in **example** entity ids (placeholders such as `sensor.powerwall_percentage_charged` and `sensor.octopus_energy_electricity_mpan_serial_current_rate`). Those will not match your Home Assistant until you map them.

### Development (without Docker)

Requires Node.js 22+:

```bash
cp .env.example .env
npm install
npm run install:all
npm run dev
```

The web UI is on the Vite dev server (usually http://localhost:5173) and proxies `/api` to the Node server on port 3000.

## 3. First-run Variables walkthrough

Go to **Settings → Variables**. There are four sections:

1. **Home Energy** — battery SoC and power, solar, grid, home load, and the daily energy counters. Also battery capacity (kWh) and PowerPrint thresholds.
2. **Vehicles** — add or remove cars. Each car has SoC, range, charge limit, plugged / charging, optional last-known helpers, Predbat slot sensors, and (for Intelligent Octopus Go) dispatch entities. Link a charger to a car, or add a charger on its own and assign it later.
3. **Energy Tariff** — Octopus (or similar) rate sensors, standing charge, official statistics ids, the cheap window (`23:30`–`05:30` is a typical Octopus Go example) and fallback £ rates used when live sensors are missing.
4. **Predbat** — status, mode, plan HTML, rates, SoC series, costs, PV forecast sensors, and car plan time.

Pick each entity from your real Home Assistant list. Hearth checks that the entity exists before saving. A change takes effect immediately — no rebuild or container restart. You can export, import or reset to the example defaults; each save keeps a `variables.json.bak`. Importing variables cannot touch your Telegram bot token.

Recommended ids for common integrations are in [INTEGRATIONS.md](INTEGRATIONS.md).

**Do not use a charger's "vehicle battery" sensor as the car's SoC** (Ohme's is unreliable). Hearth will refuse that combination. A `*_charging_current_limit` sensor is usually an amps cap, not a SoC target — use the car's own AC charge-limit `number` entity instead.

## 4. Reverse proxy

Do not expose port 3000 to the internet. Put Hearth behind a reverse proxy that requires authentication (Authelia, authentik, Nginx SSO, and similar all work).

If you use HTTPS, set `PUBLIC_URL` to the public origin (no trailing slash), for example `https://hearth.example.com`. Telegram confirmation buttons use this URL.

The web app manifest is loaded with `crossorigin="use-credentials"` so that a cookie-based proxy will serve it. If the PWA still fails to install, allow unauthenticated access to `/manifest.webmanifest`, `/favicon.png` and `/icons/*`. Web Push also needs HTTPS.

## 5. Partial or empty config

- Unmapped or unavailable sensors show as "—" or 0. The live flow draws nothing for a missing edge rather than inventing a reading.
- You can remove both example cars in Variables; the Cars page will be empty, and Overview / Wall / the live flow hide unused car slots as far as the current two-slot layout allows (see gaps below).
- Fallback peak / off-peak / standing rates in Variables are used when live tariff sensors are missing.
- If Home Assistant is unreachable, the UI still loads and settings can be edited; live values stay empty until the connection works.

## 6. Known gaps for other setups

These are honest limits of this first public cut, not blockers for a typical UK Powerwall + Predbat + one or two EVs home:

- Overview, Wall, the live power flow and the plan timeline are still built around **two car slots**: a Tesla / Intelligent Octopus Go car and a second car (often a Kia on an Ohme). A third car appears on the Cars page (and in last-night / plan `vehicles` maps) but is not drawn on the Overview flow or the plan chips.
- Some API responses still expose the two primary cars as `tesla` and `ev9` keys (aliases of the first `tesla_iog` and first `kia` / second car) in addition to a `vehicles` map keyed by id. This will likely be flattened in a later release.
- Official Octopus financials need the exact `octopus_energy:electricity_<mpan>_<serial>_…` statistic ids. Without them, those cards fall back to estimates from hourly import and the configured rates.
- Solcast is not a first-class integration. Hearth reads Predbat's PV forecast sensors (`sensor.predbat_pv_today`, and so on), which Predbat itself can feed from Solcast.
- Last-known **Home Assistant** template sensors (`sensor.kia_ev_battery_level_last_known`, and similar) are optional and are not created by Hearth. Hearth also keeps its own last-known cache for configured car entities. See [INTEGRATIONS.md](INTEGRATIONS.md).
- Alert rule ids were renamed for this public copy (`planned_charge_missed`, `charge_min_fraction`). A settings file copied from an older private install would need those keys updated.
- There is no multi-user or per-household login inside Hearth; put authentication on the proxy.
- `ALLOW_ACTIONS` is a single switch for every configured control role. There is no per-entity action policy beyond "if you mapped this role, Hearth may call it".

## Updating

See [UPDATES.md](UPDATES.md) for the two supported flows: pull a published image from `ghcr.io/<owner>/hearth` and restart, or `git pull` and rebuild. The `DATA_DIR` volume (including `variables.json` and `settings.json`) survives either path. Take a copy of `data/variables.json` before a major upgrade if you want a rollback.

The Docker image starts as root so it can make `DATA_DIR` writable, then drops to the `node` user. If the directory still cannot be written, the container exits with a clear error.

Replace `<owner>` with the GitHub user or organisation that publishes the image once the repository exists.
