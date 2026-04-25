<script>
  let { data } = $props();

  function formatDateTime(dateStr) {
    return new Date(dateStr).toLocaleString();
  }

  function parseAddresses(json) {
    try { return JSON.parse(json); } catch { return []; }
  }
</script>

<div>
  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
    <a href="/mail" class="btn">← Back</a>
    <a href="/mail/compose?reply={data.message.id}" class="btn btn-primary">↩ Reply</a>
    <a href="/mail/compose?forward={data.message.id}" class="btn">⤳ Forward</a>
  </div>

  <div class="card">
    <h2 style="margin-bottom: 12px;">{data.message.subject}</h2>

    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px;">
      <div><strong>From:</strong> {data.message.from_address}</div>
      <div><strong>To:</strong> {parseAddresses(data.message.to_addresses).join(', ')}</div>
      {#if parseAddresses(data.message.cc_addresses).length > 0}
        <div><strong>Cc:</strong> {parseAddresses(data.message.cc_addresses).join(', ')}</div>
      {/if}
      <div><strong>Date:</strong> {formatDateTime(data.message.received_at)}</div>
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
</style>
