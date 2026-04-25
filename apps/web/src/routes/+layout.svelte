<script>
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>{$page?.data?.appName || 'cmail'}</title>
</svelte:head>

{@render children()}

<script module>
  import { page } from '$app/state';
</script>
