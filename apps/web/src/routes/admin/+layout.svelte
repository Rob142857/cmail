<script lang="ts">
  import { page } from '$app/state';
  import AppShell from '#lib/ui/AppShell.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import SourceUpdates from '#lib/ui/SourceUpdates.svelte';

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
  <a href="/help/managers" class="cmd" aria-label="Manager handbook"><span class="cmd-icon"><Icon name="help" /></span><span class="cmd-label">Manager handbook</span></a>
  <a href="/help/standards" class="cmd" aria-label="Standards &amp; assurance"><span class="cmd-icon"><Icon name="shieldCheck" /></span><span class="cmd-label">Standards &amp; assurance</span></a>
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
      <SourceUpdates supportEmail={data.updateSupportEmail || page.data?.supportEmail || ''} />
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

  <!-- display: contents — a styling hook only; it adds no box to the layout. -->
  <div class="mgmt nb-quiet">{@render children()}</div>
</AppShell>

<style>
  .workspace-badge {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
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
  .crumb { display: inline-flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; font-size: 13px; color: var(--text-muted); }
  .crumb > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumb :global(svg) { flex: 0 0 auto; }
  .crumb strong { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumb :global(svg) { color: var(--text-faint); }

  /* Sleek uplift (management): one light layer shared by every management
     page — white canvas, typed-on-line fields, hairline cards and quiet
     tables. Page styles keep layout; this layer sets the surface. */
  .mgmt { display: contents; }
  :global(.content:has(.mgmt)) { background: var(--bg-surface); }

  .mgmt :global(:is(input:not([type='checkbox'], [type='radio'], [type='file'], [type='color'], [type='range']), select, textarea)) {
    border: 0;
    border-bottom: 1px solid var(--border-strong);
    border-radius: 0;
    background-color: transparent;
    padding-left: 2px;
    box-shadow: none;
  }
  .mgmt :global(textarea) { border: 1px solid var(--border-strong); border-radius: var(--radius); padding-left: 10px; }
  .mgmt :global(:is(input, select, textarea):hover:not(:disabled)) { border-color: var(--text-muted); }
  .mgmt :global(:is(input, select, textarea):focus) {
    border-color: var(--primary);
    box-shadow: 0 1px 0 var(--primary);
    padding-bottom: 5px;
  }
  .mgmt :global(:is(input, select, textarea):disabled) { background-color: transparent; border-color: var(--divider); }

  .mgmt :global(:is(.field > label, .field > .field-label)) { font-size: 13px; font-weight: 400; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
  /* Some page headers reuse the global .page-heading title class; keep their
     intro text at body size (the h1 inside sets its own size). */
  .mgmt :global(.page-heading:not(h1, h2)) { font-size: var(--fs-body); font-weight: 400; }
  .mgmt :global(.eyebrow) { color: var(--text-muted); font-size: 13px; font-weight: 400; letter-spacing: 0; text-transform: none; }

  .mgmt :global(.card) { box-shadow: none; border-color: var(--divider); }
  .mgmt :global(.card.empty-state) { border: 0; background: none; }
  .mgmt :global(fieldset) { border: 0; border-radius: 0; padding: 0; margin: 0; box-shadow: none; background: none; }
  .mgmt :global(legend) { padding: 0; margin-bottom: 4px; font-size: 16px; font-weight: 600; }

  .mgmt :global(.table-wrap) { box-shadow: none; border-color: var(--divider); }
  /* Tables sit straight on the canvas; they still scroll sideways in place. */
  .mgmt :global(.table-card) { padding: 0; border: 0; border-radius: 0; background: none; }
  .mgmt :global(th) {
    background: transparent;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .mgmt :global(td) { border-bottom: 1px solid var(--divider); }
  .mgmt :global(tbody tr:last-child td) { border-bottom: 0; }
  .mgmt :global(tbody tr:hover) { background: var(--bg-subtle); }
  .mgmt :global(td .btn:not(.btn-primary, .btn-danger)) { border-color: transparent; background: transparent; }
  .mgmt :global(td .btn:not(.btn-primary, .btn-danger, :disabled):hover) { background: var(--bg-hover); }
</style>
