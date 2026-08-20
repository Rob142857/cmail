// cmail service worker — minimal and network-only. Deployment lifecycle checks
// discover new versions without caching mailbox or application responses.

const VERSION = 'cmail-2026-08-20-1';
const PUSH_PREFERENCE_DB = 'cmail-push-preferences';
const PUSH_PREFERENCE_STORE = 'settings';
const PUSH_PREFERENCE_KEY = 'cmail_push_preference';
const PUSH_DEVICE_KEY = 'cmail_push_device_id';
let pushPreferenceOverride = '';

function openPushPreferenceDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_PREFERENCE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PUSH_PREFERENCE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function pushSettings() {
  if (pushPreferenceOverride === 'off') return { preference: 'off', deviceId: '' };
  try {
    const database = await openPushPreferenceDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(PUSH_PREFERENCE_STORE, 'readonly');
        const store = transaction.objectStore(PUSH_PREFERENCE_STORE);
        const preference = store.get(PUSH_PREFERENCE_KEY);
        const device = store.get(PUSH_DEVICE_KEY);
        let remaining = 2;
        const finish = () => {
          remaining -= 1;
          if (!remaining) resolve({
            preference: preference.result === 'on' ? 'on' : 'off',
            deviceId: typeof device.result === 'string' ? device.result : '',
          });
        };
        preference.onsuccess = finish;
        device.onsuccess = finish;
        preference.onerror = () => reject(preference.error);
        device.onerror = () => reject(device.error);
      });
    } finally {
      database.close();
    }
  } catch {
    // Fail closed: a background worker must never revive an alert after an
    // explicit opt-out simply because it cannot read durable preference state.
    return { preference: 'off', deviceId: '' };
  }
}

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

// Allow page to manually trigger an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'PUSH_PREFERENCE' && (event.data.preference === 'on' || event.data.preference === 'off')) {
    pushPreferenceOverride = event.data.preference;
  }
});

// Notification payloads may include the sender and subject the server
// looked up for this message; if that lookup was unavailable, the server
// falls back to a generic, content-free alert instead. Every field here is
// still treated as untrusted: title/body are coerced to strings and capped
// to match the server-side payload builder's limits, and url/tag are
// validated against a fixed shape before use.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 60) : 'cmail';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 120) : 'A new message arrived.';
  const url = typeof payload.url === 'string' && /^\/mail(?:[/?]|$)/.test(payload.url) ? payload.url : '/mail';
  const tag = typeof payload.tag === 'string' && /^cmail:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(payload.tag)
    ? payload.tag
    : 'cmail-new-mail';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: true,
    data: { url },
  }));
});

// Subscription endpoints can rotate while the app is not open. Re-subscribe
// with the browser's existing public VAPID key where available, then persist
// only the replacement subscription through the same-origin, cookie-authenticated
// endpoint. A foreground refresh is retained as the fail-safe path.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const settings = await pushSettings();
    if (settings.preference !== 'on' || !settings.deviceId) {
      // Some browsers can supply a replacement subscription before a stale
      // worker wakes. Do not persist it, and remove it locally where possible.
      await event.newSubscription?.unsubscribe?.().catch(() => undefined);
      return;
    }
    let subscription = event.newSubscription;
    if (!subscription && event.oldSubscription?.options?.applicationServerKey) {
      try {
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: event.oldSubscription.options.applicationServerKey,
        });
      } catch {
        // The next controlled foreground refresh retries without exposing a
        // subscription endpoint or provider error to logs.
      }
    }
    if (subscription) {
      await fetch('/api/push/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...subscription.toJSON(), device_id: settings.deviceId }),
      }).catch(() => undefined);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
  })());
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
