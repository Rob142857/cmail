<script>
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import CalendarInvite from '$lib/mail/CalendarInvite.svelte';
  import MessageAttachments from '$lib/mail/MessageAttachments.svelte';
  import MessageBody from '$lib/mail/MessageBody.svelte';
  import MessageMetadata from '$lib/mail/MessageMetadata.svelte';
  import MessageSafety from '$lib/mail/MessageSafety.svelte';
  import MessageToolbar from '$lib/mail/MessageToolbar.svelte';

  let { data, form } = $props();
  let busy = $state('');
  let actionError = $state('');
  let starred = $state(untrack(() => Boolean(data.message.is_starred)));
  let previousMessageId = untrack(() => data.message.id);
  let markedReadFor = $state('');

  $effect(() => {
    const messageId = data.message.id;
    if (messageId !== previousMessageId) {
      previousMessageId = messageId;
      starred = Boolean(data.message.is_starred);
      busy = '';
      actionError = '';
    }
  });

  $effect(() => {
    const messageId = data.message.id;
    if (!data.message.is_read && markedReadFor !== messageId) {
      markedReadFor = messageId;
      void mutate('read');
    }
  });

  const folder = $derived(data.message.folder || 'inbox');
  const isDraft = $derived(folder === 'drafts');
  const hasFullControl = $derived(data.message.mailbox_permissions === 'full');
  const canMarkUnread = $derived(!['sent', 'trash'].includes(folder));
  const returnParams = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.returnFolder) params.set('folder', data.returnFolder);
    if (data.returnMailbox) params.set('mailbox', data.returnMailbox);
    if (data.returnSearch) params.set('q', data.returnSearch);
    if (data.returnPage > 1) params.set('page', String(data.returnPage));
    return params.toString();
  });
  const returnHref = $derived(returnParams ? `/mail?${returnParams}` : '/mail');
  const messageViewHref = $derived(`/mail/${data.message.id}${returnParams ? `?${returnParams}` : ''}`);
  const editDraftHref = $derived.by(() => {
    const params = new URLSearchParams({ draft: data.message.id, returnTo: messageViewHref });
    return `/mail/compose?${params}`;
  });
  const replyHref = $derived.by(() => {
    const params = new URLSearchParams({ reply: data.message.id, returnTo: messageViewHref });
    return `/mail/compose?${params}`;
  });
  const replyAllHref = $derived.by(() => {
    const params = new URLSearchParams({ replyAll: data.message.id, returnTo: messageViewHref });
    return `/mail/compose?${params}`;
  });
  const canReplyAll = $derived(Boolean(data.canReplyAll));
  const forwardHref = $derived.by(() => {
    const params = new URLSearchParams({ forward: data.message.id, returnTo: messageViewHref });
    return `/mail/compose?${params}`;
  });
  const mailboxHref = $derived.by(() => {
    const params = new URLSearchParams({ mailbox: data.message.mailbox_id });
    if (folder !== 'inbox') params.set('folder', folder);
    return `/mail?${params}`;
  });
  async function mutate(action, targetFolder = '') {
    busy = action;
    actionError = '';
    try {
      const response = await fetch(`/api/messages/${data.message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, folder: targetFolder || undefined }),
      });
      if (!response.ok) throw new Error('Couldn\'t update message');
      if (action === 'star') starred = !starred;
      if (action === 'read') await invalidateAll();
      if (action === 'unread' || action === 'move' || action === 'restore') await goto(returnHref, { invalidateAll: true });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Couldn\'t update message';
    } finally {
      busy = '';
    }
  }

  async function removeMessage() {
    const permanent = folder === 'trash';
    if (permanent && !confirm('Permanently delete this message and its attachments? Can\'t be undone.')) return;
    busy = 'delete';
    actionError = '';
    try {
      const response = await fetch(`/api/messages/${data.message.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Couldn\'t delete message');
      await goto(returnHref, { invalidateAll: true });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Couldn\'t delete message';
      busy = '';
    }
  }

</script>

<svelte:head><title>{data.message.subject || '(no subject)'} · {data.appName || 'cmail'}</title></svelte:head>

<div>
  <MessageToolbar
    messageId={data.message.id}
    draftVersion={data.message.draft_version}
    {returnHref}
    {editDraftHref}
    {replyHref}
    {replyAllHref}
    {canReplyAll}
    {forwardHref}
    composeReturnHref={messageViewHref}
    {isDraft}
    {canMarkUnread}
    {hasFullControl}
    {folder}
    {starred}
    {busy}
    onMutate={mutate}
    onRemove={removeMessage}
  />

  {#if actionError}<p class="action-error" role="alert">{actionError}</p>{/if}

  <article class="card">
    <h1>{data.message.subject || '(no subject)'}</h1>
    <MessageMetadata message={data.message} locale={data.locale} timeZone={data.timeZone} {mailboxHref} />
    <MessageSafety message={data.message} riskyLinks={data.riskyLinks} />
    <MessageAttachments attachments={data.attachments} />
    {#if data.invite}
      <CalendarInvite invite={data.invite} locale={data.locale} timeZone={data.timeZone} error={form?.error || ''} />
    {/if}
    <MessageBody messageId={data.message.id} body={data.body} bodyUnavailable={data.bodyUnavailable} allowRemoteImages={!isDraft} inlineImageOrigin={data.inlineImageOrigin} />
  </article>
</div>

<style>
  h1 { margin-bottom:12px; font-size:24px; overflow-wrap:anywhere; }
  .action-error { padding:10px 12px; margin-bottom:12px; color:var(--danger); background:var(--danger-soft); border-radius:var(--radius); }
</style>
