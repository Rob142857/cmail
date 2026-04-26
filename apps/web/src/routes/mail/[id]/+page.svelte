<script>
  import { formatDateTime } from '$lib/dates';
  let { data } = $props();

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

    <!--
      Email HTML is rendered inside a fully-sandboxed iframe with a strict CSP:
      no scripts, no plugins, no forms, no same-origin access, no remote subresources
      except images. This neutralises the XSS attack surface from inbound HTML.
    -->
    <iframe
      class="message-body"
      title="Email content"
      sandbox=""
      referrerpolicy="no-referrer"
      srcdoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none';"><base target="_blank"><style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;line-height:1.5;color:#1f2937;background:#ffffff;word-break:break-word;overflow-wrap:break-word;}img{max-width:100%;height:auto;}a{color:#2563eb;}blockquote{margin-left:8px;padding-left:8px;border-left:2px solid #d1d5db;color:#6b7280;}hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0;}</style></head><body>${data.body || ''}</body></html>`}
    ></iframe>
  </div>
</div>

<style>
  .message-body {
    display: block;
    width: 100%;
    min-height: 360px;
    height: 65vh;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #ffffff;
    margin-top: 8px;
  }
  .btn-ghost-danger { background: transparent; border-color: transparent; color: var(--danger); }
  .btn-ghost-danger:hover { background: var(--danger-soft); }
</style>
