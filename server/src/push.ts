import webpush, { type PushSubscription } from "web-push";
import { readJson, writeJson } from "./storage.js";

type Vapid = { publicKey: string; privateKey: string; created: string };
type StoredSub = { sub: PushSubscription; device: string | null; ua: string | null; added: string; last_ok?: string; last_error?: string };

let vapid: Vapid | null = null;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:hearth@localhost";

/** VAPID keys are generated on first run and kept in server/data/vapid.json (chmod 600). */
export function ensureVapid(): Vapid {
  if (vapid) return vapid;
  const saved = readJson<Vapid | null>("vapid.json", null);
  if (saved?.publicKey && saved?.privateKey) {
    vapid = saved;
  } else {
    const k = webpush.generateVAPIDKeys();
    vapid = { publicKey: k.publicKey, privateKey: k.privateKey, created: new Date().toISOString() };
    if (!writeJson("vapid.json", vapid, true)) {
      console.warn("VAPID keys generated but not persisted: push subscriptions will break on restart");
    }
  }
  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

function subs(): StoredSub[] {
  return readJson<StoredSub[]>("push-subscriptions.json", []);
}
function saveSubs(list: StoredSub[]) {
  writeJson("push-subscriptions.json", list, true);
}

export function isValidSub(s: unknown): s is PushSubscription {
  const x = s as PushSubscription;
  return Boolean(x && typeof x.endpoint === "string" && /^https:\/\//.test(x.endpoint) && x.keys?.p256dh && x.keys?.auth);
}

export function addSubscription(sub: PushSubscription, device: string | null, ua: string | null) {
  const list = subs().filter((s) => s.sub.endpoint !== sub.endpoint);
  list.push({ sub, device, ua, added: new Date().toISOString() });
  saveSubs(list);
  return list.length;
}

export function removeSubscription(endpoint: string) {
  const list = subs();
  const next = list.filter((s) => s.sub.endpoint !== endpoint);
  saveSubs(next);
  return list.length - next.length;
}

export function hasSubscription(endpoint: string) {
  return subs().some((s) => s.sub.endpoint === endpoint);
}

export function subscriptionSummary() {
  return subs().map((s) => ({
    device: s.device,
    ua: s.ua,
    added: s.added,
    last_ok: s.last_ok ?? null,
    last_error: s.last_error ?? null,
    host: (() => {
      try {
        return new URL(s.sub.endpoint).host;
      } catch {
        return "?";
      }
    })(),
  }));
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string; severity?: string };

/** Send to every subscription (or only `onlyEndpoint`). Dead subscriptions (404/410) are pruned. */
export async function sendPush(payload: PushPayload, onlyEndpoint?: string) {
  ensureVapid();
  const list = subs();
  let sent = 0;
  let failed = 0;
  const keep: StoredSub[] = [];
  for (const s of list) {
    if (onlyEndpoint && s.sub.endpoint !== onlyEndpoint) {
      keep.push(s);
      continue;
    }
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600, urgency: payload.severity === "warning" ? "high" : "normal" });
      s.last_ok = new Date().toISOString();
      s.last_error = undefined;
      sent++;
      keep.push(s);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      failed++;
      if (code === 404 || code === 410) continue; // expired: drop
      s.last_error = `${code ?? ""} ${(err as Error).message}`.trim().slice(0, 200);
      keep.push(s);
    }
  }
  saveSubs(keep);
  return { sent, failed, total: list.length };
}
