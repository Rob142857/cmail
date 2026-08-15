const PREFERENCE_KEY = 'cmail_push_preference';

export function getPushPreference(): 'on' | 'off' | '' {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY);
    return value === 'on' || value === 'off' ? value : '';
  } catch {
    return '';
  }
}

export function setPushPreference(value: 'on' | 'off'): void {
  try { localStorage.setItem(PREFERENCE_KEY, value); } catch { /* non-essential */ }
}

/**
 * Best-effort device cleanup before the session cookie is revoked. The server
 * endpoint and browser subscription are independent stop paths: either one
 * prevents future alerts, and an expired endpoint is also purged on 404/410.
 */
export async function stopPushBeforeSignOut(): Promise<void> {
  setPushPreference('off');
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

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
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: controller.signal,
      }),
      subscription.unsubscribe(),
    ]), deadline]);
    window.clearTimeout(timeout);
  } catch {
    // Signing out must never be blocked by notification cleanup.
  }
}
