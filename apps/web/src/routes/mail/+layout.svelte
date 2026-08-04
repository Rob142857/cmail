<script>
  import { page } from '$app/state';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { browser } from '$app/environment';
  import AppShell from '$lib/ui/AppShell.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Persona from '$lib/ui/Persona.svelte';
  import PushNotifications from '$lib/PushNotifications.svelte';
  import Toast from '$lib/Toast.svelte';
  import WelcomeGuide from '$lib/WelcomeGuide.svelte';

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
      replaceState(page.url, nextState);
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

  /** Search stays scoped to whatever mailbox and folder are in view. */
  const searchHidden = $derived([
    ...(currentMailboxId ? [{ name: 'mailbox', value: currentMailboxId }] : []),
    ...(currentFolder ? [{ name: 'folder', value: currentFolder }] : []),
  ]);

  const isList = $derived((page.route.id || '') === '/mail');

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
      <a href="/mail/compose" class="btn btn-primary btn-block">
        <Icon name="compose" size={16} /> New message
      </a>
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

      {#if d.mailboxes && d.mailboxes.length > 0}
        <div class="nav-group">
          <p class="nav-heading" id="nav-mailboxes">Mailboxes</p>
          <nav class="nav-list" aria-labelledby="nav-mailboxes">
            <a href={mailboxHref('')} class="nav-item" aria-current={!currentMailboxId ? 'page' : undefined}>
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
                  aria-current={currentMailboxId === mb.id ? 'page' : undefined}
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
                  aria-current={currentMailboxId === mb.id ? 'page' : undefined}
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
    </div>

    <div class="nav-pane-bottom">
      {#if d.pushPublicKey}
        <PushNotifications publicKey={d.pushPublicKey} appName={d.appName || 'cmail'} />
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
        {#if d.supportEmail}<a href={`mailto:${d.supportEmail}`}>Support</a>{/if}
      </nav>
      <span class="product-credit">
        Enterprise-grade email management, simplified for small organisations and for
        geographically and managerially dispersed groups.
      </span>
      <span class="product-meta">
        <a href="/help/standards">Compliant email</a> · MIT open source
      </span>
    </div>
  {/snippet}

  {@render children()}
</AppShell>

{#if d.user?.id}
  <WelcomeGuide
    appName={d.appName || 'cmail'}
    orgName={d.orgName || ''}
    userId={d.user.id}
    isManager={d.user.role === 'manager'}
  />
{/if}
<Toast message={toastMessage} onDismiss={() => { toastMessage = ''; }} />
