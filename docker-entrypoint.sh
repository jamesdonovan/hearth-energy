#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"

fail() {
  echo "ERROR: DATA_DIR ($DATA_DIR) is not writable. Settings, variables and the audit log cannot be saved." >&2
  echo "Fix the permissions on the mounted volume so the process user can write to it, then restart." >&2
  echo "The official image starts as root, chowns DATA_DIR to the 'node' user, and then drops privileges." >&2
  exit 1
}

if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node "$DATA_DIR"; then
    echo "ERROR: could not chown DATA_DIR ($DATA_DIR) to user 'node'. Check the volume mount." >&2
    exit 1
  fi
  if ! su-exec node sh -c "touch \"$DATA_DIR/.write-test\" && rm -f \"$DATA_DIR/.write-test\""; then
    fail
  fi
  exec su-exec node "$@"
fi

if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  fail
fi
rm -f "$DATA_DIR/.write-test"
exec "$@"
