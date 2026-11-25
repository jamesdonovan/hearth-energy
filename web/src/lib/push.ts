import { deviceName, getJson, postJson } from "./api";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iOS only allows web push from a PWA installed to the home screen. */
export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
export function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export async function registerSw() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushStatus(): Promise<{ supported: boolean; permission: NotificationPermission | "unsupported"; subscribed: boolean }> {
  if (!pushSupported()) return { supported: false, permission: "unsupported", subscribed: false };
  const sub = await currentSubscription().catch(() => null);
  let subscribed = false;
  if (sub) {
    const r = await postJson<{ subscribed: boolean }>("/api/push/status", { endpoint: sub.endpoint }).catch(() => ({ subscribed: false }));
    subscribed = r.subscribed;
  }
  return { supported: true, permission: Notification.permission, subscribed };
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser does not support web push");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted");
  const reg = (await registerSw()) && (await navigator.serviceWorker.ready);
  if (!reg) throw new Error("Service worker failed to register");
  const { publicKey } = await getJson<{ publicKey: string }>("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // If the server key changed (fresh data dir), resubscribe.
    const cur = sub.options?.applicationServerKey;
    if (cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
  await postJson("/api/push/subscribe", { subscription: sub.toJSON(), device: deviceName() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await postJson("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await currentSubscription();
  return postJson<{ ok: boolean; sent: number }>("/api/push/test", { endpoint: sub?.endpoint });
}
