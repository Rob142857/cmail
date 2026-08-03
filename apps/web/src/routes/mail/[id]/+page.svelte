<script>
  import { onMount, untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { dateTimeAttribute, formatDateTime } from '$lib/dates';

  let { data } = $props();
  let remoteImages = $state(false);
  let busy = $state('');
  let actionError = $state('');
  let starred = $state(untrack(() => Boolean(data.message.is_starred)));
  let previousMessageId = untrack(() => data.message.id);

  $effect(() => {
    const messageId = data.message.id;
    if (messageId !== previousMessageId) {
      previousMessageId = messageId;
      remoteImages = false;
    }
  });

  function parseAddresses(value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  function includesRemoteImages(value) {
    return typeof value === 'string' && /<img\b[^>]*\bsrc=(?:"|')https:\/\//i.test(value);
  }

  const folder = $derived(data.message.folder || 'inbox');
  const isDraft = $derived(folder === 'drafts');
  const hasFullControl = $derived(data.message.mailbox_permissions === 'full');
  const canMarkUnread = $derived(!['sent', 'trash'].includes(folder));
  const hasRemoteImages = $derived(includesRemoteImages(data.body));
  const toList = $derived(parseAddresses(data.message.to_addresses).join(', '));
  const ccList = $derived(parseAddresses(data.message.cc_addresses).join(', '));
  const mailboxPermission = $derived({
    read: 'Read only',
    'send-as': 'Read and send as',
    full: 'Full access',
  }[data.message.mailbox_permissions] || data.message.mailbox_permissions);
  const returnParams = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.returnFolder) params.set('folder', data.returnFolder);
    if (data.returnMailbox) params.set('mailbox', data.returnMailbox);
    if (data.returnSearch) params.set('q', data.returnSearch);
    if (data.returnPage > 1) params.set('page', String(data.returnPage));
    return params.toString();
  });
  const returnHref = $derived(returnParams ? `/mail?${returnParams}` : '/mail');
  const mailboxHref = $derived.by(() => {
    const params = new URLSearchParams({ mailbox: data.message.mailbox_id });
    if (folder !== 'inbox') params.set('folder', folder);
    return `/mail?${params}`;
  });
  const frameCsp = $derived(remoteImages
    ? "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';");

  function formatAttachmentSize(size) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(0.1, size / 1024).toFixed(1)} KB`;
  }

  async function mutate(action, targetFolder = '') {
    busy = action;
    actionError = '';
    try {
      const response = await fetch(`/api/messages/${data.message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, folder: targetFolder || undefined }),
      });
      if (!response.ok) throw new Error('The message could not be updated');
      if (action === 'star') starred = !starred;
      if (action === 'read') await invalidateAll();
      if (action === 'unread' || action === 'move' || action === 'restore') await goto(returnHref, { invalidateAll: true });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'The message could not be updated';
    } finally {
      busy = '';
    }
  }

  async function removeMessage() {
    const permanent = folder === 'trash';
    if (permanent && !confirm('Permanently delete this message and its attachments? This cannot be undone.')) return;
    busy = 'delete';
    actionError = '';
    try {
      const response = await fetch(`/api/messages/${data.message.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('The message could not be deleted');
      await goto(returnHref, { invalidateAll: true });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'The message could not be deleted';
      busy = '';
    }
  }

  onMount(() => {
    if (!data.message.is_read) void mutate('read');
  });
</script>

<svelte:head><title>{data.message.subject || '(no subject)'} · {data.appName || 'cmail'}</title></svelte:head>

<div>
  <div class="toolbar" role="group" aria-label="Message actions">
    <a href={returnHref} class="btn">← Back</a>

    {#if isDraft}
      <a href="/mail/compose?draft={data.message.id}" class="btn btn-primary">Edit draft</a>
      <form method="POST" action="/mail/compose?/discard">
        <input type="hidden" name="draft_id" value={data.message.id} />
        <button type="submit" class="btn btn-ghost-danger" onclick={(event) => { if (!confirm('Delete this draft?')) event.preventDefault(); }}>Delete draft</button>
      </form>
    {:else}
      <a href="/mail/compose?reply={data.message.id}" class="btn btn-primary">Reply</a>
      <a href="/mail/compose?forward={data.message.id}" class="btn">Forward</a>
      {#if canMarkUnread}
        <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('unread')}>Mark unread</button>
      {/if}
      {#if hasFullControl}
        <button class="btn" type="button" aria-pressed={starred} disabled={!!busy} onclick={() => mutate('star')}>{starred ? 'Unstar' : 'Star'}</button>
        {#if folder === 'inbox'}
          <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('move', 'archive')}>Archive</button>
          <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('move', 'spam')}>Report spam</button>
        {:else if folder === 'archive'}
          <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('move', 'inbox')}>Move to inbox</button>
        {:else if folder === 'spam'}
          <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('move', 'inbox')}>Not spam</button>
        {:else if folder === 'trash'}
          <button class="btn" type="button" disabled={!!busy} onclick={() => mutate('restore')}>Restore</button>
        {/if}
        <button class="btn btn-ghost-danger" type="button" disabled={!!busy} onclick={removeMessage}>{folder === 'trash' ? 'Delete forever' : 'Move to trash'}</button>
      {/if}
    {/if}
  </div>

  {#if actionError}<p class="action-error" role="alert">{actionError}</p>{/if}

  <article class="card">
    <h1>{data.message.subject || '(no subject)'}</h1>
    <dl class="message-meta">
      <div><dt>From</dt><dd>{data.message.from_address}</dd></div>
      <div><dt>To</dt><dd>{toList}</dd></div>
      {#if ccList}<div><dt>Cc</dt><dd>{ccList}</dd></div>{/if}
      <div>
        <dt>Mailbox</dt>
        <dd class="mailbox-context">
          <a href={mailboxHref}>{data.message.mailbox_display_name || data.message.mailbox_address}</a>
          {#if data.message.mailbox_display_name && data.message.mailbox_display_name !== data.message.mailbox_address}
            <span>&lt;{data.message.mailbox_address}&gt;</span>
          {/if}
          <span class="permission-label">{mailboxPermission}</span>
        </dd>
      </div>
      <div>
        <dt>Date</dt>
        <dd><time datetime={dateTimeAttribute(data.message.received_at)}>{formatDateTime(data.message.received_at, data.locale, data.timeZone)}</time></dd>
      </div>
    </dl>

    {#if data.attachments.length > 0}
      <section class="attachments" aria-labelledby="attachments-title">
        <div class="attachment-heading">
          <h2 id="attachments-title">Attachments ({data.attachments.length})</h2>
          <p>cmail does not malware-scan attachments. Only open files you trust.</p>
        </div>
        <div class="attachment-list">
          {#each data.attachments as attachment}
            <a class="attachment" href="/api/attachment/{attachment.id}">
              <span class="attachment-name">{attachment.filename}</span>
              <span>{attachment.content_type || 'Unknown file type'} · {formatAttachmentSize(attachment.size_bytes)}</span>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    {#if !isDraft && !data.bodyUnavailable && data.body && hasRemoteImages}
      <div class="privacy-bar">
        <span>{remoteImages ? 'Remote images are loaded. They can tell the sender that you opened this message.' : 'Remote images are blocked because loading them can tell the sender that you opened this message.'}</span>
        <button class="btn btn-sm" type="button" aria-pressed={remoteImages} onclick={() => remoteImages = !remoteImages}>{remoteImages ? 'Block images' : 'Load images'}</button>
      </div>
    {/if}

    {#if data.bodyUnavailable}
      <section class="body-state" role="alert">
        <h2>Email content is temporarily unavailable</h2>
        <p>The message details and attachments are still available. Refresh to try loading the content again.</p>
        <button class="btn btn-sm" type="button" onclick={() => invalidateAll()}>Try again</button>
      </section>
    {:else if data.body}
      <p id="message-link-safety" class="link-safety">Links can lead outside your organisation. Check the destination before opening one.</p>
      <iframe
        class="message-body"
        title="Email content"
        aria-describedby="message-link-safety"
        sandbox="allow-popups"
        referrerpolicy="no-referrer"
        srcdoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;line-height:1.5;color:#1f2937;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#2563eb}blockquote{margin-left:8px;padding-left:8px;border-left:2px solid #d1d5db;color:#6b7280}hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}</style></head><body>${data.body}</body></html>`}
      ></iframe>
    {:else}
      <section class="body-state empty-body">
        <h2>No message content</h2>
        <p>This message has no body text or HTML content.</p>
      </section>
    {/if}
  </article>
</div>

<style>
  .toolbar { display:flex; align-items:center; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .toolbar form { display:inline-flex; }
  h1 { margin-bottom:12px; font-size:24px; overflow-wrap:anywhere; }
  .message-meta { display:flex; flex-direction:column; gap:4px; margin-bottom:16px; font-size:13px; }
  .message-meta div { display:grid; grid-template-columns:52px minmax(0,1fr); gap:8px; }
  .message-meta dt { color:var(--text-muted); font-weight:600; }
  .message-meta dd { overflow-wrap:anywhere; }
  .mailbox-context { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .mailbox-context > span { color:var(--text-muted); }
  .permission-label { padding:1px 7px; border:1px solid var(--border); border-radius:999px; font-size:11px; white-space:nowrap; }
  .attachments { padding:12px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-hover); }
  .attachment-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:9px; }
  .attachment-heading h2 { font-size:14px; }
  .attachment-heading p { color:var(--text-muted); font-size:12px; }
  .attachment-list { display:flex; gap:8px; flex-wrap:wrap; }
  .attachment { display:flex; flex-direction:column; align-items:flex-start; gap:2px; max-width:100%; padding:7px 9px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-surface); font-size:13px; }
  .attachment-name { max-width:100%; color:var(--text); font-weight:600; overflow-wrap:anywhere; }
  .attachment > span:last-child { color:var(--text-muted); font-size:11px; overflow-wrap:anywhere; }
  .privacy-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius); color:var(--text-muted); font-size:12px; }
  .message-body { display:block; width:100%; min-height:360px; height:65vh; border:1px solid var(--border); border-radius:var(--radius); background:#fff; margin-top:10px; }
  .link-safety { margin:10px 2px 0; color:var(--text-muted); font-size:12px; }
  .body-state { padding:28px 20px; margin-top:10px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-subtle); text-align:center; }
  .body-state h2 { font-size:16px; }
  .body-state p { margin:6px auto 0; max-width:62ch; color:var(--text-muted); font-size:13px; }
  .body-state .btn { margin-top:14px; }
  .empty-body { min-height:180px; display:flex; flex-direction:column; justify-content:center; }
  .btn-ghost-danger { background:transparent; border-color:transparent; color:var(--danger); }
  .btn-ghost-danger:hover { background:var(--danger-soft); }
  .action-error { padding:10px 12px; margin-bottom:12px; color:var(--danger); background:var(--danger-soft); border-radius:var(--radius); }
  @media (max-width:560px) { .privacy-bar, .attachment-heading { align-items:flex-start; flex-direction:column; } .message-body { height:58vh; } }
</style>
