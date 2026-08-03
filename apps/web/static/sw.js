// cmail service worker — minimal, network-first, auto-updating.
// We do NOT cache responses — the goal is just PWA installability and
// guaranteeing that a new deployment reaches every installed client immediately.

const VERSION = 'cmail-2026-08-03-2';

self.addEventListener('install', (event) => {
  // Take over straight away on first install or version bump.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Wipe any cache from earlier (defensive — we don't use caches now).
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Pass-through: never serve from cache, always fetch fresh from network.
self.addEventListener('fetch', (event) => {
  // Don't intercept; let the browser handle it normally.
});

// Allow page to manually trigger an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Notification payloads are intentionally privacy-minimal. The server sends
// no sender, subject, mailbox address, or message body that could appear on a
// locked screen.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 80) : 'cmail';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 160) : 'A new message arrived.';
  const url = typeof payload.url === 'string' && /^\/mail(?:[/?]|$)/.test(payload.url) ? payload.url : '/mail';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'cmail-new-mail',
    renotify: true,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = event.notification.data?.url;
  const target = typeof requested === 'string' && /^\/mail(?:[/?]|$)/.test(requested) ? requested : '/mail';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      // Let the application navigate so its compose dirty-state guard can
      // prevent a notification click from discarding an unfinished message.
      client.postMessage({ type: 'OPEN_NOTIFICATION', url: target });
      if ('focus' in client) await client.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// Mark version (useful for debugging in DevTools).
self.VERSION = VERSION;
