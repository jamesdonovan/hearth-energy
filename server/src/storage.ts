import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Persisted data dir. In the container server/ is mounted as /app, so this is server/data on the host. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.resolve(__dirname, "../data"));

let writable: boolean | null = null;
export function dataWritable(): boolean {
  if (writable != null) return writable;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const probe = path.join(DATA_DIR, ".write-test");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    writable = true;
  } catch (err) {
    console.error(`Data dir ${DATA_DIR} is not writable; settings, alerts and audit log will not persist:`, (err as Error).message);
    writable = false;
  }
  return writable;
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write. `secret` files are chmod 600. */
export function writeJson(name: string, value: unknown, secret = false): boolean {
  if (!dataWritable()) return false;
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: secret ? 0o600 : 0o644 });
  fs.renameSync(tmp, file);
  if (secret) {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  }
  return true;
}

export function appendLine(name: string, obj: unknown): boolean {
  if (!dataWritable()) return false;
  fs.appendFileSync(path.join(DATA_DIR, name), JSON.stringify(obj) + "\n", { mode: 0o644 });
  return true;
}

/** Last `limit` JSON lines, newest first. */
export function readLines<T>(name: string, limit = 200): T[] {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: T[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        out.push(JSON.parse(lines[i]) as T);
      } catch {
        /* skip torn line */
      }
    }
    return out;
  } catch {
    return [];
  }
}
