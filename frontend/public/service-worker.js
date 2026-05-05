/* Crafters Market — combined service worker
   - Web Push (VAPID) — receives `push` events from the FastAPI backend
   - PWA app-shell — installable + offline-friendly
   Bump SW_VERSION whenever this file changes meaningfully so the
   activate handler can purge stale caches.
*/
const SW_VERSION = "v3-2026-05-05";
const RUNTIME_CACHE = `cm-runtime-${SW_VERSION}`;
const PRECACHE = `cm-precache-${SW_VERSION}`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/downloads/cnc-garage-builders.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("cm-") && !k.endsWith(SW_VERSION))
            .map((k) => caches.delete(k)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

/* Fetch strategy:
   - Navigation requests → network-first, fall back to cached "/" shell when offline
   - /api/* → network-only (always live)
   - Static assets (icons, fonts, images) → stale-while-revalidate
*/
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin only — never intercept cross-origin requests (R2, Stripe, fonts CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // API: never cache, always live.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (HTML)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Optionally update the cached shell.
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((c) => c || caches.match(req))),
    );
    return;
  }

  // Static assets — stale-while-revalidate
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/downloads/") ||
    url.pathname.startsWith("/static/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      }),
    );
  }
});

/* ───────────────── Web Push (unchanged behaviour) ───────────────── */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: "Crafters Market", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Crafters Market";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || "cm-broadcast",
    data: { url: payload.url || "/" },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});

/* Allow the app to push a SKIP_WAITING message if needed. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
