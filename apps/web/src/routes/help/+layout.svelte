<script lang="ts">
  import { page } from '$app/state';

  let { children } = $props();

  const sections = [
    { href: '/help', label: 'Help home' },
    { href: '/help/mobile', label: 'Mobile access' },
    { href: '/help/getting-started', label: 'Using mail' },
    { href: '/help/shared-mailboxes', label: 'Shared mailboxes' },
    { href: '/help/managers', label: 'Manager handbook' },
    { href: '/help/support', label: 'Support process' },
    { href: '/help/standards', label: 'Standards & assurance' },
  ];

  function active(href: string): boolean {
    return href === '/help' ? page.url.pathname === href : page.url.pathname.startsWith(href);
  }
</script>

<svelte:head>
  <title>Help · {page.data?.appName || 'cmail'}</title>
</svelte:head>

<div class="help-shell">
  <header class="help-header">
    <a class="help-brand" href={page.data?.user ? '/mail' : '/'}>
      <img src={page.data?.brandIconUrl || '/icon.svg'} alt="" width="28" height="28" />
      <span><strong>{page.data?.appName || 'cmail'}</strong><small>Help centre</small></span>
    </a>
    <nav aria-label="Help sections">
      {#each sections as section}
        <a href={section.href} class:active={active(section.href)} aria-current={active(section.href) ? 'page' : undefined}>{section.label}</a>
      {/each}
    </nav>
    <a class="btn return-link" href={page.data?.user ? '/mail' : '/'}>{page.data?.user ? 'Return to mail' : 'Sign in'}</a>
  </header>

  <main id="main-content" class="help-content" tabindex="-1">
    {@render children()}
  </main>

  <footer class="help-footer">
    <span>Email management for small and distributed organisations.</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/help/standards">Standards &amp; assurance</a> · open source under the MIT License</span>
  </footer>
</div>

<style>
  .help-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
  .help-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 24px;
    min-height: 68px;
    padding: 10px max(20px, calc((100vw - 1240px) / 2));
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 94%, transparent);
    backdrop-filter: blur(12px);
  }
  .help-brand { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--text); text-decoration: none; }
  .help-brand span { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .help-brand strong { font-size: 14px; }
  .help-brand small { color: var(--text-muted); font-size: 10px; }
  .help-header nav { display: flex; justify-content: center; gap: 3px; overflow-x: auto; scrollbar-width: thin; }
  .help-header nav a { padding: 8px 10px; border-radius: var(--radius); color: var(--text-muted); font-size: 12px; font-weight: 550; text-decoration: none; white-space: nowrap; }
  .help-header nav a:hover { background: var(--bg-hover); color: var(--text); }
  .help-header nav a.active { background: var(--primary-soft); color: var(--primary); }
  .return-link { font-size: 12px; }
  .help-content { width: min(100% - 40px, 920px); flex: 1; margin: 0 auto; padding: 44px 0 64px; }
  .help-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 24px; padding: 22px max(20px, calc((100vw - 1240px) / 2)); border-top: 1px solid var(--border); color: var(--text-muted); font-size: 11px; }
  @media (max-width: 880px) {
    .help-header { position: static; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 10px 14px; }
    .help-header nav { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; padding-bottom: 2px; }
    .help-content { width: min(100% - 28px, 920px); padding-top: 30px; }
  }
  @media (max-width: 520px) {
    .help-header nav a { padding-inline: 8px; }
    .return-link { padding-inline: 10px; }
    .help-footer { flex-direction: column; }
  }
</style>
