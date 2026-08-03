<script>
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import MessageAttachments from '$lib/mail/MessageAttachments.svelte';
  import MessageBody from '$lib/mail/MessageBody.svelte';
  import MessageMetadata from '$lib/mail/MessageMetadata.svelte';
  import MessageToolbar from '$lib/mail/MessageToolbar.svelte';

  let { data } = $props();
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

</script>

<svelte:head><title>{data.message.subject || '(no subject)'} · {data.appName || 'cmail'}</title></svelte:head>

<div>
  <MessageToolbar
    messageId={data.message.id}
    draftVersion={data.message.draft_version}
    {returnHref}
    {editDraftHref}
    {replyHref}
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
    <MessageAttachments attachments={data.attachments} />
    <MessageBody messageId={data.message.id} body={data.body} bodyUnavailable={data.bodyUnavailable} allowRemoteImages={!isDraft} />
  </article>
</div>

<style>
  h1 { margin-bottom:12px; font-size:24px; overflow-wrap:anywhere; }
  .action-error { padding:10px 12px; margin-bottom:12px; color:var(--danger); background:var(--danger-soft); border-radius:var(--radius); }
</style>
