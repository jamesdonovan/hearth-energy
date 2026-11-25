import type { Request } from "express";
import { appendLine, readLines } from "./storage.js";

export type AuditEntry = {
  at: string;
  kind: "action" | "settings" | "push" | "notify-test" | "powerprint" | "variables";
  ok: boolean;
  dry_run?: boolean;
  summary: string;
  detail?: Record<string, unknown>;
  error?: string;
  who: { user: string | null; device: string | null; ip: string | null; ua: string | null };
};

const USER_HEADERS = [
  "remote-user",
  "remote-email",
  "x-pangolin-user",
  "x-pangolin-email",
  "x-forwarded-user",
  "x-forwarded-email",
  "x-auth-request-user",
  "x-auth-request-email",
  "x-authentik-username",
  "cf-access-authenticated-user-email",
];

export function whoFrom(req: Request): AuditEntry["who"] {
  let user: string | null = null;
  for (const h of USER_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string" && v.trim()) {
      user = v.trim().slice(0, 120);
      break;
    }
  }
  const dev = req.headers["x-hearth-device"];
  const fwd = req.headers["x-forwarded-for"];
  const ip = (typeof fwd === "string" ? fwd.split(",")[0].trim() : null) || req.socket.remoteAddress || null;
  const ua = typeof req.headers["user-agent"] === "string" ? shortUa(req.headers["user-agent"]) : null;
  return { user, device: typeof dev === "string" ? dev.slice(0, 60) : null, ip, ua };
}

function shortUa(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export function audit(req: Request, e: Omit<AuditEntry, "at" | "who">) {
  const entry: AuditEntry = { at: new Date().toISOString(), who: whoFrom(req), ...e };
  if (!appendLine("audit.jsonl", entry)) {
    console.warn("audit log not persisted (data dir not writable)", entry.summary);
  }
  return entry;
}

export function readAudit(limit = 200) {
  return readLines<AuditEntry>("audit.jsonl", limit);
}
