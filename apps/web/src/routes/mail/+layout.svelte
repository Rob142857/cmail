<script>
  import { page } from '$app/state';
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { browser } from '$app/env';
  import AppShell from '#lib/ui/AppShell.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import Persona from '#lib/ui/Persona.svelte';
  import PushNotifications from '#lib/PushNotifications.svelte';
  import Toast from '#lib/Toast.svelte';
  import WelcomeGuide from '#lib/WelcomeGuide.svelte';

  let { data, children } = $props();
  /** @type {any} */
  const d = $derived(data);

  let toastMessage = $state('');

  afterNavigate(() => {
    let message = page.state?.cmailToast;
    if ((!message || typeof message !== 'string') && browser) {
      try {
        message = sessionStorage.getItem('cmail:pending-navigation-toast') || '';
        sessionStorage.removeItem('cmail:pending-navigation-toast');
      } catch {
        // Navigation and the server-side save remain successful without a toast.
      }
    }
    if (typeof message === 'string' && message) {
      const nextState = { ...page.state };
      delete nextState.cmailToast;
      // On a full page load this runs during hydration, a moment before the
      // router is marked started (dev builds throw then); defer it.
      queueMicrotask(() => {
        try { replaceState(page.url, nextState); } catch { /* the toast still shows */ }
      });
      // Reset first so navigating away from two drafts can announce the same
      // confirmation twice.
      toastMessage = '';
      queueMicrotask(() => { toastMessage = message; });
    }
  });

  /** @type {Array<{ name: string, slug: string, icon: string }>} */
  const folders = [
    { name: 'Inbox', slug: '', icon: 'inbox' },
    { name: 'Sent', slug: 'sent', icon: 'send' },
    { name: 'Drafts', slug: 'drafts', icon: 'drafts' },
    { name: 'Archive', slug: 'archive', icon: 'archive' },
    { name: 'Junk', slug: 'spam', icon: 'junk' },
    { name: 'Deleted', slug: 'trash', icon: 'trash' },
  ];

  const currentMailboxId = $derived(page.url.searchParams.get('mailbox') || '');
  const currentFolder = $derived(page.url.searchParams.get('folder') || '');
  const searchTerm = $derived(page.url.searchParams.get('q') || '');

  const personalMailboxes = $derived((d.mailboxes || []).filter((/** @type {any} */ m) => m.type === 'personal'));
  const sharedMailboxes = $derived((d.mailboxes || []).filter((/** @type {any} */ m) => m.type === 'shared'));

  /** Unread shown against Inbox reflects the mailbox currently in scope. */
  const scopedUnread = $derived.by(() => {
    if (!currentMailboxId) return d.totalUnread || 0;
    const mb = (d.mailboxes || []).find((/** @type {any} */ m) => m.id === currentMailboxId);
    return mb?.unread_count || 0;
  });

  /** Build a /mail href that preserves the currently-selected mailbox. */
  /** @param {string} slug */
  function folderHref(slug) {
    const params = new URLSearchParams();
    if (slug) params.set('folder', slug);
    if (currentMailboxId) params.set('mailbox', currentMailboxId);
    const qs = params.toString();
    return qs ? `/mail?${qs}` : '/mail';
  }

  /** Build a /mail href for a mailbox, preserving the current folder. */
  /** @param {string} mailboxId */
  function mailboxHref(mailboxId) {
    const params = new URLSearchParams();
    if (currentFolder) params.set('folder', currentFolder);
    if (mailboxId) params.set('mailbox', mailboxId);
    const qs = params.toString();
    return qs ? `/mail?${qs}` : '/mail';
  }

  /** Keep a compose action in the mailbox/folder the person was working in. */
  const composeHref = $derived.by(() => {
    const params = new URLSearchParams();
    if (currentMailboxId) params.set('mailbox', currentMailboxId);
    if (currentFolder) params.set('folder', currentFolder);
    const qs = params.toString();
    return qs ? `/mail/compose?${qs}` : '/mail/compose';
  });

  /** Keep the calendar link scoped to whichever mailbox is currently active. */
  const calendarHref = $derived.by(() => {
    const params = new URLSearchParams();
    if (currentMailboxId) params.set('mailbox', currentMailboxId);
    const qs = params.toString();
    return qs ? `/mail/calendar?${qs}` : '/mail/calendar';
  });
  const isCalendar = $derived(page.url.pathname.startsWith('/mail/calendar'));

  /** Search stays scoped to whatever mailbox and folder are in view. */
  const searchHidden = $derived([
    ...(currentMailboxId ? [{ name: 'mailbox', value: currentMailboxId }] : []),
    ...(currentFolder ? [{ name: 'folder', value: currentFolder }] : []),
  ]);

  const isList = $derived((page.route.id || '') === '/mail');
  const isMailSettings = $derived(page.url.pathname === '/mail/settings');
  const isConnectedApps = $derived(page.url.pathname === '/mail/connected-apps');
  const isRules = $derived(page.url.pathname === '/mail/rules' || page.url.pathname.startsWith('/mail/rules/'));

  const permissionLabel = /** @type {Record<string, string>} */ ({
    read: 'Read only',
    'send-as': 'Send as',
    full: 'Full access',
  });
</script>

<!--
  No shell command bar on the mail surfaces: the list carries its own toolbar
  (select-all plus bulk actions) and the reading pane carries the message
  toolbar, so a second bar above either would only duplicate them.
-->
<AppShell
  appName={d.appName}
  user={d.user}
  mode="mail"
  supportEmail={d.supportEmail}
  search={{ action: '/mail', value: searchTerm, placeholder: 'Search mail', hidden: searchHidden }}
>
  {#snippet nav()}
    <div class="nav-pane-top">
      <a href={composeHref} class="btn btn-primary btn-block">
        <Icon name="compose" size={16} /> New message
      </a>
      {#if d.mailboxes && d.mailboxes.length > 0}
        <label class="sr-only" for="mailbox-picker">Mailbox</label>
        <select
          id="mailbox-picker"
          class="mailbox-picker"
          value={currentMailboxId}
          aria-label="Mailbox"
          onchange={(event) => { void goto(mailboxHref(event.currentTarget.value)); }}
        >
          <option value="">All mailboxes</option>
          {#each d.mailboxes as mb}
            <option value={mb.id}>{mb.type === 'shared' ? 'Shared — ' : ''}{mb.display_name || mb.address} ({permissionLabel[mb.permissions] || mb.permissions})</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="nav-scroll">
      <div class="nav-group">
        <p class="nav-heading" id="nav-folders">Folders</p>
        <nav class="nav-list" aria-labelledby="nav-folders">
          {#each folders as folder}
            <a
              href={folderHref(folder.slug)}
              class="nav-item"
              class:unread={folder.slug === '' && scopedUnread > 0}
              aria-current={isList && currentFolder === folder.slug ? 'page' : undefined}
            >
              <span class="nav-icon"><Icon name={folder.icon} size={16} /></span>
              <span class="nav-label">{folder.name}</span>
              {#if folder.slug === '' && scopedUnread > 0}
                <span class="count count-active">{scopedUnread}</span>
              {/if}
            </a>
          {/each}
        </nav>
      </div>

      <div class="nav-group">
        <p class="nav-heading" id="nav-calendar">Calendar</p>
        <nav class="nav-list" aria-labelledby="nav-calendar">
          <a href={calendarHref} class="nav-item" aria-current={isCalendar ? 'page' : undefined}>
            <span class="nav-icon"><Icon name="calendar" size={16} /></span>
            <span class="nav-label">Meetings</span>
          </a>
        </nav>
      </div>

      {#if d.mailboxes && d.mailboxes.length > 0}
        <div class="nav-group">
          <p class="nav-heading" id="nav-mailboxes">Mailboxes</p>
          <nav class="nav-list" aria-labelledby="nav-mailboxes">
            <a href={mailboxHref('')} class="nav-item" aria-current={!isMailSettings && !isRules && !currentMailboxId ? 'page' : undefined}>
              <span class="nav-icon"><Icon name="mailMultiple" size={16} /></span>
              <span class="nav-label">All mailboxes</span>
              {#if d.totalUnread > 0}<span class="count">{d.totalUnread}</span>{/if}
            </a>
          </nav>
        </div>

        {#if personalMailboxes.length > 0}
          <div class="nav-group">
            <p class="nav-heading" id="nav-personal">Personal</p>
            <nav class="nav-list nav-sub" aria-labelledby="nav-personal">
              {#each personalMailboxes as mb}
                <a
                  href={mailboxHref(mb.id)}
                  class="nav-item"
                  aria-current={!isMailSettings && !isRules && currentMailboxId === mb.id ? 'page' : undefined}
                  title="{mb.address} — {permissionLabel[mb.permissions] || mb.permissions}"
                >
                  <span class="nav-icon"><Icon name="mail" size={16} /></span>
                  <span class="nav-label">{mb.display_name || mb.address}</span>
                  {#if mb.unread_count > 0}<span class="count">{mb.unread_count}</span>{/if}
                </a>
              {/each}
            </nav>
          </div>
        {/if}

        {#if sharedMailboxes.length > 0}
          <div class="nav-group">
            <p class="nav-heading" id="nav-shared">Shared</p>
            <nav class="nav-list nav-sub" aria-labelledby="nav-shared">
              {#each sharedMailboxes as mb}
                <a
                  href={mailboxHref(mb.id)}
                  class="nav-item"
                  aria-current={!isMailSettings && !isRules && currentMailboxId === mb.id ? 'page' : undefined}
                  title="{mb.address} — {permissionLabel[mb.permissions] || mb.permissions}"
                >
                  <span class="nav-icon"><Icon name="people" size={16} /></span>
                  <span class="nav-label">{mb.display_name || mb.address}</span>
                  {#if mb.unread_count > 0}<span class="count">{mb.unread_count}</span>{/if}
                </a>
              {/each}
            </nav>
          </div>
        {/if}
      {/if}

      <div class="nav-group">
        <p class="nav-heading" id="nav-mail-settings">Settings</p>
        <nav class="nav-list" aria-labelledby="nav-mail-settings">
          <a
            href="/mail/settings"
            class="nav-item"
            aria-current={isMailSettings ? 'page' : undefined}
          >
            <span class="nav-icon"><Icon name="compose" size={16} /></span>
            <span class="nav-label">Font and signature</span>
          </a>
          <a
            href="/mail/rules"
            class="nav-item"
            aria-current={isRules ? 'page' : undefined}
          >
            <span class="nav-icon"><Icon name="filter" size={16} /></span>
            <span class="nav-label">Rules</span>
          </a>
          <a
            href="/mail/connected-apps"
            class="nav-item"
            aria-current={isConnectedApps ? 'page' : undefined}
          >
            <span class="nav-icon"><Icon name="key" size={16} /></span>
            <span class="nav-label">Connected AI apps</span>
          </a>
        </nav>
      </div>
    </div>

    <div class="nav-pane-bottom">
      {#if d.pushPublicKey}
        <PushNotifications publicKey={d.pushPublicKey} />
      {/if}
      <div class="identity">
        <Persona name={d.user?.display_name} email={d.user?.email} size="sm" />
        <div class="identity-text">
          <div class="identity-name">{d.user?.display_name || d.user?.email}</div>
          <div class="identity-mail">{d.user?.email}</div>
        </div>
      </div>
      <nav class="nav-footer-links" aria-label="Account and product help">
        <a href="/help">Help centre</a>
        <a href="/help/shared-mailboxes">Shared mailboxes</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        {#if d.supportEmail}<a href={`mailto:${d.supportEmail}`}>Support</a>{/if}
      </nav>
      <span class="product-credit">
        Enterprise-grade email, simplified for small and dispersed organisations.
      </span>
      <span class="product-meta">
        <a href="/help/standards">Standards &amp; assurance</a> · MIT open source
      </span>
    </div>
  {/snippet}

  {@render children()}
</AppShell>

{#if isList}
  <!-- Phones: New message is otherwise only inside the closed drawer. -->
  <a href={composeHref} class="compose-fab" aria-label="New message">
    <Icon name="compose" size={22} />
  </a>
{/if}

{#if d.user?.id}
  <WelcomeGuide
    appName={d.appName || 'cmail'}
    orgName={d.orgName || ''}
    userId={d.user.id}
    isManager={d.user.role === 'manager'}
  />
{/if}
<Toast message={toastMessage} onDismiss={() => { toastMessage = ''; }} />

<style>
  .mailbox-picker { width: 100%; min-height: 38px; margin-top: 8px; }
  @media (pointer: coarse), (max-width: 860px) { .mailbox-picker { min-height: 44px; } }
  .compose-fab { display: none; }
  @media (max-width: 860px) {
    .compose-fab {
      position: fixed;
      right: max(16px, env(safe-area-inset-right));
      bottom: max(16px, calc(env(safe-area-inset-bottom) + 8px));
      z-index: 50;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: var(--primary);
      color: var(--on-primary);
      box-shadow: var(--shadow-16);
      text-decoration: none;
    }
    .compose-fab:hover { background: var(--primary-hover); color: var(--on-primary); text-decoration: none; }
    :global(.has-install-banner) .compose-fab { bottom: calc(max(16px, env(safe-area-inset-bottom)) + 76px); }
    /* Keep the last message clear of the button. */
    :global(.mail-page) { padding-bottom: 72px; }
  }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
