<script>
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';
  let { data, children } = $props();
  /** @type {any} */
  const d = $derived(data);

  let menuOpen = $state(false);
  afterNavigate(() => { menuOpen = false; });

  // Lock body scroll when drawer open (mobile). Reactive via $effect.
  $effect(() => {
    if (!browser) return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  });

  // Close on Escape.
  function onKey(e) {
    if (e.key === 'Escape' && menuOpen) menuOpen = false;
  }

  const folders = [
    { name: 'Inbox', slug: '' },
    { name: 'Sent', slug: 'sent' },
    { name: 'Drafts', slug: 'drafts' },
    { name: 'Archive', slug: 'archive' },
    { name: 'Spam', slug: 'spam' },
    { name: 'Trash', slug: 'trash' },
  ];

  /** Build a /mail href that preserves the currently-selected mailbox (if any) */
  function folderHref(slug) {
    const params = new URLSearchParams();
    if (slug) params.set('folder', slug);
    const mb = page.url.searchParams.get('mailbox');
    if (mb) params.set('mailbox', mb);
    const qs = params.toString();
    return qs ? `/mail?${qs}` : '/mail';
  }

  /** Build a /mail href for a specific mailbox, preserving the current folder */
  function mailboxHref(mailboxId) {
    const params = new URLSearchParams();
    const folder = page.url.searchParams.get('folder');
    if (folder) params.set('folder', folder);
    if (mailboxId) params.set('mailbox', mailboxId);
    const qs = params.toString();
    return qs ? `/mail?${qs}` : '/mail';
  }

  const personalMailboxes = $derived((d.mailboxes || []).filter((/** @type {any} */ m) => m.type === 'personal'));
  const sharedMailboxes = $derived((d.mailboxes || []).filter((/** @type {any} */ m) => m.type === 'shared'));
  const currentMailboxId = $derived(page.url.searchParams.get('mailbox') || '');
  const currentFolder = $derived(page.url.searchParams.get('folder') || '');
</script>

<svelte:window onkeydown={onKey} />

<div class="app-layout">
  <div class="mobile-topbar">
    <button class="menu-btn" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        {#if menuOpen}
          <path d="M6 6 L18 18 M18 6 L6 18" />
        {:else}
          <path d="M4 7 H20 M4 12 H20 M4 17 H20" />
        {/if}
      </svg>
    </button>
    <strong class="topbar-title">{d.appName || 'cmail'}</strong>
    <a href="/mail/compose" class="btn btn-primary topbar-compose">Compose</a>
  </div>

  <button
    type="button"
    class="sidebar-overlay"
    class:open={menuOpen}
    aria-label="Close navigation"
    tabindex={menuOpen ? 0 : -1}
    onclick={() => (menuOpen = false)}
  ></button>

  <aside class="sidebar" class:open={menuOpen}>
    <div class="sidebar-header">
      <img src="/icon.svg" alt="" width="22" height="22" style="vertical-align: middle; margin-right: 6px;" />
      {d.appName || 'cmail'}
    </div>

    <div style="padding: 12px 8px;">
      <a href="/mail/compose" class="btn btn-primary" style="width: 100%; justify-content: center;">
        Compose
      </a>
    </div>

    <div class="sidebar-section">Folders</div>
    <nav class="sidebar-nav">
      {#each folders as folder}
        <a href={folderHref(folder.slug)} class:active={currentFolder === folder.slug}>
          <span>{folder.name}</span>
          {#if folder.slug === '' && d.totalUnread > 0 && !currentMailboxId}
            <span class="badge badge-info" style="margin-left: auto;">{d.totalUnread}</span>
          {/if}
        </a>
      {/each}
    </nav>

    {#if d.mailboxes && d.mailboxes.length > 0}
      <div class="sidebar-section">Mailboxes</div>
      <nav class="sidebar-nav">
        <a href={mailboxHref('')} class:active={!currentMailboxId}>
          <span>All mailboxes</span>
          {#if d.totalUnread > 0}
            <span class="badge badge-info" style="margin-left: auto;">{d.totalUnread}</span>
          {/if}
        </a>
      </nav>

      {#if personalMailboxes.length > 0}
        <div class="sidebar-subsection">Personal</div>
        <nav class="sidebar-nav">
          {#each personalMailboxes as mb}
            <a href={mailboxHref(mb.id)} class:active={currentMailboxId === mb.id} title={mb.address}>
              <span class="mb-label">{mb.display_name || mb.address}</span>
              {#if mb.unread_count > 0}
                <span class="badge badge-info" style="margin-left: auto;">{mb.unread_count}</span>
              {/if}
            </a>
          {/each}
        </nav>
      {/if}

      {#if sharedMailboxes.length > 0}
        <div class="sidebar-subsection">Shared</div>
        <nav class="sidebar-nav">
          {#each sharedMailboxes as mb}
            <a href={mailboxHref(mb.id)} class:active={currentMailboxId === mb.id} title={`${mb.address} — ${mb.permissions}`}>
              <span class="mb-label">{mb.display_name || mb.address}</span>
              {#if mb.unread_count > 0}
                <span class="badge badge-info" style="margin-left: auto;">{mb.unread_count}</span>
              {/if}
            </a>
          {/each}
        </nav>
      {/if}
    {/if}

    <div style="margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--border); font-size: 13px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span>{d.user?.display_name || d.user?.email}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <a href="mailto:desk@maatara.io" style="font-size: 12px; color: var(--text-muted);">Support</a>
          <form method="POST" action="/auth/logout">
            <button type="submit" style="padding: 4px 8px; font-size: 12px;">Sign out</button>
          </form>
        </div>
      </div>
      {#if d.user?.role === 'manager'}
        <a href="/admin" style="font-size: 12px; margin-top: 4px; display: block;">Admin Dashboard</a>
      {/if}
    </div>
  </aside>

  <main class="main-content">
    {@render children()}
  </main>
</div>

<style>
  .sidebar-subsection {
    padding: 8px 16px 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .mb-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
  }
  .topbar-title {
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .topbar-compose {
    padding: 8px 14px;
    font-size: 13px;
    flex-shrink: 0;
  }
</style>
