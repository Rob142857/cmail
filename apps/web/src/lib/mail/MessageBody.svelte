<script>
  import { invalidateAll } from '$app/navigation';
  import EmailHtmlFrame from '$lib/mail/EmailHtmlFrame.svelte';

  let { body = '', bodyUnavailable = false, messageId = '', allowRemoteImages = false, inlineImageOrigin = '' } = $props();
  let remoteImages = $state(false);
  let previousMessageId = $state('');

  $effect(() => {
    if (messageId !== previousMessageId) {
      previousMessageId = messageId;
      remoteImages = false;
    }
  });

  /** @param {string} value */
  function includesRemoteImages(value) {
    return /<img\b[^>]*\bsrc=(?:"|')https:\/\//i.test(value);
  }

  const hasRemoteImages = $derived(includesRemoteImages(body));
</script>

{#if allowRemoteImages && !bodyUnavailable && body && hasRemoteImages}
  <div class="privacy-bar">
    <span>{remoteImages ? 'Remote images are loaded. They can tell the sender that you opened this message.' : 'Remote images are blocked because loading them can tell the sender that you opened this message.'}</span>
    <button class="btn btn-sm" type="button" aria-pressed={remoteImages} onclick={() => remoteImages = !remoteImages}>{remoteImages ? 'Block images' : 'Load images'}</button>
  </div>
{/if}

{#if bodyUnavailable}
  <section class="body-state" role="alert">
    <h2>Email content is temporarily unavailable</h2>
    <p>The message details and attachments are still available. Refresh to try loading the content again.</p>
    <button class="btn btn-sm" type="button" onclick={() => invalidateAll()}>Try again</button>
  </section>
{:else if body}
  <p id="message-link-safety" class="link-safety">Links can lead outside your organisation. Check the destination before opening one.</p>
  <div class="message-frame">
    <EmailHtmlFrame
      html={body}
      title="Email content"
      describedBy="message-link-safety"
      {allowRemoteImages}
      {remoteImages}
      imageOrigin={inlineImageOrigin}
      allowLinks
    />
  </div>
{:else}
  <section class="body-state empty-body">
    <h2>No message content</h2>
    <p>This message has no body text or HTML content.</p>
  </section>
{/if}

<style>
  .privacy-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius); color:var(--text-muted); font-size:12px; }
  .message-frame { margin-top:10px; }
  .link-safety { margin:10px 2px 0; color:var(--text-muted); font-size:12px; }
  .body-state { padding:28px 20px; margin-top:10px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-subtle); text-align:center; }
  .body-state h2 { font-size:16px; }
  .body-state p { margin:6px auto 0; max-width:62ch; color:var(--text-muted); font-size:13px; }
  .body-state .btn { margin-top:14px; }
  .empty-body { min-height:180px; display:flex; flex-direction:column; justify-content:center; }

  @media (max-width:560px) {
    .privacy-bar { align-items:flex-start; flex-direction:column; }
  }
</style>
