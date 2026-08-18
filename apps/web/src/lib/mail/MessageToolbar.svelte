<script>
  import { goto } from '$app/navigation';

  let {
    messageId,
    draftVersion = 0,
    returnHref,
    editDraftHref,
    replyHref,
    replyAllHref,
    canReplyAll = false,
    forwardHref,
    composeReturnHref,
    isDraft = false,
    canMarkUnread = false,
    hasFullControl = false,
    folder = 'inbox',
    starred = false,
    busy = '',
    onMutate = () => {},
    onRemove = () => {},
  } = $props();

  function openCompose(event, href) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void goto(href, { state: { cmailComposeReturn: composeReturnHref } });
  }
</script>

<div class="toolbar" role="group" aria-label="Message actions" aria-busy={Boolean(busy)}>
  <a href={returnHref} class="btn">← Back</a>

  {#if isDraft}
    <a href={editDraftHref} class="btn btn-primary" onclick={(event) => openCompose(event, editDraftHref)}>Edit draft</a>
    <form method="POST" action="/mail/compose?/discard">
      <input type="hidden" name="draft_id" value={messageId} />
      <input type="hidden" name="draft_version" value={draftVersion} />
      <button type="submit" class="btn btn-ghost-danger" onclick={(event) => { if (!confirm('Delete this draft?')) event.preventDefault(); }}>Delete draft</button>
    </form>
  {:else}
    <a href={replyHref} class="btn btn-primary" onclick={(event) => openCompose(event, replyHref)}>Reply</a>
    {#if canReplyAll}
      <a href={replyAllHref} class="btn" onclick={(event) => openCompose(event, replyAllHref)}>Reply all</a>
    {/if}
    <a href={forwardHref} class="btn" onclick={(event) => openCompose(event, forwardHref)}>Forward</a>
    {#if canMarkUnread}
      <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('unread')}>Mark unread</button>
    {/if}
    {#if hasFullControl}
      <button class="btn" type="button" aria-pressed={starred} disabled={!!busy} onclick={() => onMutate('star')}>{starred ? 'Unstar' : 'Star'}</button>
      {#if folder === 'inbox'}
        <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('move', 'archive')}>Archive</button>
        <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('move', 'spam')}>Report spam</button>
      {:else if folder === 'archive'}
        <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('move', 'inbox')}>Move to inbox</button>
      {:else if folder === 'spam'}
        <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('move', 'inbox')}>Not spam – move to inbox</button>
      {:else if folder === 'trash'}
        <button class="btn" type="button" disabled={!!busy} onclick={() => onMutate('restore')}>Restore</button>
      {/if}
      <button class="btn btn-ghost-danger" type="button" disabled={!!busy} onclick={onRemove}>{folder === 'trash' ? 'Delete forever' : 'Move to trash'}</button>
    {/if}
  {/if}

  {#if busy}
    <span class="toolbar-status" role="status">Updating message…</span>
  {/if}
</div>

<style>
  .toolbar { display:flex; align-items:center; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .toolbar form { display:inline-flex; }
  .toolbar-status { color:var(--text-muted); font-size:12px; }
  .btn-ghost-danger { background:transparent; border-color:transparent; color:var(--danger); }
  .btn-ghost-danger:hover { background:var(--danger-soft); }
</style>
