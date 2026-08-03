<script lang="ts">
  import { page } from '$app/state';
  import AdminIcon from '$lib/AdminIcon.svelte';

  type IconName = 'home' | 'people' | 'mail' | 'org' | 'policy' | 'audit' | 'trace' | 'settings';
  type NavItem = { href: string; label: string; description: string; icon: IconName };
  type NavGroup = { label: string; items: NavItem[] };

  let { data, children } = $props();
  let mobileNavOpen = $state(false);

  const groups: NavGroup[] = [
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
        { href: '/admin/orgchart', label: 'Organisation', description: 'Units, roles and directory', icon: 'org' },
      ],
    },
    {
      label: 'Mail',
      items: [
        { href: '/admin/mailboxes', label: 'Mailboxes', description: 'Addresses and permissions', icon: 'mail' },
        { href: '/admin/trace', label: 'Mail trace', description: 'Delivery diagnostics', icon: 'trace' },
      ],
    },
    {
      label: 'Governance',
      items: [
        { href: '/admin/policy', label: 'Usage policy', description: 'Versions and acceptance', icon: 'policy' },
        { href: '/admin/audit', label: 'Audit log', description: 'Administrative events', icon: 'audit' },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { href: '/admin/settings', label: 'Settings', description: 'Brand and system mail', icon: 'settings' },
      ],
    },
  ];

  const allItems = groups.flatMap((group) => group.items);
  const currentPath = $derived(page.url.pathname);
  const currentItem = $derived(
    allItems.find((item) => item.href === '/admin'
      ? currentPath === '/admin'
      : currentPath.startsWith(item.href)) ?? allItems[0],
  );

  function isActive(href: string): boolean {
    return href === '/admin' ? currentPath === href : currentPath.startsWith(href);
  }

  function navId(label: string): string {
    return 'nav-' + label.replaceAll('&', 'and').replaceAll(' ', '-').toLowerCase();
  }

  function handleMobileNavKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !mobileNavOpen) return;
    event.preventDefault();
    mobileNavOpen = false;
    (event.currentTarget as HTMLElement).focus();
  }
</script>

<svelte:head>
  <title>{currentItem.label} · Management · {page.data?.appName || 'cmail'}</title>
</svelte:head>

<div class="management-shell">
  <aside class="management-rail" aria-label="Management navigation">
    <div class="rail-brand">
      <span class="brand-mark" aria-hidden="true">M</span>
      <div>
        <strong>Management</strong>
        <span>{page.data?.orgName || 'Organisation workspace'}</span>
      </div>
    </div>

    <nav>
      {#each groups as group}
        <section class="nav-group" aria-labelledby={navId(group.label)}>
          <h2 id={navId(group.label)}>{group.label}</h2>
          {#each group.items as item}
            <a href={item.href} class:active={isActive(item.href)} aria-current={isActive(item.href) ? 'page' : undefined}>
              <AdminIcon name={item.icon} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </a>
          {/each}
        </section>
      {/each}
    </nav>

    <div class="rail-footer">
      <a href="/mail"><AdminIcon name="back" size={17} /> Return to mail</a>
      <nav class="rail-help" aria-label="Management help">
        <a href="/help/managers">Manager handbook</a>
        <a href="/help/shared-mailboxes">Shared mailbox guide</a>
      </nav>
      <div class="account" title={data.user?.email || ''}>
        <span class="avatar" aria-hidden="true">{(data.user?.display_name || data.user?.email || 'M').slice(0, 1).toUpperCase()}</span>
        <span>
          <strong>{data.user?.display_name || 'Manager'}</strong>
          <small>{data.user?.email || ''}</small>
        </span>
      </div>
      <span class="product-credit">cmail · Exchange-style shared mailbox workflows · MIT open source</span>
    </div>
  </aside>

  <div class="management-main">
    <header class="management-topbar">
      <details class="mobile-nav" bind:open={mobileNavOpen}>
        <summary
          aria-label={`${mobileNavOpen ? 'Close' : 'Open'} management navigation`}
          aria-controls="management-mobile-menu"
          aria-expanded={mobileNavOpen}
          onkeydown={handleMobileNavKeydown}
        >
          <AdminIcon name="menu" />
          <span>{mobileNavOpen ? 'Close' : 'Menu'}</span>
        </summary>
        <nav id="management-mobile-menu" class="mobile-nav-panel" aria-label="Management sections">
          {#each groups as group}
            <div class="mobile-nav-group" role="group" aria-labelledby={`mobile-${navId(group.label)}`}>
              <p id={`mobile-${navId(group.label)}`}>{group.label}</p>
              {#each group.items as item}
                <a
                  href={item.href}
                  class:active={isActive(item.href)}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  onclick={() => { mobileNavOpen = false; }}
                >
                  <AdminIcon name={item.icon} size={17} />
                  {item.label}
                </a>
              {/each}
            </div>
          {/each}
          <a href="/mail" class="mail-link" onclick={() => { mobileNavOpen = false; }}><AdminIcon name="back" size={17} /> Return to mail</a>
        </nav>
      </details>

      <div class="crumb">
        <span>Management</span>
        <span aria-hidden="true">/</span>
        <strong>{currentItem.label}</strong>
      </div>
      <a class="topbar-mail" href="/mail"><AdminIcon name="back" size={17} /> Mail</a>
    </header>

    <main id="main-content" class="management-content" tabindex="-1">
      {@render children()}
    </main>
    <footer class="management-footer">
      <span>cmail · Exchange-style shared mailbox administration · MIT open source · independent and not affiliated with Microsoft</span>
      <nav aria-label="Product help"><a href="/help/managers">Manager handbook</a><a href="/help">Help centre</a></nav>
    </footer>
  </div>
</div>

<style>
  .management-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 244px minmax(0, 1fr);
    background: var(--bg);
  }
  .management-rail {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg-surface);
  }
  .rail-brand {
    display: flex;
    align-items: center;
    gap: 11px;
    min-height: 72px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .rail-brand div, .account > span:last-child { min-width: 0; display: flex; flex-direction: column; }
  .rail-brand strong { font-size: 15px; }
  .rail-brand span:not(.brand-mark), .account small {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .brand-mark, .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 15px;
    font-weight: 750;
  }
  .management-rail nav { flex: 1; padding: 8px; }
  .nav-group { margin: 0 0 11px; }
  .nav-group h2, .mobile-nav-panel p {
    margin: 0;
    padding: 7px 10px 5px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .07em;
    text-transform: uppercase;
  }
  .nav-group a {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    min-height: 44px;
    padding: 6px 9px;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
  }
  .nav-group a:hover { background: var(--bg-hover); }
  .nav-group a.active {
    background: var(--primary-soft);
    color: var(--primary);
    box-shadow: inset 3px 0 var(--primary);
  }
  .nav-group a span { min-width: 0; display: flex; flex-direction: column; }
  .nav-group a strong { font-size: 13px; font-weight: 600; }
  .nav-group a small { color: var(--text-muted); font-size: 10px; }
  .rail-footer { padding: 8px; border-top: 1px solid var(--border); }
  .rail-footer > a {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 8px 9px;
    color: var(--text-muted);
    font-size: 13px;
    text-decoration: none;
  }
  .rail-footer > a:hover { color: var(--text); }
  .rail-help { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 4px 9px 8px; }
  .rail-help a { color: var(--text-muted); font-size: 10px; }
  .product-credit { display: block; padding: 7px 9px 2px; color: var(--text-faint); font-size: 9px; letter-spacing: .02em; }
  .account {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    margin-top: 4px;
    padding: 9px;
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .avatar { width: 30px; height: 30px; border-radius: 50%; font-size: 12px; }
  .account strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .management-main { min-width: 0; }
  .management-topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    min-height: 56px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 24px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    backdrop-filter: blur(12px);
  }
  .crumb { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
  .crumb span { color: var(--text-muted); }
  .crumb strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topbar-mail {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 13px;
    text-decoration: none;
  }
  .topbar-mail:hover { color: var(--text); }
  .management-content { width: min(100%, 1480px); margin: 0 auto; padding: 26px 28px 48px; }
  .management-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 18px; width: min(100%, 1480px); margin: 0 auto; padding: 18px 28px 24px; border-top: 1px solid var(--border); color: var(--text-faint); font-size: 10px; }
  .management-footer nav { display: flex; gap: 12px; }
  .management-footer a { color: var(--text-muted); }
  .mobile-nav { display: none; position: relative; }
  .mobile-nav summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 40px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-surface);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }
  .mobile-nav summary::-webkit-details-marker { display: none; }
  .mobile-nav-panel {
    position: absolute;
    z-index: 40;
    top: calc(100% + 8px);
    left: 0;
    width: min(330px, calc(100vw - 28px));
    max-height: calc(100vh - 84px);
    overflow-y: auto;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-lg);
  }
  .mobile-nav-panel a {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 42px;
    padding: 8px 10px;
    border-radius: var(--radius);
    color: var(--text);
    font-size: 14px;
    text-decoration: none;
  }
  .mobile-nav-panel a:hover { background: var(--bg-hover); }
  .mobile-nav-panel a.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
  .mobile-nav-panel .mail-link { margin-top: 8px; border-top: 1px solid var(--border); border-radius: 0; color: var(--text-muted); }
  @media (max-width: 900px) {
    .management-shell { display: block; }
    .management-rail { display: none; }
    .mobile-nav { display: block; }
    .management-topbar { padding: 8px 14px; }
    .management-content { padding: 20px 16px 36px; }
    .management-footer { padding: 16px; }
  }
  @media (max-width: 560px) {
    .crumb span:first-child, .crumb span:nth-child(2), .topbar-mail { display: none; }
    .management-content { padding: 16px 12px 30px; }
    .management-footer { align-items: flex-start; flex-direction: column; padding: 14px 12px 20px; }
  }
</style>
