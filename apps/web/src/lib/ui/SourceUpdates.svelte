<script lang="ts">
  import { onMount } from 'svelte';
  import type { UpdateStatus } from '$lib/server/source-updates';

  let { supportEmail = '' }: { supportEmail?: string } = $props();
  let update = $state<UpdateStatus | null>(null);
  const supportLink = $derived(
    /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(supportEmail)
      ? `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent('cmail update support')}&body=${encodeURIComponent(`Please help us update cmail.\n\nInstalled web build: ${update?.build.revision || 'unknown'}\nUpdate status: ${update?.status || 'unknown'}\nChanges: ${update?.changesUrl || 'unavailable'}\n`)}`
      : '',
  );
  onMount(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/admin/source-updates', { signal: controller.signal });
        if (response.ok) update = await response.json();
      } catch { /* Update checks must not interrupt management or mail. */ }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60 * 60 * 1000);
    return () => { controller.abort(); clearInterval(timer); };
  });
</script>

{#if update}
  <div class="source-update" aria-live="polite">
    <span>Web build {update.build.revision.slice(0, 8)}{update.build.modified ? ' (modified)' : ''}</span>
    {#if update.status === 'available'}
      <strong>Source update available · {update.ahead} new {update.ahead === 1 ? 'commit' : 'commits'}</strong>
      <a href={update.changesUrl!} target="_blank" rel="noreferrer">Review changes</a>
    {:else if update.status === 'current'}
      <span>Up to date with source at last check</span>
    {:else if update.status === 'custom'}
      <span>Custom build — review source compatibility before updating</span>
    {:else}
      <span>Update status unavailable</span>
    {/if}
    {#if update.checkedAt}<span>Checked {new Date(update.checkedAt).toLocaleString()}</span>{/if}
    <a href="https://github.com/Rob142857/cmail/blob/main/docs/deployment.md#updating-an-existing-instance" target="_blank" rel="noreferrer">Update procedure</a>
    {#if supportLink}<a href={supportLink}>Email support</a>{/if}
  </div>
{/if}

<style>
  .source-update { display: grid; gap: 5px; padding: 10px; font-size: 12px; overflow-wrap: anywhere; }
</style>
