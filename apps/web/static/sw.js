// cmail service worker — minimal, network-first, auto-updating.
// We do NOT cache responses — the goal is just PWA installability and
// guaranteeing that a new deployment reaches every installed client immediately.

const VERSION = 'cmail-2026-04-26-2';

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

// Mark version (useful for debugging in DevTools).
self.VERSION = VERSION;
