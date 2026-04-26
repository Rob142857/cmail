<script>
  let { data } = $props();

  function formatDateTime(dateStr) {
    return new Date(dateStr).toLocaleString();
  }

  function parseAddresses(json) {
    try { return JSON.parse(json); } catch { return []; }
  }

  /** @type {string} */
  const folder = $derived(data.message.folder || 'inbox');
  const isDraft = $derived(folder === 'drafts');
  const toList = $derived(parseAddresses(data.message.to_addresses).join(', '));
  const ccList = $derived(parseAddresses(data.message.cc_addresses).join(', '));
</script>

<div>
  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
    <a href="/mail{isDraft ? '?folder=drafts' : ''}" class="btn">← Back</a>

    {#if isDraft}
      <a href="/mail/compose?draft={data.message.id}" class="btn btn-primary">✎ Edit</a>
      <form method="POST" action="/mail/compose?/send" style="display: inline;">
        <input type="hidden" name="from" value={data.message.from_address} />
        <input type="hidden" name="to" value={toList} />
        <input type="hidden" name="cc" value={ccList} />
        <input type="hidden" name="subject" value={data.message.subject} />
        <input type="hidden" name="body" value={data.body} />
        <input type="hidden" name="draft_id" value={data.message.id} />
        <button type="submit" class="btn">⮕ Send now</button>
      </form>
      <form method="POST" action="/mail/compose?/discard" style="display: inline;">
        <input type="hidden" name="draft_id" value={data.message.id} />
        <button type="submit" class="btn btn-ghost-danger" onclick={(e) => { if (!confirm('Delete this draft?')) e.preventDefault(); }}>🗑 Delete draft</button>
      </form>
    {:else}
      <a href="/mail/compose?reply={data.message.id}" class="btn btn-primary">↩ Reply</a>
      <a href="/mail/compose?forward={data.message.id}" class="btn">⤳ Forward</a>
    {/if}
  </div>

  <div class="card">
    <h2 style="margin-bottom: 12px;">{data.message.subject || '(no subject)'}</h2>

    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px;">
      <div><strong>From:</strong> {data.message.from_address}</div>
      <div><strong>To:</strong> {toList}</div>
      {#if ccList}
        <div><strong>Cc:</strong> {ccList}</div>
      {/if}
      <div><strong>Date:</strong> {formatDateTime(data.message.received_at)}</div>
      {#if isDraft}
        <div style="margin-top: 4px; padding: 6px 10px; background: var(--primary-soft); color: var(--primary); border-radius: 6px; font-size: 12px; font-weight: 500; display: inline-block; align-self: flex-start;">Draft — not yet sent</div>
      {/if}
    </div>

    {#if data.attachments.length > 0}
      <div style="margin-bottom: 16px; padding: 8px; background: var(--bg-hover); border-radius: var(--radius);">
        <strong style="font-size: 12px;">📎 Attachments:</strong>
        {#each data.attachments as att}
          <a href="/api/attachment/{att.id}" style="display: inline-block; margin: 4px 8px; font-size: 13px;">
            {att.filename} ({(att.size_bytes / 1024).toFixed(1)} KB)
          </a>
        {/each}
      </div>
    {/if}

    <div class="message-body">
      {@html data.body}
    </div>
  </div>
</div>

<style>
  .message-body {
    padding: 16px 0;
    line-height: 1.6;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .message-body :global(img) {
    max-width: 100%;
    height: auto;
  }
  .btn-ghost-danger { background: transparent; border-color: transparent; color: var(--danger); }
  .btn-ghost-danger:hover { background: var(--danger-soft); }
</style>
