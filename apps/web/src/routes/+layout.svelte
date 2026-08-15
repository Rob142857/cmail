<script>
  import '../app.css';
  import { page, updated } from '$app/state';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import InstallPrompt from '$lib/InstallPrompt.svelte';
  import { deploymentUpdateAction, shouldCheckForServiceWorkerUpdate } from '$lib/service-worker-update';
  let { children } = $props();
  let updateReady = $state(false);

  function absoluteAssetUrl(assetUrl, appUrl) {
    if (!appUrl) return assetUrl;
    try {
      return new URL(assetUrl, `${appUrl}/`).toString();
    } catch {
      return assetUrl;
    }
  }

  const socialImageUrl = $derived(absoluteAssetUrl(
    page.data?.brandOgImageUrl || '/og-image.svg',
    page.data?.appUrl || '',
  ));

  onMount(() => {
    if (!browser) return;
    const serviceWorkersSupported = 'serviceWorker' in navigator;
    let registration;
    let lastCheckedAt = 0;
    let hadController = serviceWorkersSupported && Boolean(navigator.serviceWorker.controller);

    const handleDeploymentUpdate = () => {
      if (updateReady) return;
      const action = deploymentUpdateAction(window.location.pathname, true);
      if (action === 'show-refresh-banner') {
        updateReady = true;
      }
    };

    const handleActivatedUpdate = () => {
      // The first controller is normal PWA installation. Later changes mean a
      // newly deployed worker is controlling this already-open application.
      if (!hadController) {
        hadController = true;
        return;
      }
      handleDeploymentUpdate();
    };

    const checkForUpdate = () => {
      if (!shouldCheckForServiceWorkerUpdate(lastCheckedAt)) return;
      lastCheckedAt = Date.now();
      registration?.update().catch(() => {});
      // Service-worker bytes do not necessarily change for a route/component
      // deployment. SvelteKit checks /_app/version.json independently.
      updated.check().then((versionChanged) => {
        if (versionChanged) handleDeploymentUpdate();
      }).catch(() => {});
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    const openNotification = (event) => {
      const target = event.data?.type === 'OPEN_NOTIFICATION' ? event.data.url : '';
      if (typeof target === 'string' && /^\/mail(?:[/?]|$)/.test(target)) {
        void goto(target);
      }
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        window.dispatchEvent(new Event('cmail-push-refresh'));
      }
    };
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    if (serviceWorkersSupported) {
      navigator.serviceWorker.addEventListener('message', openNotification);
      navigator.serviceWorker.addEventListener('controllerchange', handleActivatedUpdate);
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((nextRegistration) => {
          registration = nextRegistration;
          if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
        })
        .catch(() => {});
    }
    // Check at launch, then when the installed app returns to foreground,
    // rather than relying on timers throttled by mobile operating systems.
    checkForUpdate();
    return () => {
      if (serviceWorkersSupported) {
        navigator.serviceWorker.removeEventListener('message', openNotification);
        navigator.serviceWorker.removeEventListener('controllerchange', handleActivatedUpdate);
      }
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('pageshow', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
    };
  });

</script>

<svelte:head>
  <title>{page.data?.appName || 'cmail'}</title>
  <meta name="theme-color" content={page.data?.brandPrimaryColor || '#0078d4'} />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content={page.data?.appName || 'cmail'} />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="description" content={`Secure, open-source email for ${page.data?.orgName || 'your organisation'}.`} />
  <link rel="icon" href={page.data?.brandIconUrl || '/favicon.svg'} />
  <link rel="apple-touch-icon" sizes="192x192" href={page.data?.brandIcon192Url || '/icon-192.png'} />
  <meta property="og:image" content={socialImageUrl} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={socialImageUrl} />
</svelte:head>

<div
  class="app-root"
  style={`--primary: ${page.data?.brandPrimaryColor || '#0078d4'}; --primary-hover: color-mix(in srgb, ${page.data?.brandPrimaryColor || '#0078d4'} 82%, black); --on-primary: ${page.data?.brandOnPrimary || '#ffffff'};`}
>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  {#if updateReady}
    <aside class="update-banner" role="status" aria-live="polite">
      <span>An update is ready. Save or complete your work, then close and reopen the app (or refresh in a browser).</span>
    </aside>
  {/if}
  {@render children()}
  <InstallPrompt />
</div>

<style>
  .app-root { min-height: 100%; }
  .update-banner {
    position: sticky;
    z-index: 100;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 9px 14px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 13px;
  }
</style>
