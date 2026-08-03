<script>
  import { deserialize, enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { untrack } from 'svelte';
  import EmailAutocomplete from '$lib/EmailAutocomplete.svelte';
  import { formatQuoteDate } from '$lib/dates';
  let { data, form } = $props();
  /** @type {any} */
  const d = $derived(data);

  /** @param {string} json */
  function parseList(json) { try { const a = JSON.parse(json); return Array.isArray(a) ? a.join(', ') : ''; } catch { return ''; } }

  // Capture the initial route payload deliberately; later edits belong to the user.
  const initial = untrack(() => ({
    subject: d.draft?.subject || '',
    to: d.draft ? parseList(d.draft.to_addresses) : '',
    cc: d.draft ? parseList(d.draft.cc_addresses) : '',
    from: d.draft?.from_address || d.preferredFrom || d.mailboxes[0]?.address || '',
    body: d.draft?.body || '',
    draftId: d.draft?.id || '',
  }));

  let subject = $state(initial.subject);
  let to = $state(initial.to);
  let cc = $state(initial.cc);
  let from = $state(initial.from);
  let body = $state(initial.body);
  let draftId = $state(initial.draftId);

  function enteredAddresses(value) {
    return value.split(/[;,]/).map((item) => {
      const trimmed = item.trim().toLowerCase();
      const bracketed = trimmed.match(/<([^>]+)>/);
      return (bracketed?.[1] || trimmed).trim();
    }).filter((item) => item.includes('@'));
  }

  const externalRecipients = $derived.by(() => {
    const domain = (d.mailDomain || '').toLowerCase();
    return [...new Set([...enteredAddresses(to), ...enteredAddresses(cc)])]
      .filter((address) => !domain || !address.endsWith(`@${domain}`));
  });

  /** @type {File[]} */
  let attachedFiles = $state([]);
  /** @type {HTMLInputElement | null} */
  let fileInput = $state(null);
  let attachmentError = $state('');
  let saveError = $state('');
  let sending = $state(false);

  const BLOCKED_EXT = new Set(['.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1', '.msi', '.com', '.pif', '.hta', '.cpl', '.reg', '.inf', '.wsf']);
  const MAX_TOTAL = 20 * 1024 * 1024;

  /** @param {string} name */
  function getExt(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; }
  /** @param {number} n */
  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  /** @param {Event} e */
  function onFilesPicked(e) {
    attachmentError = '';
    const target = /** @type {HTMLInputElement} */ (e.target);
    const picked = Array.from(target.files || []);
    /** @type {File[]} */
    const next = [...attachedFiles];
    let total = next.reduce((s, f) => s + f.size, 0);
    for (const f of picked) {
      if (next.length >= 25) {
        attachmentError = 'A message can have at most 25 attachments';
        break;
      }
      const ext = getExt(f.name);
      if (BLOCKED_EXT.has(ext)) {
        attachmentError = `Blocked file type: ${ext} (${f.name})`;
        continue;
      }
      if (total + f.size > MAX_TOTAL) {
        attachmentError = `Attachments exceed 20 MB total limit`;
        continue;
      }
      // de-dupe by name+size
      if (next.some(x => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
      total += f.size;
    }
    attachedFiles = next;
    markDirty();
    if (fileInput) fileInput.value = '';
  }
  /** @param {number} idx */
  function removeFile(idx) {
    attachedFiles = attachedFiles.filter((_, i) => i !== idx);
    markDirty();
  }

  let saving = $state(false);
  /** @type {string} */
  let savedAt = $state('');
  let dirty = $state(false);

  beforeNavigate(({ cancel }) => {
    if (!dirty || sending) return;
    if (!window.confirm('Leave this message? Changes since the last draft save will be lost.')) cancel();
    else dirty = false;
  });

  /** @param {BeforeUnloadEvent} event */
  function warnBeforeUnload(event) {
    if (!dirty || sending) return;
    event.preventDefault();
    event.returnValue = '';
  }

  /** @param {MouseEvent} event */
  function confirmDiscard(event) {
    if (!window.confirm('Discard this draft? This cannot be undone.')) {
      event.preventDefault();
      return;
    }
    dirty = false;
  }

  // Pre-fill from reply/forward (only if no draft)
  $effect(() => {
    if (d.draft) return;
    if (d.replyTo) {
      if (d.isForward) {
        subject = `Fwd: ${d.replyTo.subject}`;
        body = `\n\n---------- Forwarded message ----------\n${d.replyBody}`;
      } else {
        subject = d.replyTo.subject.startsWith('Re:') ? d.replyTo.subject : `Re: ${d.replyTo.subject}`;
        to = d.replyTo.from_address;
        const quoted = d.replyBody.split('\n').map((line) => `> ${line}`).join('\n');
        body = `\n\nOn ${formatQuoteDate(d.replyTo.received_at, d.locale, d.timeZone)}, ${d.replyTo.from_address} wrote:\n${quoted}`;
      }
    }
  });

  function markDirty() { dirty = true; }

  /** Manual save trigger; returns when the request finishes */
  async function saveDraft() {
    if (saving) return;
    saving = true;
    saveError = '';
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
      const result = deserialize(await res.text());
      if (result.type !== 'success') throw new Error(result.type === 'failure' && result.data?.error ? result.data.error : 'Draft could not be saved');
      const payload = result.data;
      if (payload?.savedDraftId) draftId = payload.savedDraftId;
      savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      dirty = false;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Draft could not be saved';
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

<svelte:window onbeforeunload={warnBeforeUnload} />

<div class="compose-page">
  <header class="compose-header">
    <h1>{d.draft ? 'Draft' : d.replyTo ? (d.isForward ? 'Forward' : 'Reply') : 'New message'}</h1>
    <div class="status" role="status" aria-live="polite">
      {#if saving}
        Saving…
      {:else if savedAt}
        Text saved at {savedAt}{dirty ? ' — unsaved changes' : attachedFiles.length ? ' — attachments remain in this tab' : ''}
      {:else if dirty}
        Unsaved changes
      {/if}
    </div>
  </header>

  {#if form?.error}
    <div class="form-error" role="alert">{form.error}</div>
  {/if}
  {#if saveError}<div class="form-error" role="alert">{saveError}</div>{/if}
  {#if d.mailboxes.length === 0}<div class="form-error" role="alert">You do not have a mailbox with send permission. Ask an administrator for access.</div>{/if}

  <form
    method="POST"
    action="?/send"
    use:enhance={({ formData, cancel }) => {
      if (sending) { cancel(); return; }
      if (externalRecipients.length) {
        const recipientLabel = externalRecipients.length === 1 ? '1 external recipient' : `${externalRecipients.length} external recipients`;
        const attachmentLabel = attachedFiles.length ? ` with ${attachedFiles.length} ${attachedFiles.length === 1 ? 'attachment' : 'attachments'}` : '';
        if (!window.confirm(`Send this message${attachmentLabel} to ${recipientLabel}? Check that the content is appropriate to leave your organisation.`)) {
          cancel();
          return;
        }
      }
      sending = true;
      // Replace any input-attached files with our staged list (input is cleared after each pick).
      formData.delete('attachments');
      for (const f of attachedFiles) formData.append('attachments', f, f.name);
      return async ({ update }) => {
        try {
          await update();
        } finally {
          sending = false;
        }
      };
    }}
    enctype="multipart/form-data"
    class="card compose-form"
    aria-busy={sending}
  >
    <input type="hidden" name="draft_id" value={draftId} />
    <input type="hidden" name="compose_token" value={d.composeToken} />
    {#if d.replyTo}
      <input type="hidden" name="in_reply_to" value={d.replyTo.message_id_header} />
    {/if}

    <div class="field">
      <label for="from">From</label>
      <select name="from" id="from" bind:value={from} oninput={markDirty} required disabled={d.mailboxes.length === 0}>
        {#each d.mailboxes as mb}
          <option value={mb.address}>{mb.display_name ? `${mb.display_name} <${mb.address}>` : mb.address}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="to">To</label>
      <EmailAutocomplete bind:value={to} name="to" id="to" placeholder="recipient@example.com, another@example.com" required multi oninput={markDirty} />
    </div>

    <div class="field">
      <label for="cc">Cc</label>
      <EmailAutocomplete bind:value={cc} name="cc" id="cc" placeholder="optional" multi oninput={markDirty} />
    </div>

    {#if externalRecipients.length > 0}
      <div class="external-warning" role="status">
        <strong>{externalRecipients.length} external {externalRecipients.length === 1 ? 'recipient' : 'recipients'}</strong>
        <span>{externalRecipients.join(', ')}</span>
        <small>You will be asked to confirm before this message leaves {d.mailDomain || 'the organisation'}.</small>
      </div>
    {/if}

    <div class="field">
      <label for="subject">Subject</label>
      <input type="text" name="subject" id="subject" bind:value={subject} oninput={markDirty} maxlength="500" placeholder="Subject (optional)" />
    </div>

    <div class="field">
      <label for="body">Message</label>
      <textarea name="body" id="body" bind:value={body} oninput={markDirty} rows="14" maxlength="1000000" placeholder="Write your message in plain text…"></textarea>
    </div>

    <div class="attachments">
      <div class="attachments-head">
        <span class="attachments-label">Attachments</span>
        <button type="button" class="btn" onclick={() => fileInput?.click()}>📎 Add files</button>
        <input
          type="file"
          name="attachments"
          multiple
          bind:this={fileInput}
          onchange={onFilesPicked}
          style="display: none;"
        />
      </div>
      {#if attachmentError}
        <div class="attachment-error" role="alert">{attachmentError}</div>
      {/if}
      {#if attachedFiles.length > 0}
        <ul class="attachment-list">
          {#each attachedFiles as f, i}
            <li>
              <span class="att-name">📄 {f.name}</span>
              <span class="att-size">{fmtSize(f.size)}</span>
              <button type="button" class="att-remove" onclick={() => removeFile(i)} aria-label="Remove {f.name}">✕</button>
            </li>
          {/each}
        </ul>
        <p class="att-note">Max 25 files / 20 MB total. Files remain in this tab until sent and are not included in saved drafts. Downloads are forced, but files are not malware-scanned.</p>
      {/if}
    </div>

    {#if d.signature}
      <details class="signature-preview">
        <summary>Signature preview</summary>
        <iframe class="signature-body" title="Signature preview" sandbox="" srcdoc={d.signature}></iframe>
      </details>
    {/if}

    <div class="compose-actions">
      <div class="left">
        {#if draftId}
          <button type="submit" formaction="?/discard" class="btn btn-ghost-danger" onclick={confirmDiscard}>Discard draft</button>
        {:else}
          <a href="/mail" class="btn btn-ghost">Cancel</a>
        {/if}
      </div>
      <div class="right">
        <button type="button" class="btn" onclick={saveDraft} disabled={saving || !from}>Save draft</button>
        <button type="submit" class="btn btn-primary" disabled={sending || d.mailboxes.length === 0}>{sending ? 'Sending…' : 'Send'}</button>
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
  .external-warning { display: flex; flex-direction: column; gap: 2px; margin: -2px 0 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border)); border-radius: var(--radius); background: var(--warning-soft); color: var(--warning); font-size: 12px; }
  .external-warning span { overflow-wrap: anywhere; }
  .external-warning small { color: color-mix(in srgb, var(--warning) 78%, var(--text)); }

  .signature-preview { font-size: 13px; margin: 4px 0 12px; }
  .signature-preview summary { cursor: pointer; color: var(--text-muted); }
  .signature-body { display:block; width:100%; min-height:100px; padding:0; background:#fff; border:1px solid var(--border); border-radius:var(--radius); margin-top:6px; }

  .attachments { margin: 0 0 14px; }
  .attachments-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .attachments-label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .attachment-list { list-style: none; padding: 0; margin: 8px 0 4px; display: flex; flex-direction: column; gap: 6px; }
  .attachment-list li {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .att-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att-size { color: var(--text-muted); font-size: 12px; flex: 0 0 auto; }
  .att-remove {
    background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; padding: 2px 6px; font-size: 14px; line-height: 1;
    border-radius: 4px;
  }
  .att-remove:hover { background: rgba(255,255,255,0.08); color: var(--text); }
  .att-note { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; }
  .attachment-error {
    padding: 6px 10px; font-size: 12px;
    background: #fee2e2; color: #991b1b;
    border-radius: var(--radius);
    margin-bottom: 8px;
  }

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
