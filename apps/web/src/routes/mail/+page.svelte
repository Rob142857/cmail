<script>
  let { data } = $props();

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function extractName(address) {
    const match = address.match(/^(.+?)\s*<.+>$/);
    return match ? match[1].trim() : address.split('@')[0];
  }
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2 style="text-transform: capitalize; font-size: 20px;">
      {data.search ? `Search: "${data.search}"` : data.folder}
    </h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <input type="search" name="q" placeholder="Search mail..." value={data.search} style="width: 280px;" />
      <button type="submit">Search</button>
    </form>
  </div>

  {#if data.messages.length === 0}
    <div class="card" style="text-align: center; padding: 48px; color: var(--text-muted);">
      {data.search ? 'No messages match your search.' : 'No messages in this folder.'}
    </div>
  {:else}
    <div class="message-list card" style="padding: 0; overflow: hidden;">
      {#each data.messages as message}
        <a href="/mail/{message.id}" class="message-row" class:unread={!message.is_read}>
          <span class="from">{extractName(message.from_address)}</span>
          <span>
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

  {#if data.messages.length >= 50}
    <div style="display: flex; justify-content: center; margin-top: 16px; gap: 8px;">
      {#if data.page > 1}
        <a href="?folder={data.folder}&page={data.page - 1}" class="btn">← Newer</a>
      {/if}
      <a href="?folder={data.folder}&page={data.page + 1}" class="btn">Older →</a>
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
  .message-row:hover { background: var(--bg-hover); }
  .message-row.unread { font-weight: 600; }
  .message-row:last-child { border-bottom: none; }
</style>
