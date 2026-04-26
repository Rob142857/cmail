<script>
  import '../app.css';
  import { page } from '$app/state';
  let { children } = $props();
</script>

<svelte:head>
  <title>{page.data?.appName || 'cmail'}</title>
</svelte:head>

{@render children()}
