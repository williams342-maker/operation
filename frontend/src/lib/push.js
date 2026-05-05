// Web Push helpers — browser-only. Call from a user gesture (click).
import {
  fetchVapidPublicKey,
  registerPushSubscription,
  unregisterPushSubscription,
} from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported.");
  // Register at site root so the SW scope covers the whole app.
  const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;
  const reg = await getServiceWorkerRegistration();
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush({ role, email } = {}) {
  if (!isPushSupported()) {
    throw new Error("This browser does not support web push.");
  }
  // 1) Permission
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error("Notification permission denied.");
  }
  // 2) SW + push subscribe
  const reg = await getServiceWorkerRegistration();
  const { public_key } = await fetchVapidPublicKey();
  const existing = await reg.pushManager.getSubscription();
  let sub = existing;
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
  }
  // 3) Persist on backend
  const payload = sub.toJSON();
  await registerPushSubscription({
    subscription: {
      endpoint: payload.endpoint,
      keys: payload.keys,
      expirationTime: payload.expirationTime || null,
    },
    user_agent: navigator.userAgent,
    role: role || null,
    email: email || null,
  });
  return sub;
}

export async function unsubscribeFromPush() {
  const sub = await getCurrentPushSubscription();
  if (!sub) return { ok: true, removed: 0 };
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch (_e) { /* ignore */ }
  return unregisterPushSubscription(endpoint);
}
