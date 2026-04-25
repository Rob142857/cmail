<script>
  import { page } from '$app/state';
  let { data, children } = $props();

  const folders = [
    { name: 'Inbox', slug: '', icon: '📥' },
    { name: 'Sent', slug: 'sent', icon: '📤' },
    { name: 'Drafts', slug: 'drafts', icon: '📝' },
    { name: 'Archive', slug: 'archive', icon: '📁' },
    { name: 'Spam', slug: 'spam', icon: '⚠️' },
    { name: 'Trash', slug: 'trash', icon: '🗑️' },
  ];

  let currentMailbox = $state(data.mailboxes[0]?.id || '');
</script>

<div class="app-layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <img src="/icon.svg" alt="" width="22" height="22" style="vertical-align: middle; margin-right: 6px;" />
      {data.appName || 'cmail'}
    </div>

    <div style="padding: 12px 8px;">
      <a href="/mail/compose" class="btn btn-primary" style="width: 100%; justify-content: center;">
        ✏️ Compose
      </a>
    </div>

    <nav class="sidebar-nav">
      {#each folders as folder}
        {@const href = folder.slug ? `/mail?folder=${folder.slug}` : '/mail'}
        <a {href} class:active={(!page.url.searchParams.get('folder') && !folder.slug) || page.url.searchParams.get('folder') === folder.slug}>
          <span>{folder.icon}</span>
          <span>{folder.name}</span>
        </a>
      {/each}
    </nav>

    {#if data.mailboxes.length > 0}
      <div class="sidebar-section">Mailboxes</div>
      <nav class="sidebar-nav">
        {#each data.mailboxes as mb}
          <a href="/mail?mailbox={mb.id}" class:active={page.url.searchParams.get('mailbox') === mb.id}>
            <span>{mb.type === 'shared' ? '👥' : '👤'}</span>
            <span>{mb.display_name || mb.address}</span>
            {#if mb.unread_count > 0}
              <span class="badge badge-info">{mb.unread_count}</span>
            {/if}
          </a>
        {/each}
      </nav>
    {/if}

    <div style="margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--border); font-size: 13px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span>{data.user?.display_name || data.user?.email}</span>
        <form method="POST" action="/auth/logout">
          <button type="submit" style="padding: 4px 8px; font-size: 12px;">Sign out</button>
        </form>
      </div>
      {#if data.user?.role === 'manager'}
        <a href="/admin" style="font-size: 12px; margin-top: 4px; display: block;">⚙️ Admin Dashboard</a>
      {/if}
    </div>
  </aside>

  <main class="main-content">
    {@render children()}
  </main>
</div>
