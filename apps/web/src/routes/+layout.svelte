<script>
  import '../app.css';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import InstallPrompt from '$lib/InstallPrompt.svelte';
  let { children } = $props();

  if (browser && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
</script>

<svelte:head>
  <title>{page.data?.appName || 'cmail'}</title>
</svelte:head>

{@render children()}
<InstallPrompt />
