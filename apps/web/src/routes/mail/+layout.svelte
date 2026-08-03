<script>
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import PushNotifications from '$lib/PushNotifications.svelte';
  import WelcomeGuide from '$lib/WelcomeGuide.svelte';
  let { data, children } = $props();
  /** @type {any} */
  const d = $derived(data);

  let menuOpen = $state(false);
  let isMobile = $state(false);
  /** @type {HTMLButtonElement | null} */
  let menuButton = $state(null);
  /** @type {HTMLElement | null} */
  let sidebar = $state(null);
  afterNavigate(() => { menuOpen = false; });

  onMount(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => {
      isMobile = media.matches;
      if (!isMobile) menuOpen = false;
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  });

  function toggleMenu(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    menuOpen = !menuOpen;
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    if (isMobile) requestAnimationFrame(() => menuButton?.focus());
  }

  // Lock body scroll when drawer open (mobile). Reactive via $effect.
  $effect(() => {
    if (!browser) return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  });

  // Close on Escape.
  function onKey(e) {
    if (e.key === 'Escape' && menuOpen) closeMenu();
  }

  $effect(() => {
    if (menuOpen && isMobile) {
      requestAnimationFrame(() => sidebar?.querySelector('button, a')?.focus());
    }
  });

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
    <button bind:this={menuButton} class="menu-btn" type="button" aria-label={`${menuOpen ? 'Close' : 'Open'} mail navigation`} aria-expanded={menuOpen} aria-controls="mail-navigation" onclick={toggleMenu}>
      {#if menuOpen}
        <span class="menu-icon" aria-hidden="true">✕</span>
      {:else}
        <span class="menu-icon" aria-hidden="true">☰</span>
      {/if}
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
    onclick={closeMenu}
  ></button>

  <aside
    bind:this={sidebar}
    id="mail-navigation"
    class="sidebar"
    class:open={menuOpen}
    inert={isMobile && !menuOpen}
    aria-hidden={isMobile && !menuOpen ? 'true' : undefined}
  >
    <div class="sidebar-header">
      <img src={d.brandIconUrl || '/icon.svg'} alt="" width="22" height="22" style="vertical-align: middle; margin-right: 6px;" />
      <span>{d.appName || 'cmail'}</span>
      <button type="button" class="drawer-close" aria-label="Close navigation" onclick={closeMenu}>✕</button>
    </div>

    <div style="padding: 12px 8px;">
      <a href="/mail/compose" class="btn btn-primary" style="width: 100%; justify-content: center;">
        Compose
      </a>
    </div>

    <div class="sidebar-section">Folders</div>
    <nav class="sidebar-nav">
      {#each folders as folder}
        <a href={folderHref(folder.slug)} class:active={currentFolder === folder.slug} aria-current={currentFolder === folder.slug ? 'page' : undefined}>
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
        <a href={mailboxHref('')} class:active={!currentMailboxId} aria-current={!currentMailboxId ? 'page' : undefined}>
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
            <a href={mailboxHref(mb.id)} class:active={currentMailboxId === mb.id} aria-current={currentMailboxId === mb.id ? 'page' : undefined} title={mb.address}>
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
            <a href={mailboxHref(mb.id)} class:active={currentMailboxId === mb.id} aria-current={currentMailboxId === mb.id ? 'page' : undefined} title={`${mb.address} — ${mb.permissions}`}>
              <span class="mb-label">{mb.display_name || mb.address}</span>
              {#if mb.unread_count > 0}
                <span class="badge badge-info" style="margin-left: auto;">{mb.unread_count}</span>
              {/if}
            </a>
          {/each}
        </nav>
      {/if}
    {/if}

    <div class="sidebar-footer">
      {#if d.pushPublicKey}
        <PushNotifications publicKey={d.pushPublicKey} appName={d.appName || 'cmail'} />
      {/if}
      <div class="account-footer">
        <div class="account-line">
          <span class="account-name" title={d.user?.display_name || d.user?.email}>{d.user?.display_name || d.user?.email}</span>
          <form method="POST" action="/auth/logout">
            <button type="submit" class="sign-out">Sign out</button>
          </form>
        </div>
        <nav class="account-links" aria-label="Account and product help">
          <a href="/help">Help centre</a>
          <a href="/help/shared-mailboxes">Shared mailboxes</a>
          {#if d.supportEmail}<a href={`mailto:${d.supportEmail}`}>Support</a>{/if}
          {#if d.user?.role === 'manager'}<a href="/admin">Management centre</a>{/if}
        </nav>
        <span class="product-credit">cmail · Exchange-style shared mailbox workflows · MIT open source</span>
        <span class="product-disclaimer">Independent software; not affiliated with Microsoft.</span>
      </div>
    </div>
  </aside>

  <main id="main-content" class="main-content" tabindex="-1" inert={isMobile && menuOpen}>
    {@render children()}
  </main>

  {#if d.user?.id}
    <WelcomeGuide
      appName={d.appName || 'cmail'}
      orgName={d.orgName || ''}
      userId={d.user.id}
      isManager={d.user.role === 'manager'}
    />
  {/if}
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
  .drawer-close { display: none; margin-left: auto; width: 36px; height: 36px; padding: 0; }
  .sidebar-footer { margin-top: auto; border-top: 1px solid var(--border); font-size: 13px; }
  .account-footer { padding: 10px 16px 12px; }
  .account-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .account-name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .sign-out { min-height: 30px; padding: 4px 8px; font-size: 11px; }
  .account-links { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 7px; }
  .account-links a { color: var(--text-muted); font-size: 11px; }
  .product-credit { display: block; margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--border); color: var(--text-faint); font-size: 9px; letter-spacing: .02em; }
  .product-disclaimer { display: block; margin-top: 2px; color: var(--text-faint); font-size: 9px; line-height: 1.35; }
  @media (max-width: 768px) {
    .drawer-close { display: inline-flex; }
    .sidebar-header > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
