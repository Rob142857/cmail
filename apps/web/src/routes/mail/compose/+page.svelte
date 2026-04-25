<script>
  let { data, form } = $props();

  let subject = $state('');
  let to = $state('');
  let cc = $state('');
  let from = $state(data.mailboxes[0]?.address || '');
  let body = $state('');

  // Pre-fill from reply/forward
  $effect(() => {
    if (data.replyTo) {
      if (data.isForward) {
        subject = `Fwd: ${data.replyTo.subject}`;
        body = `<br><br>---------- Forwarded message ----------<br>${data.replyBody}`;
      } else {
        subject = data.replyTo.subject.startsWith('Re:') ? data.replyTo.subject : `Re: ${data.replyTo.subject}`;
        to = data.replyTo.from_address;
        body = `<br><br>On ${new Date(data.replyTo.received_at).toLocaleString()}, ${data.replyTo.from_address} wrote:<br><blockquote style="margin-left: 8px; padding-left: 8px; border-left: 2px solid var(--border);">${data.replyBody}</blockquote>`;
      }
    }
  });
</script>

<div>
  <h2 style="margin-bottom: 16px;">✏️ Compose</h2>

  {#if form?.error}
    <div class="badge badge-error" style="margin-bottom: 12px; display: block; padding: 8px;">{form.error}</div>
  {/if}

  <form method="POST" class="card compose-form">
    <div class="field">
      <label for="from">From</label>
      <select name="from" id="from" bind:value={from}>
        {#each data.mailboxes as mb}
          <option value={mb.address}>{mb.display_name || mb.address}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="to">To</label>
      <input type="text" name="to" id="to" bind:value={to} placeholder="recipient@example.com" required />
    </div>

    <div class="field">
      <label for="cc">Cc</label>
      <input type="text" name="cc" id="cc" bind:value={cc} placeholder="cc@example.com" />
    </div>

    <div class="field">
      <label for="subject">Subject</label>
      <input type="text" name="subject" id="subject" bind:value={subject} placeholder="Subject" required />
    </div>

    <div class="field">
      <label for="body">Message</label>
      <textarea name="body" id="body" bind:value={body} rows="14" placeholder="Write your message..."></textarea>
    </div>

    {#if data.signature}
      <details style="margin-bottom: 12px; font-size: 13px;">
        <summary>Signature preview</summary>
        <div style="padding: 8px; background: var(--bg-hover); border-radius: var(--radius);">
          {@html data.signature}
        </div>
      </details>
    {/if}

    {#if data.replyTo}
      <input type="hidden" name="in_reply_to" value={data.replyTo.message_id_header} />
    {/if}

    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <a href="/mail" class="btn">Cancel</a>
      <button type="submit" class="btn btn-primary">Send ✉️</button>
    </div>
  </form>
</div>

<style>
  .compose-form .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .compose-form label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }
</style>
