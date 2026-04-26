<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  /** @type {any} */
  const d = $derived(data);

  // Initial values come from: draft > reply > forward > defaults
  const initialFrom = d.draft?.from_address || d.mailboxes[0]?.address || '';
  /** @param {string} json */
  function parseList(json) { try { const a = JSON.parse(json); return Array.isArray(a) ? a.join(', ') : ''; } catch { return ''; } }

  let subject = $state(d.draft?.subject || '');
  let to = $state(d.draft ? parseList(d.draft.to_addresses) : '');
  let cc = $state(d.draft ? parseList(d.draft.cc_addresses) : '');
  let from = $state(initialFrom);
  let body = $state(d.draft?.body || '');
  let draftId = $state(d.draft?.id || '');

  let saving = $state(false);
  /** @type {string} */
  let savedAt = $state('');
  let dirty = $state(false);

  // Pre-fill from reply/forward (only if no draft)
  $effect(() => {
    if (d.draft) return;
    if (d.replyTo) {
      if (d.isForward) {
        subject = `Fwd: ${d.replyTo.subject}`;
        body = `<br><br>---------- Forwarded message ----------<br>${d.replyBody}`;
      } else {
        subject = d.replyTo.subject.startsWith('Re:') ? d.replyTo.subject : `Re: ${d.replyTo.subject}`;
        to = d.replyTo.from_address;
        body = `<br><br>On ${new Date(d.replyTo.received_at).toLocaleString()}, ${d.replyTo.from_address} wrote:<br><blockquote style="margin-left: 8px; padding-left: 8px; border-left: 2px solid var(--border);">${d.replyBody}</blockquote>`;
      }
    }
  });

  function markDirty() { dirty = true; }

  /** Manual save trigger; returns when the request finishes */
  async function saveDraft() {
    if (saving) return;
    saving = true;
    try {
      const fd = new FormData();
      fd.set('from', from);
      fd.set('to', to);
      fd.set('cc', cc);
      fd.set('subject', subject || '(no subject)');
      fd.set('body', body);
      if (draftId) fd.set('draft_id', draftId);
      if (d.replyTo?.message_id_header) fd.set('in_reply_to', d.replyTo.message_id_header);
      const res = await fetch('?/save', {
        method: 'POST',
        body: fd,
        headers: { 'x-sveltekit-action': 'true', accept: 'application/json' },
      });
      if (!res.ok) throw new Error('save failed');
      const json = await res.json();
      // SvelteKit returns { type: 'success', data: <devalue-encoded-string> }
      let payload = null;
      if (json?.data) {
        try {
          const arr = JSON.parse(json.data);
          // devalue encodes objects as flat arrays where index 0 is a key->index map
          if (Array.isArray(arr) && typeof arr[0] === 'object' && arr[0] !== null) {
            const keys = arr[0];
            payload = {};
            for (const k of Object.keys(keys)) payload[k] = arr[keys[k]];
          } else {
            payload = arr;
          }
        } catch { /* ignore */ }
      }
      if (payload?.savedDraftId) draftId = payload.savedDraftId;
      savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      dirty = false;
    } catch (e) {
      // silent — surfaced through dirty flag
    } finally {
      saving = false;
    }
  }

  // Autosave: 8s after last edit, only when dirty and there is something to save.
  // NOTE: `timer` must NOT be $state — writing it inside this effect would
  // re-trigger the effect and explode (effect_update_depth_exceeded).
  /** @type {any} */
  let timer = null;
  $effect(() => {
    // depend on body/subject/to/cc/from + dirty
    void body; void subject; void to; void cc; void from; void dirty;
    if (!dirty) return;
    if (timer) clearTimeout(timer);
    if (!from) return;
    if (!body && !subject && !to && !cc) return;
    timer = setTimeout(() => { saveDraft(); }, 8000);
    return () => { if (timer) { clearTimeout(timer); timer = null; } };
  });
</script>

<div class="compose-page">
  <header class="compose-header">
    <h1>{d.draft ? 'Draft' : d.replyTo ? (d.isForward ? 'Forward' : 'Reply') : 'New message'}</h1>
    <div class="status">
      {#if saving}
        Saving…
      {:else if savedAt}
        Saved at {savedAt}{dirty ? ' — unsaved changes' : ''}
      {:else if dirty}
        Unsaved changes
      {/if}
    </div>
  </header>

  {#if form?.error}
    <div class="form-error">{form.error}</div>
  {/if}

  <form method="POST" action="?/send" use:enhance class="card compose-form">
    <input type="hidden" name="draft_id" value={draftId} />
    {#if d.replyTo}
      <input type="hidden" name="in_reply_to" value={d.replyTo.message_id_header} />
    {/if}

    <div class="field">
      <label for="from">From</label>
      <select name="from" id="from" bind:value={from} oninput={markDirty}>
        {#each d.mailboxes as mb}
          <option value={mb.address}>{mb.display_name ? `${mb.display_name} <${mb.address}>` : mb.address}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="to">To</label>
      <input type="text" name="to" id="to" bind:value={to} oninput={markDirty} placeholder="recipient@example.com, another@example.com" required />
    </div>

    <div class="field">
      <label for="cc">Cc</label>
      <input type="text" name="cc" id="cc" bind:value={cc} oninput={markDirty} placeholder="optional" />
    </div>

    <div class="field">
      <label for="subject">Subject</label>
      <input type="text" name="subject" id="subject" bind:value={subject} oninput={markDirty} placeholder="Subject" required />
    </div>

    <div class="field">
      <label for="body">Message</label>
      <textarea name="body" id="body" bind:value={body} oninput={markDirty} rows="14" placeholder="Write your message…"></textarea>
    </div>

    {#if d.signature}
      <details class="signature-preview">
        <summary>Signature preview</summary>
        <div class="signature-body">{@html d.signature}</div>
      </details>
    {/if}

    <div class="compose-actions">
      <div class="left">
        {#if draftId}
          <button type="submit" formaction="?/discard" class="btn btn-ghost-danger">Discard draft</button>
        {:else}
          <a href="/mail" class="btn btn-ghost">Cancel</a>
        {/if}
      </div>
      <div class="right">
        <button type="button" class="btn" onclick={saveDraft} disabled={saving}>Save draft</button>
        <button type="submit" class="btn btn-primary">Send</button>
      </div>
    </div>
  </form>
</div>

<style>
  .compose-page { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .compose-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .compose-header h1 { font-size: 20px; margin: 0; font-weight: 600; }
  .status { font-size: 12px; color: var(--text-muted); }

  .form-error {
    padding: 10px 14px;
    background: #fee2e2;
    color: #991b1b;
    border-radius: var(--radius);
    font-size: 14px;
  }

  .compose-form { padding: 20px; }
  .compose-form .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .compose-form label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .compose-form textarea { font-family: inherit; resize: vertical; min-height: 240px; }

  .signature-preview { font-size: 13px; margin: 4px 0 12px; }
  .signature-preview summary { cursor: pointer; color: var(--text-muted); }
  .signature-body { padding: 10px; background: var(--bg-hover); border-radius: var(--radius); margin-top: 6px; }

  .compose-actions { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); margin-top: 4px; }
  .compose-actions .left { margin-right: auto; }
  .compose-actions .right { display: flex; gap: 8px; }
  .btn-ghost { background: transparent; border-color: transparent; }
  .btn-ghost:hover { background: var(--bg-hover); }
  .btn-ghost-danger { background: transparent; border-color: transparent; color: var(--danger); }
  .btn-ghost-danger:hover { background: #fee2e2; }

  @media (max-width: 768px) {
    .compose-form { padding: 14px; }
    .compose-actions { flex-wrap: wrap; }
    .compose-actions .left, .compose-actions .right { width: 100%; }
    .compose-actions .right { justify-content: flex-end; }
  }
</style>
