/* Crafters Market — Web Push service worker
   Handles `push` events from the backend (via VAPID) and deep-links the
   click target. Scope is "/" because it lives at /service-worker.js.
*/
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: 'Crafters Market', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Crafters Market';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/downloads/cnc-garage-builders.png',
    badge: payload.badge || '/downloads/cnc-garage-builders.png',
    tag: payload.tag || 'cm-broadcast',
    data: { url: payload.url || '/' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if (c.url.includes(target) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
