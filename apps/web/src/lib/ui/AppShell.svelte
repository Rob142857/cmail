<!--
  AppShell — the frame both authenticated surfaces render inside.

    suite header   brand · mode switch (Mail ⇄ Management) · search · account
    nav pane       the surface's own navigation, passed in as a snippet
    command bar    optional per-page actions
    content        scrolls independently of the chrome

  The mode switch is a visible, labelled control rather than a waffle: a
  manager should never have to work out which surface they are in, and the
  management centre must not be somewhere you arrive at by accident.

  Accessibility carried over from the layouts this replaces: the drawer is
  `inert` while closed on mobile, focus moves into it on open and returns to
  the toggle on close, and Escape closes search before navigation.
-->
<script>
  import { browser } from '$app/environment';
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import Brand from './Brand.svelte';
  import Icon from './Icon.svelte';
  import UserMenu from './UserMenu.svelte';

  /**
   * @type {{
   *   appName?: string,
   *   user: any,
   *   mode?: 'mail' | 'admin',
   *   supportEmail?: string,
   *   navLabel?: string,
   *   search?: { action: string, value?: string, placeholder?: string, hidden?: Array<{ name: string, value: string }> } | null,
   *   nav?: import('svelte').Snippet,
   *   commandBar?: import('svelte').Snippet,
   *   children?: import('svelte').Snippet,
   * }}
   */
  let {
    appName = 'cmail',
    user,
    mode = 'mail',
    supportEmail = '',
    navLabel = '',
    search = null,
    nav,
    commandBar,
    children,
  } = $props();

  let navOpen = $state(false);
  let isNarrow = $state(false);
  let searchOpen = $state(false);
  /** @type {HTMLButtonElement | null} */
  let navToggle = $state(null);
  /** @type {HTMLElement | null} */
  let navPane = $state(null);
  /** @type {HTMLInputElement | null} */
  let searchInput = $state(null);

  const isManager = $derived(user?.role === 'manager');
  const paneLabel = $derived(navLabel || (mode === 'admin' ? 'Management navigation' : 'Mail navigation'));

  afterNavigate(() => {
    navOpen = false;
    searchOpen = false;
  });

  // Offline, SvelteKit can't load the next page's data and falls back to a
  // full page load, which swaps the app for the browser's offline page.
  // Stay put instead and say why.
  let offline = $state(false);
  let offlineNotice = $state('');
  beforeNavigate((navigation) => {
    if (navigation.willUnload || navigator.onLine) return;
    if (navigation.to?.url.origin !== location.origin) return;
    navigation.cancel();
    offlineNotice = 'You\'re offline. Reconnect to open this page.';
  });

  onMount(() => {
    const syncOnline = () => {
      offline = !navigator.onLine;
      if (!offline) offlineNotice = '';
    };
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  });

  onMount(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const sync = () => {
      isNarrow = media.matches;
      if (!isNarrow) navOpen = false;
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  });

  // Lock the page behind the drawer so the content underneath cannot scroll.
  $effect(() => {
    if (!browser) return;
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  });

  // Move focus into the drawer when it opens, so keyboard and screen-reader
  // users land inside it rather than behind it.
  $effect(() => {
    if (navOpen && isNarrow) {
      requestAnimationFrame(() => {
        /** @type {HTMLElement | null | undefined} */
        const first = navPane?.querySelector('a, button');
        first?.focus();
      });
    }
  });

  function closeNav() {
    if (!navOpen) return;
    navOpen = false;
    if (isNarrow) requestAnimationFrame(() => navToggle?.focus());
  }

  function openSearch() {
    searchOpen = true;
    queueMicrotask(() => searchInput?.focus());
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    if (searchOpen) {
      searchOpen = false;
      return;
    }
    closeNav();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  <header class="suite">
    <button
      type="button"
      class="suite-btn suite-btn-icon nav-toggle"
      bind:this={navToggle}
      aria-label={`${navOpen ? 'Close' : 'Open'} ${mode === 'admin' ? 'management' : 'mail'} navigation`}
      aria-expanded={navOpen}
      aria-controls="shell-navigation"
      onclick={() => (navOpen ? closeNav() : (navOpen = true))}
    >
      <Icon name={navOpen ? 'close' : 'menu'} size={20} />
    </button>

    <a href="/mail" class="suite-brand" aria-label="{appName} home">
      <Brand name={appName} size={26} tone="onDark" id="suite" />
    </a>

    {#if isManager}
      <span class="suite-sep" aria-hidden="true"></span>
      <nav class="mode-switch" aria-label="Application">
        <a href="/mail" aria-current={mode === 'mail' ? 'true' : undefined}>
          <Icon name="inbox" size={15} /><span class="mode-label">Mail</span>
        </a>
        <a href="/admin" aria-current={mode === 'admin' ? 'true' : undefined}>
          <Icon name="shieldCheck" size={15} /><span class="mode-label">Management</span>
        </a>
      </nav>
    {/if}

    <span class="suite-spacer"></span>

    {#if search}
      <form
        method="GET"
        action={search.action}
        class="suite-search"
        class:expanded={searchOpen}
        role="search"
      >
        {#each search.hidden || [] as hidden}
          <input type="hidden" name={hidden.name} value={hidden.value} />
        {/each}
        <span class="suite-search-icon"><Icon name="search" size={16} /></span>
        <input
          type="search"
          name="q"
          bind:this={searchInput}
          value={search.value || ''}
          placeholder={search.placeholder || 'Search'}
          aria-label={search.placeholder || 'Search'}
        />
        {#if searchOpen}
          <button type="button" class="search-close" aria-label="Close search" onclick={() => (searchOpen = false)}>
            <Icon name="close" size={16} />
          </button>
        {/if}
      </form>
      <button type="button" class="suite-btn suite-btn-icon search-toggle" aria-label="Search" onclick={openSearch}>
        <Icon name="search" size={18} />
      </button>
      <span class="suite-spacer"></span>
    {/if}

    <UserMenu {user} {supportEmail} {isManager} {mode} />
  </header>

  <div class="shell-body">
    <button
      type="button"
      class="nav-scrim"
      class:open={navOpen}
      aria-label="Close navigation"
      tabindex={navOpen ? 0 : -1}
      onclick={closeNav}
    ></button>

    <aside
      bind:this={navPane}
      id="shell-navigation"
      class="nav-pane"
      class:open={navOpen}
      aria-label={paneLabel}
      inert={isNarrow && !navOpen}
    >
      {@render nav?.()}
    </aside>

    <main class="content" id="main-content" tabindex="-1" inert={isNarrow && navOpen}>
      {#if offline || offlineNotice}
        <div class="offline-bar" role="status">
          <Icon name="warning" size={16} />
          <span>{offlineNotice || 'You\'re offline. What\'s on screen stays here; reconnect to load more.'}</span>
        </div>
      {/if}
      {#if commandBar}
        <div class="command-bar">{@render commandBar()}</div>
      {/if}
      <div class="content-scroll">
        <div class="content-inner">
          {@render children?.()}
        </div>
      </div>
    </main>
  </div>
</div>

<style>
  .offline-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--warning-border);
    background: var(--warning-soft);
    color: var(--warning-text);
    font-size: 13px;
    flex: 0 0 auto;
  }
  .nav-toggle { display: none; }
  .search-toggle { display: none; }
  .search-close { display: none; }

  @media (max-width: 860px) {
    .nav-toggle { display: inline-flex; }
    /* Icon-only on narrow screens, but keep the name for screen readers. */
    .mode-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }

  @media (max-width: 700px) {
    /* No room for a permanent field beside the brand, mode switch and
       account chip — collapse to an icon that expands over the header. */
    .search-toggle { display: inline-flex; }
    .suite-search { display: none; }
    .suite-search.expanded {
      display: flex;
      position: absolute;
      inset: 0 8px;
      top: 50%;
      transform: translateY(-50%);
      height: 44px;
      z-index: 2;
      background: var(--bg-surface);
      border-color: var(--border);
      color: var(--text);
      flex: 1 1 auto;
    }
    .suite-search.expanded :global(.suite-search-icon) { color: var(--text-muted); }
    .suite-search.expanded input { color: var(--text); }
    .suite-search.expanded input::placeholder { color: var(--text-faint); }
    .search-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      min-height: 44px;
      height: 44px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-muted);
      flex: 0 0 auto;
    }
    .search-close:hover { background: var(--bg-hover); }
  }

  @media (max-width: 600px) {
    /* Mark only — the wordmark costs more width than it earns here. */
    .suite-brand :global(.brand-word) { display: none; }
    .suite-sep { display: none; }
  }
</style>
