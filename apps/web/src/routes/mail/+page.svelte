<script>
  let { data } = $props();
  /** @type {any} */
  const d = $derived(data);

  /** @param {string} dateStr */
  function formatDate(dateStr) {
    const dt = new Date(dateStr);
    const now = new Date();
    if (dt.toDateString() === now.toDateString()) {
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /** @param {string} address */
  function extractName(address) {
    const match = address.match(/^(.+?)\s*<.+>$/);
    return match ? match[1].trim() : address.split('@')[0];
  }

  /** @param {string} addr */
  function shortMailboxLabel(addr) {
    return addr ? addr.split('@')[0] : '';
  }

  const folderLabels = { '': 'Inbox', inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', archive: 'Archive', spam: 'Spam', trash: 'Trash' };
  /** @type {string} */
  const folderLabel = $derived(folderLabels[d.folder] || d.folder);
  const showMailboxColumn = $derived(!d.mailboxId);
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; flex-wrap: wrap;">
    <div>
      <h2 style="font-size: 20px; margin: 0;">
        {#if d.search}
          Search: “{d.search}”
        {:else}
          {folderLabel}
          {#if d.currentMailbox}
            <span style="color: var(--text-muted); font-weight: normal; font-size: 14px;">
              — {d.currentMailbox.display_name || d.currentMailbox.address}
              <span style="font-family: monospace; font-size: 12px;">&lt;{d.currentMailbox.address}&gt;</span>
            </span>
          {:else}
            <span style="color: var(--text-muted); font-weight: normal; font-size: 14px;">— all mailboxes</span>
          {/if}
        {/if}
      </h2>
    </div>
    <form method="GET" style="display: flex; gap: 8px;">
      {#if d.mailboxId}
        <input type="hidden" name="mailbox" value={d.mailboxId} />
      {/if}
      {#if d.folder && d.folder !== 'inbox'}
        <input type="hidden" name="folder" value={d.folder} />
      {/if}
      <input type="search" name="q" placeholder="Search mail…" value={d.search} style="width: 280px;" />
      <button type="submit">Search</button>
    </form>
  </div>

  {#if d.messages.length === 0}
    <div class="card" style="text-align: center; padding: 48px; color: var(--text-muted);">
      {d.search ? 'No messages match your search.' : 'No messages in this folder.'}
    </div>
  {:else}
    <div class="message-list card" style="padding: 0; overflow: hidden;">
      {#each d.messages as message}
        <a href="/mail/{message.id}" class="message-row" class:unread={!message.is_read} class:with-mb={showMailboxColumn}>
          {#if showMailboxColumn}
            <span class="mb-tag" title={message.mailbox_address}>{shortMailboxLabel(message.mailbox_address)}</span>
          {/if}
          <span class="from">{extractName(message.from_address)}</span>
          <span class="middle">
            <span class="subject">{message.subject}</span>
            {#if message.snippet}
              <span class="snippet"> — {message.snippet}</span>
            {/if}
          </span>
          <span class="date">
            {#if message.has_attachments}📎{/if}
            {formatDate(message.received_at)}
          </span>
        </a>
      {/each}
    </div>
  {/if}

  {#if d.messages.length >= 50 || d.page > 1}
    <div style="display: flex; justify-content: center; margin-top: 16px; gap: 8px;">
      {#if d.page > 1}
        <a href={`?${new URLSearchParams({ ...(d.folder ? { folder: d.folder } : {}), ...(d.mailboxId ? { mailbox: d.mailboxId } : {}), page: String(d.page - 1) }).toString()}`} class="btn">← Newer</a>
      {/if}
      {#if d.messages.length >= 50}
        <a href={`?${new URLSearchParams({ ...(d.folder ? { folder: d.folder } : {}), ...(d.mailboxId ? { mailbox: d.mailboxId } : {}), page: String(d.page + 1) }).toString()}`} class="btn">Older →</a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .message-row {
    display: grid;
    grid-template-columns: 180px 1fr auto;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    align-items: center;
  }
  .message-row.with-mb {
    grid-template-columns: 100px 180px 1fr auto;
  }
  .message-row:hover { background: var(--bg-hover); }
  .message-row.unread { font-weight: 600; }
  .message-row:last-child { border-bottom: none; }
  .mb-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-muted);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-weight: 500;
  }
  .middle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .snippet { color: var(--text-muted); font-weight: 400; }
</style>
