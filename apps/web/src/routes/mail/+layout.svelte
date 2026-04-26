<script>
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  let { data, children } = $props();
  /** @type {any} */
  const d = $derived(data);

  let menuOpen = $state(false);
  afterNavigate(() => { menuOpen = false; });

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

<div class="app-layout">
  <div class="mobile-topbar">
    <button class="menu-btn" type="button" aria-label="Open navigation" onclick={() => (menuOpen = true)}>
      <span aria-hidden="true">&#9776;</span>
    </button>
    <strong>{d.appName || 'cmail'}</strong>
    <a href="/mail/compose" class="btn btn-primary" style="margin-left: auto; padding: 6px 12px;">Compose</a>
  </div>

  <div class="sidebar-overlay" class:open={menuOpen} onclick={() => (menuOpen = false)} role="presentation"></div>

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
        <form method="POST" action="/auth/logout">
          <button type="submit" style="padding: 4px 8px; font-size: 12px;">Sign out</button>
        </form>
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
</style>
