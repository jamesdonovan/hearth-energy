# Contributing to Hearth

Thank you for considering a contribution. This is a short guide for a first public tree.

## What to work on

Useful contributions include: extra inverter or tariff integrations documented in `docs/INTEGRATIONS.md`, a fully generic N-car Overview / plan view (the layout still assumes two primary slots), tests, and accessibility or documentation fixes.

Please do not include real Home Assistant URLs, tokens, MPANs, meter serials, vehicle names, coordinates, or chat ids in issues, screenshots, or pull requests.

## Development

```bash
cp .env.example .env
# Point HA_URL / HA_TOKEN at a development Home Assistant, or leave them unset to work on the UI.
npm install
npm run install:all
npm run dev
```

Checks, from the repo root or the package you touched:

```bash
npm test --prefix server
npm test --prefix web
npm run build --prefix web
npm run build --prefix server
```

`variables.json` and `settings.json` live under `DATA_DIR` (default `server/data` in development) and are gitignored.

## Pull requests

- Keep the Home Assistant token on the server. Do not add client-side code that reads `HA_TOKEN` or other secrets.
- New entity roles should be optional where possible, so a partial config still loads.
- If you change Variables defaults, update `docs/INTEGRATIONS.md` and `server/test/variables.test.mjs`.
- Be kind in review; small, focused PRs are easier to land.


## Contributor terms

By submitting a contribution (a pull request, patch, or other suggested change) you license that contribution to the author, James Donovan, under the same PolyForm Noncommercial License 1.0.0 that covers this repository, and you also grant the author the right to relicense your contribution, including under commercial terms. This keeps Hearth free for personal and noncommercial use while leaving the author free to offer a commercial licence later.
