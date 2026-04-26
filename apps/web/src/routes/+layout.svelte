<script>
  import '../app.css';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import InstallPrompt from '$lib/InstallPrompt.svelte';
  let { children } = $props();

  if (browser && 'serviceWorker' in navigator) {
    // Register with updateViaCache: 'none' so the SW script itself is never
    // served from HTTP cache — every page load fetches a fresh copy.
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // Periodically poll for an updated SW while the page is open.
        setInterval(() => reg.update().catch(() => {}), 60_000);

        // When a new SW takes control, reload so the user immediately sees the
        // new build — no manual refresh / re-install / re-login required.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        // Tell a waiting SW to activate immediately.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch(() => {});
  }
</script>

<svelte:head>
  <title>{page.data?.appName || 'cmail'}</title>
</svelte:head>

{@render children()}
<InstallPrompt />
