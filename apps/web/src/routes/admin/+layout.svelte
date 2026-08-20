<script lang="ts">
  import { page } from '$app/state';
  import AppShell from '$lib/ui/AppShell.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  type NavItem = { href: string; label: string; description: string; icon: string; count?: number };
  type NavGroup = { label: string; items: NavItem[] };

  let { data, children } = $props();

  const groups: NavGroup[] = $derived([
    {
      label: 'Workspace',
      items: [
        { href: '/admin', label: 'Overview', description: 'Health and activity', icon: 'home' },
      ],
    },
    {
      label: 'Identity & organisation',
      items: [
        { href: '/admin/users', label: 'People', description: 'Accounts and access', icon: 'people' },
        { href: '/admin/orgchart', label: 'Organisation', description: 'Units, roles and directory', icon: 'orgChart' },
        { href: '/admin/travel', label: 'Travel approvals', description: 'Temporary overseas sign-in', icon: 'globe', count: data.pendingTravelCount || undefined },
      ],
    },
    {
      label: 'Mail',
      items: [
        { href: '/admin/mailboxes', label: 'Mailboxes', description: 'Addresses and permissions', icon: 'mailMultiple' },
        { href: '/admin/signatures', label: 'Signatures', description: 'Personal and organisation', icon: 'compose' },
        { href: '/admin/trace', label: 'Mail trace', description: 'Delivery diagnostics', icon: 'activity' },
        { href: '/admin/quarantine', label: 'Quarantine', description: 'Spam review and sender rules', icon: 'junk' },
      ],
    },
    {
      label: 'Governance',
      items: [
        { href: '/admin/policy', label: 'Usage policy', description: 'Versions and acceptance', icon: 'shieldCheck' },
        { href: '/admin/audit', label: 'Audit log', description: 'Administrative events', icon: 'clipboard' },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { href: '/admin/settings', label: 'Settings', description: 'Brand and system mail', icon: 'settings' },
      ],
    },
  ]);

  // Pages that are reachable but deliberately not in the rail — they still need
  // to resolve a breadcrumb and a document title.
  const unlisted: NavItem[] = [
    { href: '/admin/investigate', label: 'Investigate', description: 'Trace and audit timeline', icon: 'activity' },
  ];

  const allItems = $derived(groups.flatMap((group) => group.items));
  const currentPath = $derived(page.url.pathname);
  const currentItem = $derived(
    [...unlisted, ...allItems].find((item) => (item.href === '/admin'
      ? currentPath === '/admin'
      : currentPath.startsWith(item.href))) ?? allItems[0],
  );

  function isActive(href: string): boolean {
    return href === '/admin' ? currentPath === href : currentPath.startsWith(href);
  }

  function navId(label: string): string {
    return 'nav-' + label.replaceAll('&', 'and').replaceAll(' ', '-').toLowerCase();
  }
</script>

<svelte:head>
  <title>{currentItem.label} · Management · {page.data?.appName || 'cmail'}</title>
</svelte:head>

{#snippet crumbBar()}
  <span class="crumb">
    <span>Management</span>
    <Icon name="chevronRight" size={13} />
    <strong>{currentItem.label}</strong>
  </span>
  <span class="cmd-spacer"></span>
  <a href="/help/managers" class="cmd"><span class="cmd-icon"><Icon name="help" /></span>Manager handbook</a>
  <a href="/help/standards" class="cmd"><span class="cmd-icon"><Icon name="shieldCheck" /></span>Standards &amp; assurance</a>
{/snippet}

<AppShell
  appName={page.data?.appName || 'cmail'}
  user={data.user}
  mode="admin"
  supportEmail={page.data?.supportEmail || ''}
  navLabel="Management navigation"
  commandBar={crumbBar}
>
  {#snippet nav()}
    <div class="nav-pane-top">
      <div class="workspace-badge">
        <Icon name="shieldCheck" size={15} />
        <span class="workspace-text">
          <strong>Management centre</strong>
          <small>{page.data?.orgName || 'Organisation workspace'}</small>
        </span>
      </div>
    </div>

    <div class="nav-scroll">
      {#each groups as group}
        <div class="nav-group">
          <p class="nav-heading" id={navId(group.label)}>{group.label}</p>
          <nav class="nav-list" aria-labelledby={navId(group.label)}>
            {#each group.items as item}
              <a
                href={item.href}
                class="nav-item nav-item-stacked"
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                <span class="nav-icon"><Icon name={item.icon} size={16} /></span>
                <span class="nav-label">
                  {item.label}
                  <span class="nav-desc">{item.description}</span>
                </span>
                {#if item.count}<span class="count count-active">{item.count}</span>{/if}
              </a>
            {/each}
          </nav>
        </div>
      {/each}
    </div>

    <div class="nav-pane-bottom">
      <a href="/mail" class="nav-item return-link">
        <span class="nav-icon"><Icon name="arrowLeft" size={16} /></span>
        <span class="nav-label">Return to mail</span>
      </a>
      <nav class="nav-footer-links" aria-label="Management help">
        <a href="/admin/investigate">Investigate</a>
        <a href="/help/managers">Manager handbook</a>
        <a href="/help/standards">Standards &amp; assurance</a>
        <a href="/help/shared-mailboxes">Shared mailbox guide</a>
      </nav>
      <span class="product-credit">
        Simple email management for small, distributed organisations.
      </span>
      <span class="product-meta">
        <a href="/help/standards">Standards &amp; assurance</a> · MIT open source
      </span>
    </div>
  {/snippet}

  {@render children()}
</AppShell>

<style>
  .workspace-badge {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-md);
    background: var(--primary-soft);
    color: var(--primary-text);
  }
  .workspace-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
  .workspace-text strong { font-size: 13px; font-weight: 600; }
  .workspace-text small {
    font-size: 10.5px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Each destination carries a one-line description, so the label block is a
     two-row stack rather than a single centred line. */
  .nav-item-stacked { align-items: flex-start; padding-top: 7px; padding-bottom: 7px; }
  .nav-item-stacked .nav-icon { margin-top: 2px; }
  .nav-item-stacked .nav-label { white-space: normal; }

  .return-link { color: var(--text-muted); }
  .crumb { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--text-muted); }
  .crumb strong { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumb :global(svg) { color: var(--text-faint); }
</style>
