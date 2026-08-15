<script lang="ts">
  import { onMount } from 'svelte';
  import { getPushPreference, setPushPreference } from '$lib/push-client';

  let { publicKey, appName = 'cmail' } = $props<{ publicKey: string; appName?: string }>();
  let supported = $state(false);
  let installationRequired = $state(false);
  let enabled = $state(false);
  let busy = $state(false);
  let denied = $state(false);
  let message = $state('');

  function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function save(subscription: PushSubscription): Promise<void> {
    const response = await fetch('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Your account can no longer receive new-mail alerts. Sign in again after an administrator reactivates it.');
      }
      throw new Error('New-mail alerts could not be saved.');
    }
  }

  async function removeFromServer(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function refreshSubscription(): Promise<void> {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (getPushPreference() === 'off') {
      if (!subscription) {
        enabled = false;
        return;
      }
      // A previous cleanup may have been interrupted. Retry both independent
      // stop paths, but never re-register after an explicit device opt-out.
      const serverRemoved = await removeFromServer(subscription.endpoint);
      const browserRemoved = await subscription.unsubscribe().catch(() => false);
      enabled = !serverRemoved && !browserRemoved;
      if (enabled) message = 'New-mail alerts could not be fully disabled. Choose Turn off to retry.';
      return;
    }
    enabled = Boolean(subscription && Notification.permission === 'granted');
    if (enabled && subscription) {
      await save(subscription);
      setPushPreference('on');
    }
  }

  onMount(() => {
    let disposed = false;
    const refresh = () => {
      if (!disposed && supported && document.visibilityState === 'visible') {
        void refreshSubscription().catch(() => { enabled = false; });
      }
    };
    const initialise = async () => {
      const isIos = /iPad|iPhone|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      if (isIos && !isStandalone) {
        installationRequired = true;
        return;
      }
      supported = Boolean(publicKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
      if (!supported) return;
      denied = Notification.permission === 'denied';
      try {
        await refreshSubscription();
        if (denied) message = 'Allow notifications in this site’s browser settings, then reload.';
      } catch {
        enabled = false;
        message = 'Alert status could not be checked.';
      }
    };
    void initialise();
    window.addEventListener('cmail-push-refresh', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('cmail-push-refresh', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  });

  async function enable(): Promise<void> {
    if (busy) return;
    busy = true;
    message = '';
    let created: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      denied = permission === 'denied';
      if (permission !== 'granted') {
        message = denied ? 'Notifications are blocked in browser settings.' : 'Notification permission was not granted.';
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      created = await registration.pushManager.getSubscription();
      if (!created) {
        created = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        });
      }
      await save(created);
      setPushPreference('on');
      enabled = true;
      message = `New-mail alerts are enabled for ${appName} on this browser.`;
    } catch (error) {
      if (created && !enabled) await created.unsubscribe().catch(() => false);
      enabled = false;
      message = error instanceof Error ? error.message : 'New-mail alerts could not be enabled.';
    } finally {
      busy = false;
    }
  }

  async function disable(): Promise<void> {
    if (busy) return;
    busy = true;
    message = '';
    setPushPreference('off');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const serverRemoved = await removeFromServer(subscription.endpoint);
        const browserRemoved = await subscription.unsubscribe().catch(() => false);
        if (!serverRemoved && !browserRemoved) throw new Error('subscription-cleanup');
        enabled = false;
        message = serverRemoved && !browserRemoved
          ? 'New-mail alerts are off. This browser will retry local cleanup when the app reopens.'
          : !serverRemoved && browserRemoved
            ? 'New-mail alerts are off. The expired server endpoint will be removed automatically.'
            : 'New-mail alerts are off on this browser.';
        return;
      }
      enabled = false;
      message = 'New-mail alerts are off on this browser.';
    } catch {
      message = 'New-mail alerts could not be disabled. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

{#if installationRequired}
  <section class="push-control" aria-labelledby="push-title">
    <div>
      <strong id="push-title">New-mail alerts</strong>
      <span>Install this web app first on iPhone or iPad</span>
    </div>
    <a class="btn btn-sm" href="/help/mobile">Setup</a>
  </section>
{:else if supported}
  <section class="push-control" aria-labelledby="push-title">
    <div>
      <strong id="push-title">New-mail alerts</strong>
      <span>{enabled ? 'On for this browser' : denied ? 'Blocked by browser' : 'Off for this browser'}</span>
    </div>
    <button type="button" class="btn btn-sm" disabled={busy || denied} onclick={enabled ? disable : enable}>
      {busy ? 'Working…' : enabled ? 'Turn off' : 'Turn on'}
    </button>
    {#if message}<p role="status">{message}</p>{/if}
  </section>
{/if}

<style>
  .push-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; padding: 10px 8px; border-top: 1px solid var(--border); }
  .push-control > div { min-width: 0; display: flex; flex-direction: column; }
  .push-control strong { font-size: 12px; }
  .push-control span, .push-control p { color: var(--text-muted); font-size: 10px; }
  .push-control p { grid-column: 1 / -1; margin: 0; line-height: 1.4; }
</style>
