<script lang="ts">
  import { onMount } from 'svelte';
  import { getPushPreference, pushDeviceId, setPushPreference } from '$lib/push-client';
  import { applicationServerKey, subscriptionUsesCurrentVapidKey } from '$lib/push-subscription';

  let { publicKey, appName = 'cmail' } = $props<{ publicKey: string; appName?: string }>();
  let supported = $state(false);
  let installationRequired = $state(false);
  let enabled = $state(false);
  let busy = $state(false);
  let denied = $state(false);
  let message = $state('');

  function subscriptionUsesCurrentKey(subscription: PushSubscription): boolean {
    return subscriptionUsesCurrentVapidKey(subscription.options.applicationServerKey, publicKey);
  }

  async function save(subscription: PushSubscription, explicitEnable = false): Promise<void> {
    const deviceId = await pushDeviceId();
    const response = await fetch('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), device_id: deviceId, ...(explicitEnable ? { enable: true } : {}) }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Your account can no longer receive alerts. Sign in again after an administrator reactivates it.');
      }
      throw new Error('New-mail alerts could not be saved.');
    }
  }

  async function removeFromServer(endpoint: string, disable = false): Promise<boolean> {
    try {
      const deviceId = await pushDeviceId();
      const response = await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(endpoint ? { endpoint } : {}), device_id: deviceId, ...(disable ? { disable: true } : {}) }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function currentSubscription(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !subscriptionUsesCurrentKey(subscription)) {
      // A VAPID public-key rotation makes the existing browser capability
      // unusable. Remove it server-side first where possible, then require a
      // successful local unsubscribe before creating its replacement.
      if (!await removeFromServer(subscription.endpoint)) {
        throw new Error('New-mail alerts could not refresh their server registration. Try again.');
      }
      if (!await subscription.unsubscribe().catch(() => false)) {
        throw new Error('New-mail alerts could not refresh their browser registration. Try again.');
      }
      subscription = null;
    }
    return subscription || registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  }

  async function refreshSubscription(): Promise<void> {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const preference = getPushPreference();
    if (preference === 'off') {
      // A previous cleanup may have been interrupted. Retry both independent
      // stop paths, but never re-register after an explicit device opt-out.
      const serverRemoved = await removeFromServer(subscription?.endpoint || '', true);
      const browserRemoved = subscription ? await subscription.unsubscribe().catch(() => false) : true;
      enabled = !serverRemoved && !browserRemoved;
      if (enabled) message = 'New-mail alerts could not be disabled. Choose Turn off to retry.';
      return;
    }
    if (Notification.permission === 'granted' && (subscription || preference === 'on')) {
      const current = await currentSubscription(registration);
      await save(current);
      await setPushPreference('on');
      enabled = true;
      return;
    }
    enabled = false;
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
        if (denied) message = 'Allow notifications in this site’s settings, then reload.';
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
      created = await currentSubscription(registration);
      await save(created, true);
      await setPushPreference('on');
      enabled = true;
      message = 'New-mail alerts are on for this browser.';
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
    await setPushPreference('off');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const serverRemoved = await removeFromServer(subscription.endpoint, true);
        const browserRemoved = await subscription.unsubscribe().catch(() => false);
        if (!serverRemoved && !browserRemoved) throw new Error('subscription-cleanup');
        enabled = false;
        message = serverRemoved && !browserRemoved
          ? 'New-mail alerts are off. Cleanup finishes next time you open the app.'
          : !serverRemoved && browserRemoved
            ? 'New-mail alerts are off. The server registration clears automatically.'
            : 'New-mail alerts are off on this browser.';
        return;
      }
      const serverRemoved = await removeFromServer('', true);
      enabled = false;
      message = serverRemoved ? 'New-mail alerts are off on this browser.' : 'New-mail alerts could not be disabled. Choose Turn off to retry.';
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
      <span>Install this app first on iPhone or iPad</span>
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
{:else if !publicKey}
  <section class="push-control" aria-labelledby="push-title">
    <div>
      <span id="push-title">Notifications are not set up for this organisation yet.</span>
    </div>
  </section>
{/if}

<style>
  .push-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; padding: 10px 8px; border-top: 1px solid var(--border); }
  .push-control > div { min-width: 0; display: flex; flex-direction: column; }
  .push-control strong { font-size: 12px; }
  .push-control span, .push-control p { color: var(--text-muted); font-size: 10px; }
  .push-control p { grid-column: 1 / -1; margin: 0; line-height: 1.4; }
</style>
