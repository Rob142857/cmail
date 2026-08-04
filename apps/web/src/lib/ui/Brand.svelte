<!--
  Brand — the mark + name lockup.

  cmail is whitelabel: APP_NAME is set per tenant. So the lockup renders the
  drawn wordmark only when the name is still "cmail"; any other name is set
  in the display face with the wordmark's optical tracking applied, so a
  renamed deployment still looks designed rather than defaulted.
-->
<script>
  import Mark from './Mark.svelte';
  import Wordmark from './Wordmark.svelte';

  /**
   * @type {{
   *   name?: string,
   *   size?: number,
   *   tone?: 'brand' | 'onDark',
   *   gradient?: boolean,
   *   id?: string,
   * }}
   */
  let { name = 'cmail', size = 28, tone = 'brand', gradient = false, id = 'brand' } = $props();

  const isDefault = $derived((name || '').trim().toLowerCase() === 'cmail');
</script>

<span class="brand" style="--brand-size: {size}px">
  <Mark {size} {tone} id="{id}-mk" />
  <span class="brand-word">
    {#if isDefault}
      <Wordmark height={Math.round(size * 0.72)} id="{id}-wm" {gradient} />
    {:else}
      <span class="brand-name">{name}</span>
    {/if}
  </span>
</span>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--brand-size) * 0.32);
    line-height: 1;
    color: inherit;
  }
  .brand-word { display: inline-flex; align-items: center; }
  .brand-name {
    font-family: var(--font-display, inherit);
    font-size: calc(var(--brand-size) * 0.66);
    font-weight: 600;
    letter-spacing: -0.025em;
    white-space: nowrap;
    color: inherit;
  }
</style>
