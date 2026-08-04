<script lang="ts">
  import { afterNavigate, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { dateTimeAttribute, formatDate } from '$lib/dates';
  import type { PageData } from './$types';

  type MessageItem = PageData['messages'][number];
  type StateAction = 'read' | 'unread' | 'star' | 'unstar';
  type MoveFolder = 'inbox' | 'archive' | 'spam' | 'trash';
  type BulkAction = StateAction | 'move' | 'restore';

  let { data }: { data: PageData } = $props();
  const d = $derived(data);

  const folderLabels: Record<string, string> = {
    '': 'Inbox',
    inbox: 'Inbox',
    sent: 'Sent',
    drafts: 'Drafts',
    archive: 'Archive',
    spam: 'Spam',
    trash: 'Trash',
  };
  const folderLabel = $derived(folderLabels[d.folder] || d.folder);
  const showMailboxColumn = $derived(!d.mailboxId);

  /** Drop the query but keep the mailbox and folder currently in scope. */
  const clearSearchHref = $derived.by(() => {
    const params = new URLSearchParams();
    if (d.folder && d.folder !== 'inbox') params.set('folder', d.folder);
    if (d.mailboxId) params.set('mailbox', d.mailboxId);
    const qs = params.toString();
    return qs ? `/mail?${qs}` : '/mail';
  });

  let selectedIds = $state<string[]>([]);
  let busyAction = $state('');
  let bulkError = $state('');
  let bulkStatus = $state('');
  let refreshing = $state(false);
  let refreshStatus = $state('');
  let refreshFailed = $state(false);

  const visibleIds = $derived(d.messages.map((message) => message.id));
  const selectedMessages = $derived(d.messages.filter((message) => selectedIds.includes(message.id)));
  const selectedCount = $derived(selectedIds.length);
  const allVisibleSelected = $derived(visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id)));
  const someVisibleSelected = $derived(selectedCount > 0 && !allVisibleSelected);
  const selectionHasFullControl = $derived(
    selectedMessages.length > 0 && selectedMessages.every((message) => message.mailbox_permissions === 'full'),
  );
  const fullActionTitle = $derived(
    selectedCount === 0
      ? 'Select one or more messages'
      : selectionHasFullControl ? '' : 'Full mailbox permission is required for this action',
  );

  const canChangeReadState = $derived(!['sent', 'drafts', 'trash'].includes(d.folder));
  const canArchive = $derived(d.folder === 'inbox');
  const canMarkSpam = $derived(['inbox', 'archive'].includes(d.folder));
  const canMoveToTrash = $derived(!['trash', 'drafts'].includes(d.folder));
  const canMoveToInbox = $derived(['archive', 'spam'].includes(d.folder));
  const canRestore = $derived(d.folder === 'trash');

  afterNavigate(() => {
    selectedIds = [];
    bulkError = '';
    bulkStatus = '';
    refreshStatus = '';
    refreshFailed = false;
  });

  async function refreshMessages(announce = true): Promise<void> {
    if (refreshing || busyAction) return;
    refreshing = true;
    refreshStatus = '';
    refreshFailed = false;
    const previousFirstMessage = d.messages[0]?.id || '';

    try {
      await invalidateAll();
      await tick();
      const hasNewFirstMessage = Boolean(d.messages[0]?.id && d.messages[0].id !== previousFirstMessage);
      if (announce) refreshStatus = 'Messages refreshed.';
      else if (hasNewFirstMessage) refreshStatus = 'New mail loaded.';
    } catch {
      if (announce) {
        refreshStatus = 'Messages could not be refreshed. Try again.';
        refreshFailed = true;
      }
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    let timer: number | undefined;

    const schedule = (): void => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(async () => {
        const shouldRefresh = d.folder === 'inbox'
          && d.page === 1
          && !d.search
          && selectedCount === 0
          && !busyAction;
        if (shouldRefresh) await refreshMessages(false);
        schedule();
      }, 60_000);
    };

    const handleVisibilityChange = (): void => schedule();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    schedule();

    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  function extractName(address: string): string {
    const match = address.match(/^(.+?)\s*<.+>$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    return address.includes('@') ? address.split('@')[0] : address;
  }

  function parseAddresses(value: string): string[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((address): address is string => typeof address === 'string' && address.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  function participantText(message: MessageItem): string {
    if (message.direction !== 'outbound' && message.folder !== 'drafts') return extractName(message.from_address);
    const recipients = parseAddresses(message.to_addresses).map(extractName);
    if (recipients.length === 0) return 'To: No recipients';
    const visible = recipients.slice(0, 2).join(', ');
    return `To: ${visible}${recipients.length > 2 ? ` +${recipients.length - 2}` : ''}`;
  }

  function participantTitle(message: MessageItem): string {
    if (message.direction !== 'outbound' && message.folder !== 'drafts') return message.from_address;
    const recipients = parseAddresses(message.to_addresses);
    return recipients.length > 0 ? `To: ${recipients.join(', ')}` : 'No recipients';
  }

  function shortMailboxLabel(address: string): string {
    return address ? address.split('@')[0] : '';
  }

  function queryFor(pageNumber: number, includeSearch = true): string {
    const params = new URLSearchParams();
    if (d.folder && d.folder !== 'inbox') params.set('folder', d.folder);
    if (d.mailboxId) params.set('mailbox', d.mailboxId);
    if (includeSearch && d.search) params.set('q', d.search);
    if (pageNumber > 1) params.set('page', String(pageNumber));
    return params.toString();
  }

  function messageHref(id: string): string {
    const query = queryFor(d.page);
    return query ? `/mail/${id}?${query}` : `/mail/${id}`;
  }

  function messageSelectionLabel(message: MessageItem): string {
    const subject = message.subject || '(no subject)';
    const participant = participantText(message);
    return message.direction === 'outbound' || message.folder === 'drafts'
      ? `Select ${subject}, ${participant}`
      : `Select ${subject} from ${participant}`;
  }

  function toggleSelection(id: string, checked: boolean): void {
    bulkError = '';
    bulkStatus = '';
    selectedIds = checked
      ? [...new Set([...selectedIds, id])]
      : selectedIds.filter((selectedId) => selectedId !== id);
  }

  function toggleAllVisible(checked: boolean): void {
    bulkError = '';
    bulkStatus = '';
    selectedIds = checked ? visibleIds.slice(0, 100) : [];
  }

  function actionResult(action: BulkAction, folder: MoveFolder | undefined, count: number): string {
    const noun = count === 1 ? 'message' : 'messages';
    if (action === 'read') return `${count} ${noun} marked as read.`;
    if (action === 'unread') return `${count} ${noun} marked as unread.`;
    if (action === 'star') return `${count} ${noun} starred.`;
    if (action === 'unstar') return `${count} ${noun} unstarred.`;
    if (action === 'restore') return `${count} ${noun} restored.`;
    return `${count} ${noun} moved to ${folderLabels[folder || '']?.toLowerCase() || folder}.`;
  }

  async function bulkMutate(action: BulkAction, folder?: MoveFolder): Promise<void> {
    if (selectedCount === 0 || busyAction) return;
    if ((action === 'star' || action === 'unstar' || action === 'move' || action === 'restore') && !selectionHasFullControl) {
      bulkError = 'Full mailbox permission is required to star, move or restore every selected message.';
      return;
    }

    const ids = [...selectedIds];
    busyAction = action === 'move' ? `move:${folder}` : action;
    bulkError = '';
    bulkStatus = '';

    try {
      const response = await fetch('/api/messages/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, ...(folder ? { folder } : {}) }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: unknown; updated?: unknown };
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'The selected messages could not be updated');
      }

      const updated = typeof payload.updated === 'number' ? payload.updated : ids.length;
      selectedIds = [];
      bulkStatus = actionResult(action, folder, updated);
      await invalidateAll();
    } catch (caught) {
      bulkError = caught instanceof Error ? caught.message : 'The selected messages could not be updated';
    } finally {
      busyAction = '';
    }
  }
</script>

<svelte:head><title>{folderLabel} · {d.appName || 'cmail'}</title></svelte:head>

<section class="mail-page" aria-labelledby="message-list-title">
  <header class="page-header">
    <div class="heading-group">
      <h1 id="message-list-title">
        {#if d.search}Search results{:else}{folderLabel}{/if}
      </h1>
      <p>
        {#if d.search}
          Results for “{d.search}” in {folderLabel.toLowerCase()}
        {:else if d.currentMailbox}
          {d.currentMailbox.display_name || d.currentMailbox.address}
          <span>&lt;{d.currentMailbox.address}&gt;</span>
        {:else}
          All assigned mailboxes
        {/if}
      </p>
    </div>

    <div class="page-actions">
      <!-- Search lives in the suite header, scoped to the same mailbox and
           folder, so there is exactly one place to search from. -->
      {#if d.search}
        <a class="btn" href={clearSearchHref}>Clear search</a>
      {/if}
      <button class="btn refresh-button" type="button" disabled={refreshing || Boolean(busyAction)} onclick={() => refreshMessages()}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  </header>

  {#if d.partialDelivery}
    <p class="bulk-feedback error" role="alert">
      The provider delivered or queued this message for some recipients, but permanently bounced at least one. Do not resend to the whole list; review provider activity and contact failed recipients separately.
    </p>
  {/if}

  {#if refreshStatus}
    <p class="refresh-feedback" class:error={refreshFailed} role={refreshFailed ? 'alert' : 'status'}>{refreshStatus}</p>
  {/if}

  {#if bulkError}
    <p class="bulk-feedback error" role="alert">{bulkError}</p>
  {:else if bulkStatus}
    <p class="bulk-feedback success" role="status">{bulkStatus}</p>
  {/if}

  {#if d.messages.length === 0}
    <div class="card empty-state">
      <h2>{d.search ? 'No matching messages' : `No messages in ${folderLabel.toLowerCase()}`}</h2>
      <p>{d.search ? 'Try another term or clear the search.' : 'Messages in this folder will appear here.'}</p>
      {#if d.search}
        <a class="btn" href={queryFor(1, false) ? `?${queryFor(1, false)}` : '/mail'}>Clear search</a>
      {/if}
    </div>
  {:else}
    <section class="message-list card" aria-label={`${folderLabel} messages`}>
      <div class="bulk-bar" aria-busy={Boolean(busyAction)}>
        <label class="select-all">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected}
            onchange={(event) => toggleAllVisible((event.currentTarget as HTMLInputElement).checked)}
          />
          <span>{allVisibleSelected ? 'Clear visible' : 'Select all visible'}</span>
        </label>

        <div class="selection-summary" aria-live="polite">
          {selectedCount === 0 ? `${d.messages.length} visible` : `${selectedCount} selected`}
        </div>

        <div class="bulk-commands" role="group" aria-label="Actions for selected messages">
          {#if canChangeReadState}
            <button class="btn btn-sm" type="button" disabled={selectedCount === 0 || Boolean(busyAction)} onclick={() => bulkMutate('read')}>Read</button>
            <button class="btn btn-sm" type="button" disabled={selectedCount === 0 || Boolean(busyAction)} onclick={() => bulkMutate('unread')}>Unread</button>
          {/if}
          <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('star')}>Star</button>
          <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('unstar')}>Unstar</button>
          {#if canMoveToInbox}
            <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('move', 'inbox')}>{d.folder === 'spam' ? 'Not spam' : 'Move to inbox'}</button>
          {/if}
          {#if canRestore}
            <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('restore')}>Restore</button>
          {/if}
          {#if canArchive}
            <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('move', 'archive')}>Archive</button>
          {/if}
          {#if canMarkSpam}
            <button class="btn btn-sm" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('move', 'spam')}>Spam</button>
          {/if}
          {#if canMoveToTrash}
            <button class="btn btn-sm danger-command" type="button" title={fullActionTitle} aria-describedby={selectedCount > 0 && !selectionHasFullControl ? 'bulk-permission-note' : undefined} disabled={selectedCount === 0 || !selectionHasFullControl || Boolean(busyAction)} onclick={() => bulkMutate('move', 'trash')}>Trash</button>
          {/if}
        </div>
      </div>

      {#if selectedCount > 0 && !selectionHasFullControl}
        <p id="bulk-permission-note" class="permission-note">
          {canChangeReadState ? 'Read and unread remain available. ' : ''}Starring, moving and restoring require full permission for every selected mailbox.
        </p>
      {/if}

      <div role="list">
        {#each d.messages as message (message.id)}
          <div
            class="mail-row"
            class:unread={!message.is_read}
            class:selected={selectedIds.includes(message.id)}
            role="listitem"
          >
            <label class="message-selector">
              <span class="sr-only">{messageSelectionLabel(message)}</span>
              <input
                type="checkbox"
                checked={selectedIds.includes(message.id)}
                onchange={(event) => toggleSelection(message.id, (event.currentTarget as HTMLInputElement).checked)}
              />
            </label>

            <a href={messageHref(message.id)} class="mail-row-link" class:with-mailbox={showMailboxColumn}>
              {#if !message.is_read}<span class="sr-only">Unread: </span>{/if}
              {#if showMailboxColumn}
                <span class="mailbox-tag" title={message.mailbox_address}>{shortMailboxLabel(message.mailbox_address)}</span>
              {/if}
              <span class="participant" title={participantTitle(message)}>{participantText(message)}</span>
              <span class="message-middle">
                <span class="subject">{message.subject || '(no subject)'}</span>
                {#if message.snippet}<span class="snippet"> — {message.snippet}</span>{/if}
              </span>
              <span class="message-date">
                <span class="indicators">
                  {#if message.importance === 'high'}
                    <span class="indicator importance-high" aria-label="High importance" title="High importance">!</span>
                  {:else if message.importance === 'low'}
                    <span class="indicator importance-low" aria-label="Low importance" title="Low importance">↓</span>
                  {/if}
                  {#if message.is_starred}
                    <span class="indicator starred" aria-label="Starred">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-2.9L6.4 20l1.1-6.2-4.6-4.4 6.3-.9L12 2.8Z" /></svg>
                    </span>
                  {/if}
                  {#if message.has_attachments}
                    <span class="indicator" aria-label="Has attachments">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.5 9.5a2 2 0 1 1-2.8-2.8l8.8-8.8" /></svg>
                    </span>
                  {/if}
                </span>
                <time datetime={dateTimeAttribute(message.received_at)}>{formatDate(message.received_at, d.locale, d.timeZone)}</time>
              </span>
            </a>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if d.hasMore || d.page > 1}
    <nav class="pagination" aria-label="Message pages">
      {#if d.page > 1}<a href={`?${queryFor(d.page - 1)}`} class="btn">Newer</a>{/if}
      <span aria-current="page">Page {d.page}</span>
      {#if d.hasMore}<a href={`?${queryFor(d.page + 1)}`} class="btn">Older</a>{/if}
    </nav>
  {/if}
</section>

<style>
  .mail-page { min-width: 0; }
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
  }
  .heading-group { min-width: 0; }
  .heading-group h1 { font-size: 22px; }
  .heading-group p {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .heading-group p span { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .page-actions { display:flex; align-items:center; gap:8px; width:min(100%, 480px); }
  .refresh-button { flex:0 0 auto; }
  .refresh-feedback {
    padding:7px 10px;
    margin:-6px 0 12px;
    color:var(--success);
    font-size:12px;
  }
  .refresh-feedback.error { color:var(--danger); }

  .message-list {
    padding: 0;
    overflow: hidden;
  }
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 50px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .select-all input,
  .message-selector input {
    width: 17px;
    height: 17px;
    min-width: 17px;
    margin: 0;
    padding: 0;
    border-radius: 4px;
    accent-color: var(--primary);
    box-shadow: none;
    cursor: pointer;
  }
  .selection-summary {
    min-width: 72px;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .bulk-commands {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin-left: auto;
  }
  .bulk-commands .btn { padding-inline: 9px; }
  .danger-command { color: var(--danger); }
  .permission-note {
    padding: 7px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--warning-soft);
    color: var(--text);
    font-size: 12px;
  }
  .bulk-feedback {
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    font-size: 13px;
  }
  .bulk-feedback.error { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 25%, transparent); }
  .bulk-feedback.success { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, transparent); }

  .mail-row {
    position: relative;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    min-height: 48px;
    border-bottom: 1px solid var(--border);
    transition: background 0.12s ease;
  }
  .mail-row:last-child { border-bottom: 0; }
  .mail-row:hover { background: var(--bg-hover); }
  .mail-row.selected { background: var(--primary-soft); }
  .mail-row.unread::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--primary);
  }
  .mail-row.unread .participant,
  .mail-row.unread .subject { font-weight: 650; color: var(--text); }
  .message-selector {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    cursor: pointer;
  }
  .mail-row-link {
    display: grid;
    grid-template-columns: minmax(120px, 180px) minmax(160px, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 10px 14px 10px 0;
    color: var(--text);
    text-decoration: none;
  }
  .mail-row-link:hover { text-decoration: none; }
  .mail-row-link.with-mailbox {
    grid-template-columns: minmax(70px, 100px) minmax(120px, 180px) minmax(160px, 1fr) auto;
  }
  .participant,
  .message-middle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .participant { font-size: 14px; }
  .subject { font-size: 14px; }
  .snippet { color: var(--text-muted); font-size: 14px; }
  .mailbox-tag {
    min-width: 0;
    overflow: hidden;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
    font-weight: 500;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message-date {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .indicators { display: inline-flex; align-items: center; gap: 4px; }
  .indicator { display: inline-flex; color: var(--text-muted); }
  .indicator.importance-high,
  .indicator.importance-low { align-items:center; justify-content:center; width:15px; height:15px; font-size:15px; font-weight:800; line-height:1; }
  .indicator.importance-high { color:var(--danger); }
  .indicator.importance-low { color:var(--primary); }
  .indicator.starred { color: var(--warning); }
  .indicator svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .indicator.starred svg { fill: currentColor; stroke-width: 1.2; }

  .empty-state { padding: 52px 24px; text-align: center; }
  .empty-state h2 { font-size: 18px; }
  .empty-state p { margin-top: 6px; color: var(--text-muted); }
  .empty-state .btn { margin-top: 16px; }
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 16px;
  }
  .pagination span { color: var(--text-muted); font-size: 12px; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 860px) {
    .page-header { align-items: stretch; flex-direction: column; gap: 12px; }
    .page-actions { width:100%; }
    .bulk-bar { align-items: stretch; flex-wrap: wrap; }
    .select-all { flex: 1; }
    .selection-summary { display: flex; align-items: center; justify-content: flex-end; }
    .bulk-commands {
      width: 100%;
      margin-left: 0;
      padding-bottom: 2px;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .mail-row-link,
    .mail-row-link.with-mailbox {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'participant date'
        'middle middle';
      gap: 3px 10px;
      padding-block: 9px;
    }
    .mail-row-link.with-mailbox {
      grid-template-areas:
        'mailbox date'
        'participant participant'
        'middle middle';
    }
    .mailbox-tag { grid-area: mailbox; justify-self: start; max-width: 150px; }
    .participant { grid-area: participant; }
    .message-middle { grid-area: middle; }
    .message-date { grid-area: date; }
  }

  @media (max-width: 520px) {
    .heading-group h1 { font-size: 20px; }
    .page-actions { align-items:stretch; flex-direction:column; }
    .refresh-button { align-self:flex-start; }
    .mail-row { grid-template-columns: 40px minmax(0, 1fr); }
    .message-selector { min-width: 40px; }
    .mail-row-link { padding-right: 10px; }
    .snippet { display: none; }
    .bulk-commands .btn { min-height: 36px; }
  }

  @media (forced-colors: active) {
    .mail-row.selected { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
