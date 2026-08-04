<!-- MessageBar — Fluent-style inline status. Used for every form result. -->
<script>
  import Icon from './Icon.svelte';

  /**
   * @type {{
   *   tone?: 'info' | 'success' | 'warning' | 'danger',
   *   title?: string,
   *   children?: import('svelte').Snippet,
   * }}
   */
  let { tone = 'info', title = '', children } = $props();

  const ICON = { info: 'info', success: 'success', warning: 'warning', danger: 'error' };
  const ROLE = $derived(tone === 'danger' ? 'alert' : 'status');
</script>

<div class="msgbar msgbar-{tone}" role={ROLE}>
  <span class="msgbar-icon"><Icon name={ICON[tone]} size={18} /></span>
  <span class="msgbar-body">
    {#if title}<span class="msgbar-title">{title}</span> {/if}{@render children?.()}
  </span>
</div>
