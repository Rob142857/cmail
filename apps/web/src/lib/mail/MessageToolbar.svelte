<script>
  import { goto } from '$app/navigation';
  import Icon from '#lib/ui/Icon.svelte';

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
    createRuleHref = '',
    busy = '',
    onMutate = () => {},
    onRemove = () => {},
  } = $props();

  /** @type {HTMLDetailsElement | null} */
  let moreMenu = $state(null);

  function openCompose(event, href) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void goto(href, { state: { cmailComposeReturn: composeReturnHref } });
  }

  /** Close the phone "More" menu, then run the action. */
  function fromMenu(action) {
    if (moreMenu) moreMenu.open = false;
    action();
  }

  const moveAction = $derived(
    folder === 'inbox' ? { label: 'Report spam', icon: 'junk', run: () => onMutate('move', 'spam') }
      : folder === 'archive' ? { label: 'Move to inbox', icon: 'inbox', run: () => onMutate('move', 'inbox') }
        : folder === 'spam' ? { label: 'Not spam – move to inbox', icon: 'inbox', run: () => onMutate('move', 'inbox') }
          : folder === 'trash' ? { label: 'Restore', icon: 'inbox', run: () => onMutate('restore') }
            : null,
  );
</script>

<!--
  Desktop: labelled buttons in one wrapping row.
  Phones: one row of 44px icon buttons (Back, Reply, Forward, Archive, Trash)
  and a More menu for the rest, so the subject isn't pushed below the fold.
-->
<div class="toolbar" role="group" aria-label="Message actions" aria-busy={Boolean(busy)}>
  <a href={returnHref} class="btn tb-back" aria-label="Back to list"><Icon name="arrowLeft" size={16} /><span class="tb-label">Back</span></a>

  {#if isDraft}
    <a href={editDraftHref} class="btn btn-primary" onclick={(event) => openCompose(event, editDraftHref)}>Edit draft</a>
    <form method="POST" action="/mail/compose?/discard">
      <input type="hidden" name="draft_id" value={messageId} />
      <input type="hidden" name="draft_version" value={draftVersion} />
      <button type="submit" class="btn btn-ghost-danger" onclick={(event) => { if (!confirm('Delete this draft?')) event.preventDefault(); }}>Delete draft</button>
    </form>
  {:else}
    <a href={replyHref} class="btn btn-primary tb-reply" onclick={(event) => openCompose(event, replyHref)}><Icon name="reply" size={16} /><span>Reply</span></a>
    {#if canReplyAll}
      <a href={replyAllHref} class="btn tb-wide" onclick={(event) => openCompose(event, replyAllHref)}><Icon name="replyAll" size={16} /><span class="tb-label">Reply all</span></a>
    {/if}
    <a href={forwardHref} class="btn" aria-label="Forward" onclick={(event) => openCompose(event, forwardHref)}><Icon name="forward" size={16} /><span class="tb-label">Forward</span></a>
    {#if canMarkUnread}
      <button class="btn tb-wide" type="button" disabled={!!busy} onclick={() => onMutate('unread')}><Icon name="mail" size={16} /><span class="tb-label">Mark unread</span></button>
    {/if}
    {#if hasFullControl}
      <button class="btn tb-wide" type="button" aria-pressed={starred} disabled={!!busy} onclick={() => onMutate('star')}><Icon name="star" size={16} filled={starred} /><span class="tb-label">{starred ? 'Unstar' : 'Star'}</span></button>
      {#if folder === 'inbox'}
        <button class="btn" type="button" aria-label="Archive" disabled={!!busy} onclick={() => onMutate('move', 'archive')}><Icon name="archive" size={16} /><span class="tb-label">Archive</span></button>
      {/if}
      {#if moveAction}
        <button class="btn tb-wide" type="button" disabled={!!busy} onclick={moveAction.run}><Icon name={moveAction.icon} size={16} /><span class="tb-label">{moveAction.label}</span></button>
      {/if}
      {#if createRuleHref}
        <a href={createRuleHref} class="btn tb-wide"><Icon name="filter" size={16} /><span class="tb-label">Create rule</span></a>
      {/if}
      <button class="btn btn-ghost-danger" type="button" aria-label={folder === 'trash' ? 'Delete forever' : 'Move to trash'} disabled={!!busy} onclick={onRemove}><Icon name="trash" size={16} /><span class="tb-label">{folder === 'trash' ? 'Delete forever' : 'Move to trash'}</span></button>
    {/if}

    {#if canReplyAll || canMarkUnread || hasFullControl}
      <details class="tb-more" bind:this={moreMenu}>
        <summary class="btn" aria-label="More actions"><Icon name="more" size={18} /></summary>
        <div class="tb-menu">
          {#if canReplyAll}
            <a href={replyAllHref} onclick={(event) => { if (moreMenu) moreMenu.open = false; openCompose(event, replyAllHref); }}><Icon name="replyAll" size={16} /> Reply all</a>
          {/if}
          {#if canMarkUnread}
            <button type="button" disabled={!!busy} onclick={() => fromMenu(() => onMutate('unread'))}><Icon name="mail" size={16} /> Mark unread</button>
          {/if}
          {#if hasFullControl}
            <button type="button" disabled={!!busy} onclick={() => fromMenu(() => onMutate('star'))}><Icon name="star" size={16} filled={starred} /> {starred ? 'Unstar' : 'Star'}</button>
            {#if moveAction}
              <button type="button" disabled={!!busy} onclick={() => fromMenu(moveAction.run)}><Icon name={moveAction.icon} size={16} /> {moveAction.label}</button>
            {/if}
            {#if createRuleHref}
              <a href={createRuleHref}><Icon name="filter" size={16} /> Create rule</a>
            {/if}
          {/if}
        </div>
      </details>
    {/if}
  {/if}

  {#if busy}
    <span class="toolbar-status" role="status">Updating message…</span>
  {/if}
</div>

<style>
  .toolbar { position: relative; display:flex; align-items:center; gap:2px; margin-bottom:12px; flex-wrap:wrap; }
  /* Command-bar style: secondary actions are quiet until hovered; Reply stays the one filled button. */
  .toolbar > .btn:not(.btn-primary), .toolbar form > .btn:not(.btn-primary), .tb-more > summary {
    border-color: transparent;
    background: transparent;
    font-weight: 500;
  }
  .toolbar > .btn:not(.btn-primary):hover, .toolbar form > .btn:not(.btn-primary):hover, .tb-more > summary:hover { background: var(--bg-hover); }
  .toolbar > .btn-primary { margin: 0 6px 0 4px; }
  .toolbar form { display:inline-flex; }
  .toolbar-status { color:var(--text-muted); font-size:12px; }
  .btn-ghost-danger { background:transparent; border-color:transparent; color:var(--danger-text); }
  .btn-ghost-danger:hover { background:var(--danger-soft); }
  .tb-more { display: none; }

  @media (max-width: 600px) {
    .toolbar { flex-wrap: nowrap; gap: 4px; margin-bottom: 12px; }
    .toolbar > .btn, .tb-more > summary { width: 44px; min-width: 44px; padding: 0; }
    .toolbar > .tb-reply { width: auto; padding: 0 14px; }
    .tb-back { margin-right: auto; border-color: transparent; background: transparent; }
    /* Icon-only on phones; the name stays for screen readers. */
    .tb-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    /* Secondary actions move into the More menu. */
    .tb-wide { display: none; }
    .toolbar-status { position: absolute; top: 100%; left: 0; }

    .tb-more { display: block; position: relative; }
    .tb-more > summary { list-style: none; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; cursor: pointer; }
    .tb-more > summary::-webkit-details-marker { display: none; }
    .tb-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 40;
      display: flex;
      flex-direction: column;
      min-width: 220px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-raised);
      box-shadow: var(--shadow-16);
    }
    .tb-menu a, .tb-menu button {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      min-height: 44px;
      padding: 0 12px;
      border: 0;
      border-radius: var(--radius);
      background: transparent;
      color: var(--text);
      font-weight: 400;
      text-decoration: none;
    }
    .tb-menu a:hover, .tb-menu button:hover { background: var(--bg-hover); text-decoration: none; }
  }
</style>
