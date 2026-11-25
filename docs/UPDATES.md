# Updating Hearth

Hearth is designed so you can publish a release on GitHub and pull it onto the machine that runs the dashboard.

The published image name is `ghcr.io/jamesdonovan/hearth`, where `<owner>` is the GitHub user or organisation that owns the repository. Replace `<owner>` before you use the examples below.

## Pull a published image

A GitHub Actions workflow (`.github/workflows/publish-image.yml`) builds a multi-arch image (`linux/amd64` and `linux/arm64`) and pushes it to GHCR when you push a version tag such as `v12`.

On the host that runs Hearth:

```bash
# After the first image has been published
docker pull ghcr.io/jamesdonovan/hearth:latest
# or pin a release: docker pull ghcr.io/jamesdonovan/hearth:12
docker compose up -d
```

Point `docker-compose.yml` at the image instead of `build: .` if you want updates to be a pull + restart:

```yaml
services:
  hearth:
    image: ghcr.io/jamesdonovan/hearth:latest
    # …
```

GHCR packages for a private repository need a login (`docker login ghcr.io`, using a GitHub personal access token with `read:packages`). Public packages can be pulled without a login.

The container starts as root so it can make `DATA_DIR` (default `/app/data`) writable, then drops to the `node` user. Settings, variables and the audit log in the mounted volume survive a pull and restart. If the directory still cannot be written, the entrypoint exits with a clear error rather than starting half-configured.

## Build from source

```bash
git pull
docker compose up -d --build
```

Or, without Compose:

```bash
git pull
docker build -t hearth:local .
docker run -d --name hearth-energy --restart unless-stopped \
  -p 3000:3000 --env-file .env \
  -e DATA_DIR=/app/data \
  -v "$(pwd)/data:/app/data" \
  hearth:local
```

Copy `variables.json` (and `settings.json` if you want a rollback) out of `DATA_DIR` before a major upgrade.

## First publish from a new repository

1. Create the GitHub repository (you choose the name and whether it is public or private).
2. Replace `<owner>` in this document and in `docker-compose.yml` if you use the image form above.
3. Push `main`, then `git tag v12 && git push origin v12` (or the current version).
4. Confirm the package appears at `https://github.com/jamesdonovan/hearth-energy/pkgs/container/hearth` and, for a private repo, that the host can log in to GHCR.
