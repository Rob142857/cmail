const PREFERENCE_KEY = 'cmail_push_preference';
const DEVICE_KEY = 'cmail_push_device_id';
const PREFERENCE_DB = 'cmail-push-preferences';
const PREFERENCE_STORE = 'settings';

function openPreferenceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREFERENCE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PREFERENCE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistSetting(key: string, value: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openPreferenceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PREFERENCE_STORE, 'readwrite');
      transaction.objectStore(PREFERENCE_STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function persistedSetting(key: string): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return null;
  const database = await openPreferenceDatabase();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(PREFERENCE_STORE, 'readonly');
      const request = transaction.objectStore(PREFERENCE_STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function validDeviceId(value: string | null): value is string {
  return !!value && /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
}

export async function pushDeviceId(): Promise<string> {
  let value: string | null = null;
  try { value = localStorage.getItem(DEVICE_KEY); } catch { /* non-essential */ }
  if (!validDeviceId(value)) value = await persistedSetting(DEVICE_KEY).catch(() => null);
  if (!validDeviceId(value)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
    try { localStorage.setItem(DEVICE_KEY, value); } catch { /* non-essential */ }
  }
  await persistSetting(DEVICE_KEY, value).catch(() => undefined);
  return value;
}

function notifyServiceWorker(preference: 'on' | 'off'): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'PUSH_PREFERENCE', preference });
    void navigator.serviceWorker?.getRegistration().then((registration) =>
      registration?.active?.postMessage({ type: 'PUSH_PREFERENCE', preference }))
      .catch(() => undefined);
  } catch { /* non-essential fast path */ }
}

export function getPushPreference(): 'on' | 'off' | '' {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY);
    return value === 'on' || value === 'off' ? value : '';
  } catch {
    return '';
  }
}

export async function setPushPreference(value: 'on' | 'off'): Promise<void> {
  try { localStorage.setItem(PREFERENCE_KEY, value); } catch { /* non-essential */ }
  // The service worker cannot read localStorage. Persist the same explicit
  // choice so a background subscription-rotation event cannot revive alerts
  // after the user opted out.
  notifyServiceWorker(value);
  await persistSetting(PREFERENCE_KEY, value).catch(() => undefined);
}

/**
 * Best-effort device cleanup before the session cookie is revoked. The server
 * endpoint and browser subscription are independent stop paths: either one
 * prevents future alerts, and an expired endpoint is also purged on 404/410.
 */
export async function stopPushBeforeSignOut(): Promise<void> {
  const deviceId = await pushDeviceId();
  await setPushPreference('off');
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const subscription = await registration?.pushManager.getSubscription();

    const controller = new AbortController();
    let timeout = 0;
    const deadline = new Promise<void>((resolve) => {
      timeout = window.setTimeout(() => {
        controller.abort();
        resolve();
      }, 1_000);
    });
    await Promise.race([Promise.allSettled([
      fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(subscription ? { endpoint: subscription.endpoint } : {}), device_id: deviceId, disable: true }),
        signal: controller.signal,
      }),
      subscription?.unsubscribe(),
    ]), deadline]);
    window.clearTimeout(timeout);
  } catch {
    // Signing out must never be blocked by notification cleanup.
  }
}
