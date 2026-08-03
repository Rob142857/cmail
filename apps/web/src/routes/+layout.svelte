<script>
  import '../app.css';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import InstallPrompt from '$lib/InstallPrompt.svelte';
  let { children } = $props();

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
    if (!browser || !('serviceWorker' in navigator)) return;
    let updateTimer;
    const openNotification = (event) => {
      const target = event.data?.type === 'OPEN_NOTIFICATION' ? event.data.url : '';
      if (typeof target === 'string' && /^\/mail(?:[/?]|$)/.test(target)) {
        void goto(target);
      }
    };
    navigator.serviceWorker.addEventListener('message', openNotification);
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // Check quietly for a new build without reloading an open compose form.
        // The service worker does not cache application responses, so the next
        // normal navigation or reload receives the current deployment.
        registration.update().catch(() => {});
        updateTimer = setInterval(() => registration.update().catch(() => {}), 5 * 60_000);
      })
      .catch(() => {});
    return () => {
      if (updateTimer) clearInterval(updateTimer);
      navigator.serviceWorker.removeEventListener('message', openNotification);
    };
  });
</script>

<svelte:head>
  <title>{page.data?.appName || 'cmail'}</title>
  <meta name="theme-color" content={page.data?.brandPrimaryColor || '#2563eb'} />
  <meta name="description" content={`Secure, open-source email for ${page.data?.orgName || 'your organisation'}.`} />
  <link rel="icon" href={page.data?.brandIconUrl || '/favicon.svg'} />
  <link rel="apple-touch-icon" sizes="192x192" href={page.data?.brandIcon192Url || '/icon-192.png'} />
  <meta property="og:image" content={socialImageUrl} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={socialImageUrl} />
</svelte:head>

<div
  class="app-root"
  style={`--primary: ${page.data?.brandPrimaryColor || '#2563eb'}; --primary-hover: color-mix(in srgb, ${page.data?.brandPrimaryColor || '#2563eb'} 82%, black); --on-primary: ${page.data?.brandOnPrimary || '#ffffff'};`}
>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  {@render children()}
  <InstallPrompt />
</div>

<style>
  .app-root { min-height: 100%; }
</style>
