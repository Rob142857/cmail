<script>
  import { deserialize, enhance } from '$app/forms';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { afterNavigate, beforeNavigate, goto, replaceState } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import EmailAutocomplete from '$lib/EmailAutocomplete.svelte';
  import EmailHtmlFrame from '$lib/mail/EmailHtmlFrame.svelte';
  let { data, form } = $props();
  /** @type {any} */
  const d = $derived(data);

  /** @param {string} json */
  function parseList(json) { try { const a = JSON.parse(json); return Array.isArray(a) ? a.join(', ') : ''; } catch { return ''; } }

  // Capture the initial route payload deliberately; later edits belong to the user.
  const initial = untrack(() => {
    const source = d.replyTo;
    const isNewReply = Boolean(source && !d.draft);
    return {
      subject: d.draft?.subject || (isNewReply
        ? d.isForward
          ? `Fwd: ${source.subject}`
          : /^re:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`
        : ''),
      to: d.draft ? parseList(d.draft.to_addresses) : isNewReply && !d.isForward ? d.replyRecipients.to.join(', ') : '',
      cc: d.draft ? parseList(d.draft.cc_addresses) : isNewReply && !d.isForward ? d.replyRecipients.cc.join(', ') : '',
      from: d.draft?.from_address || d.preferredFrom || d.mailboxes[0]?.address || '',
      body: d.draft?.body || '',
      quotedHtml: d.draft?.quoted_html || d.replyQuoteHtml || '',
      replySourceId: d.replySourceId || '',
      importance: d.draft?.importance || 'normal',
      draftId: d.draft?.id || '',
      draftVersion: d.draft?.draft_version ?? 0,
      recoveryKey: d.recoveryKey,
      recoveryId: d.recoveryId,
      draftSavedAt: d.draft?.saved_at || '',
      isUnsavedCompose: !d.draft,
      dirty: isNewReply,
    };
  });

  let subject = $state(initial.subject);
  let to = $state(initial.to);
  let cc = $state(initial.cc);
  let from = $state(initial.from);
  let body = $state(initial.body);
  let quotedHtml = $state(initial.quotedHtml);
  let importance = $state(initial.importance);
  let draftId = $state(initial.draftId);
  let draftVersion = $state(initial.draftVersion);
  let recoveryKey = $state(initial.recoveryKey);
  let recoveryReady = $state(false);
  /** @type {{ subject: string, to: string, cc: string, from: string, body: string, importance: 'low' | 'normal' | 'high' } | null} */
  let recoveryConflict = $state(null);

  /** D1 timestamps are UTC but omit the ISO separator and zone. */
  function utcTimestamp(value) {
    if (typeof value !== 'string' || !value) return 0;
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

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
    if (fileInput) fileInput.value = '';
  }
  /** @param {number} idx */
  function removeFile(idx) {
    attachedFiles = attachedFiles.filter((_, i) => i !== idx);
  }

  let saving = $state(false);
  /** @type {string} */
  let savedAt = $state('');
  let dirty = $state(initial.dirty);
  let editVersion = initial.dirty ? 1 : 0;
  let savedVersion = 0;
  /** @type {Promise<boolean> | null} */
  let activeSave = null;
  let navigationInProgress = $state(false);
  let allowNavigation = false;
  let discarding = $state(false);
  let knownServerSavedAt = $state(utcTimestamp(initial.draftSavedAt));
  let knownDraftVersion = $state(initial.draftVersion);
  let saveConflict = $state(false);
  // This handle is deliberately not reactive: effects write it while scheduling.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {(() => void) | null} */
  let resolveHistoryNavigation = null;

  afterNavigate(() => {
    resolveHistoryNavigation?.();
    resolveHistoryNavigation = null;
  });

  function hasDraftContent() {
    return Boolean(draftId || body || subject || to || cc || quotedHtml || importance !== 'normal');
  }

  function clearRecovery() {
    if (!browser || !recoveryKey) return;
    try {
      sessionStorage.removeItem(recoveryKey);
    } catch {
      // Some hardened browser profiles disable storage entirely.
    }
  }

  /** @param {unknown} value */
  function normalizeRecovery(value) {
    if (!value || typeof value !== 'object') return null;
    const saved = /** @type {Record<string, unknown>} */ (value);
    const hasSavedContent = ['subject', 'to', 'cc', 'from', 'body']
      .some((key) => typeof saved[key] === 'string' && saved[key].length > 0);
    const savedImportance = saved.importance === 'high' || saved.importance === 'low' ? saved.importance : 'normal';
    if (!hasSavedContent && savedImportance === 'normal') return null;
    const copy = {
      subject: typeof saved.subject === 'string' ? saved.subject.slice(0, 500) : '',
      to: typeof saved.to === 'string' ? saved.to.slice(0, 20_000) : '',
      cc: typeof saved.cc === 'string' ? saved.cc.slice(0, 20_000) : '',
      from: typeof saved.from === 'string' && d.mailboxes.some((mailbox) => mailbox.address === saved.from) ? saved.from : from,
      body: typeof saved.body === 'string' ? saved.body.slice(0, 1_000_000) : '',
      importance: savedImportance,
    };
    return copy;
  }

  /** @param {{ subject: string, to: string, cc: string, from: string, body: string, importance: 'low' | 'normal' | 'high' }} copy */
  function applyRecovery(copy) {
    subject = copy.subject;
    to = copy.to;
    cc = copy.cc;
    from = copy.from;
    body = copy.body;
    importance = copy.importance;
    recoveryConflict = null;
    markDirty();
  }

  function discardRecoveryConflict() {
    recoveryConflict = null;
    clearRecovery();
  }

  function writeRecoverySnapshot() {
    if (!browser || !recoveryKey) return false;
    try {
      sessionStorage.setItem(recoveryKey, JSON.stringify({
        subject,
        to,
        cc,
        from,
        body,
        importance,
        updatedAt: Date.now(),
        baseDraftVersion: knownDraftVersion,
      }));
      return true;
    } catch {
      return false;
    }
  }

  function reloadForDraftConflict() {
    if (!writeRecoverySnapshot() && !window.confirm('Browser recovery storage is unavailable. Reloading may lose this tab\'s unsaved text. Reload anyway?')) return;
    allowNavigation = true;
    window.location.reload();
  }

  onMount(() => {
    if (initial.isUnsavedCompose) {
      const current = new URL(window.location.href);
      if (current.searchParams.get('compose') !== initial.recoveryId) {
        current.searchParams.set('compose', initial.recoveryId);
        replaceState(`${current.pathname}?${current.searchParams}${current.hash}`, { ...page.state });
      }
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
      const recovery = normalizeRecovery(saved);
      const recoveryUpdatedAt = Number(saved?.updatedAt);
      const recoveryBaseVersion = Number(saved?.baseDraftVersion);
      const belongsToCurrentDraft = !d.draft
        || (Number.isSafeInteger(recoveryBaseVersion) && recoveryBaseVersion === knownDraftVersion);
      if (recovery && Number.isFinite(recoveryUpdatedAt) && belongsToCurrentDraft) {
        applyRecovery(recovery);
      } else if (recovery) {
        // A different tab saved a newer server revision. Keep both copies and
        // make restoration an explicit choice instead of losing either one.
        recoveryConflict = recovery;
      } else if (saved) {
        clearRecovery();
      }
    } catch {
      clearRecovery();
    } finally {
      recoveryReady = true;
    }
  });

  $effect(() => {
    void subject; void to; void cc; void from; void body; void importance; void dirty; void recoveryKey; void recoveryReady; void recoveryConflict; void saveConflict;
    if (!browser || !recoveryReady || !recoveryKey) return;
    // A conflict copy remains byte-for-byte untouched until the user makes an
    // explicit choice in the recovery banner.
    if (recoveryConflict) return;
    try {
      if (dirty || saveConflict) writeRecoverySnapshot();
      else sessionStorage.removeItem(recoveryKey);
    } catch {
      // Server autosave and the unload warning remain the primary safeguards
      // when storage is disabled or full.
    }
  });

  function attachmentLeaveConfirmed() {
    if (attachedFiles.length === 0) return true;
    const message = hasDraftContent()
      ? 'Save the text draft and leave? Attached files are not stored in drafts yet and will be removed from this compose window.'
      : 'Leave and remove the attached files? No text draft will be created.';
    return window.confirm(message);
  }

  /**
   * @param {string | URL} target
   * @param {boolean} [replaceCurrent]
   * @param {boolean} [preferHistoryBack]
   */
  async function saveAndNavigate(target, replaceCurrent = false, preferHistoryBack = false) {
    if (navigationInProgress || recoveryConflict || saveConflict) return;
    if (!attachmentLeaveConfirmed()) return;
    navigationInProgress = true;
    try {
      const neededSave = dirty && hasDraftContent();
      if (neededSave && !from) {
        if (!window.confirm('This draft cannot be saved because no sendable mailbox is available. Leave and lose these changes?')) return;
        dirty = false;
        clearRecovery();
      } else if (neededSave && !(await saveDraft(true))) {
        return;
      }
      allowNavigation = true;
      const message = draftId
        ? attachedFiles.length ? 'Text draft saved. Attachments were not included.' : 'Draft saved.'
        : attachedFiles.length ? 'Attachments removed. No draft was created.' : '';
      const destination = new URL(String(target), window.location.origin);
      const destinationPath = `${destination.pathname}${destination.search}`;
      const canUseHistoryBack = preferHistoryBack
        && page.state?.cmailComposeReturn === destinationPath;
      if (canUseHistoryBack) {
        if (message) {
          try { sessionStorage.setItem('cmail:pending-navigation-toast', message); } catch { /* toast is optional */ }
        }
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(fallback);
            resolveHistoryNavigation = null;
            resolve();
          };
          const fallback = setTimeout(finish, 1_500);
          resolveHistoryNavigation = finish;
          window.history.back();
        });
        if (window.location.pathname === '/mail/compose') {
          try { sessionStorage.removeItem('cmail:pending-navigation-toast'); } catch { /* optional */ }
          saveError = 'Could not return through browser history. Use Back again to return safely.';
        }
        return;
      }
      await goto(target, {
        replaceState: replaceCurrent,
        ...(message ? { state: { cmailToast: message } } : {}),
      });
    } finally {
      navigationInProgress = false;
      if (typeof window !== 'undefined' && window.location.pathname === '/mail/compose') allowNavigation = false;
    }
  }

  beforeNavigate(({ cancel, to, type, willUnload }) => {
    if (allowNavigation) return;
    if (sending || discarding || navigationInProgress) {
      cancel();
      return;
    }
    if (recoveryConflict || saveConflict) {
      cancel();
      return;
    }
    if (!dirty && attachedFiles.length === 0) return;
    if (willUnload || type === 'leave' || !to?.url) return;
    cancel();
    void saveAndNavigate(to.url, type === 'popstate', type === 'popstate');
  });

  /** @param {BeforeUnloadEvent} event */
  function warnBeforeUnload(event) {
    if (allowNavigation) return;
    if (!dirty && attachedFiles.length === 0 && !recoveryConflict && !saveConflict && !sending && !discarding && !navigationInProgress) return;
    event.preventDefault();
    event.returnValue = '';
  }

  /** @param {MouseEvent} event */
  function confirmDiscard(event) {
    if (!window.confirm('Discard this draft? This cannot be undone.')) {
      event.preventDefault();
      return;
    }
    discarding = true;
  }

  function markDirty() {
    editVersion += 1;
    dirty = true;
  }

  /** @param {string} id */
  function keepDraftInUrl(id) {
    const oldRecoveryKey = recoveryKey;
    const params = new URLSearchParams(window.location.search);
    if (params.get('draft') === id) return;
    params.set('draft', id);
    params.delete('compose');
    recoveryKey = `${d.recoveryPrefix}draft:${id}`;
    if (oldRecoveryKey && oldRecoveryKey !== recoveryKey) {
      try { sessionStorage.removeItem(oldRecoveryKey); } catch { /* server autosave remains authoritative */ }
    }
    replaceState(`/mail/compose?${params}`, { ...page.state });
  }

  function cancelAutosaveTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function scheduleAutosave() {
    cancelAutosaveTimer();
    if (!dirty || sending || saveConflict || !from || !hasDraftContent()) return;
    timer = setTimeout(() => {
      timer = null;
      void saveDraft(false);
    }, 1500);
  }

  /** Persist one immutable snapshot so continuous typing cannot hammer D1. */
  async function runSaveOnce() {
    saving = true;
    saveError = '';
    const savingVersion = editVersion;
    const snapshot = { from, to, cc, subject, body, quotedHtml, importance };
    try {
      const fd = new FormData();
      fd.set('from', snapshot.from);
      fd.set('to', snapshot.to);
      fd.set('cc', snapshot.cc);
      fd.set('subject', snapshot.subject || '(no subject)');
      fd.set('body', snapshot.body);
      fd.set('quoted_html', snapshot.quotedHtml);
      fd.set('importance', snapshot.importance);
      if (initial.replySourceId) fd.set('reply_source_id', initial.replySourceId);
      fd.set('draft_create_token', initial.recoveryId);
      if (draftId) {
        fd.set('draft_id', draftId);
        fd.set('draft_version', String(draftVersion));
      }
      const res = await fetch('?/save', {
        method: 'POST',
        body: fd,
        headers: { 'x-sveltekit-action': 'true', accept: 'application/json' },
      });
      const result = deserialize(await res.text());
      if (!res.ok || result.type !== 'success') {
        if (result.type === 'failure' && result.data?.draftConflict) saveConflict = true;
        throw new Error(result.type === 'failure' && result.data?.error ? result.data.error : 'Draft could not be saved');
      }
      const payload = result.data;
      if (payload?.savedDraftId) {
        const firstSave = !draftId;
        draftId = payload.savedDraftId;
        if (firstSave) keepDraftInUrl(draftId);
      }
      if (Number.isSafeInteger(payload?.draftVersion)) {
        draftVersion = payload.draftVersion;
        knownDraftVersion = payload.draftVersion;
      }
      saveConflict = false;
      knownServerSavedAt = utcTimestamp(payload?.savedAt) || Date.now();
      if (payload?.recoveredDraft) {
        // The original INSERT committed but its response was lost. We now know
        // the authoritative id/version; keep this snapshot dirty and CAS-save it.
        dirty = true;
      } else {
        savedVersion = Math.max(savedVersion, savingVersion);
        dirty = editVersion > savedVersion;
      }
      savedAt = new Date(knownServerSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return true;
    } catch (error) {
      saveError = saveConflict ? '' : error instanceof Error ? error.message : 'Draft could not be saved';
      dirty = true;
      return false;
    } finally {
      saving = false;
    }
  }

  /**
   * Manual and automatic save trigger. Concurrent callers share one request;
   * navigation flushes any revision written while that request was in flight.
   * @param {boolean} [flush]
   * @param {boolean} [allowDuringSend]
   */
  async function saveDraft(flush = false, allowDuringSend = false) {
    if (!from || !hasDraftContent() || saveConflict) return false;
    if (sending && !allowDuringSend) return activeSave ? await activeSave : false;
    cancelAutosaveTimer();
    if (activeSave) {
      const saved = await activeSave;
      return saved && flush && dirty ? saveDraft(true, allowDuringSend) : saved;
    }
    activeSave = runSaveOnce();
    /** @type {boolean} */
    let saved;
    try {
      saved = await activeSave;
    } finally {
      activeSave = null;
    }
    if (!saved) return false;
    if (flush && dirty) return saveDraft(true, allowDuringSend);
    if (dirty) scheduleAutosave();
    return true;
  }

  async function handleSubmit({ action, formData, cancel }) {
    if (action.search === '?/discard') {
      return async ({ result, update }) => {
        let redirected = false;
        try {
          if (result.type === 'redirect') {
            redirected = true;
            dirty = false;
            allowNavigation = true;
            clearRecovery();
          } else if (result.type === 'failure' && result.data?.draftConflict) {
            saveConflict = true;
          }
          await update();
        } finally {
          if (!redirected) {
            allowNavigation = false;
            discarding = false;
          }
        }
      };
    }

    if (sending) {
      cancel();
      return;
    }
    if (externalRecipients.length) {
      const recipientLabel = externalRecipients.length === 1 ? '1 external recipient' : `${externalRecipients.length} external recipients`;
      const attachmentLabel = attachedFiles.length ? ` with ${attachedFiles.length} ${attachedFiles.length === 1 ? 'attachment' : 'attachments'}` : '';
      if (!window.confirm(`Send this message${attachmentLabel} to ${recipientLabel}? Check that the content is appropriate to leave your organisation.`)) {
        cancel();
        return;
      }
    }

    sending = true;
    cancelAutosaveTimer();
    // An autosave that started first may have created the draft row. Await it
    // so the send can delete that exact draft instead of leaving an orphan.
    if (activeSave) await activeSave;
    if (!draftId && hasDraftContent() && !(await saveDraft(true, true))) {
      sending = false;
      cancel();
      return;
    }
    // `enhance` captured FormData before that await. Refresh every editable
    // value after the editor is frozen so Send always uses the newest revision.
    formData.set('from', from);
    formData.set('to', to);
    formData.set('cc', cc);
    formData.set('subject', subject);
    formData.set('body', body);
    formData.set('importance', importance);
    formData.set('draft_id', draftId);
    if (draftId) formData.set('draft_version', String(draftVersion));
    formData.set('quoted_html', quotedHtml);
    if (initial.replySourceId) formData.set('reply_source_id', initial.replySourceId);
    formData.delete('attachments');
    for (const file of attachedFiles) formData.append('attachments', file, file.name);

    return async ({ result, update }) => {
      try {
        if (result.type === 'redirect') {
          dirty = false;
          allowNavigation = true;
          clearRecovery();
        } else if (result.type === 'failure' && result.data?.draftConflict) {
          saveConflict = true;
        }
        await update();
      } finally {
        sending = false;
      }
    };
  }

  // Autosave shortly after the user pauses. A second pause is scheduled when
  // an edit lands during an in-flight request; navigation explicitly flushes it.
  $effect(() => {
    void body; void subject; void to; void cc; void from; void importance; void quotedHtml; void dirty; void sending;
    scheduleAutosave();
    return cancelAutosaveTimer;
  });
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

<div class="compose-page">
  <header class="compose-header">
    <h1>{d.draft ? 'Draft' : d.replyTo ? (d.isForward ? 'Forward' : d.isReplyAll ? 'Reply all' : 'Reply') : 'New message'}</h1>
    <div class="status" role="status" aria-live="polite">
      {#if saving}
        Saving…
      {:else if savedAt}
        Text saved at {savedAt}{dirty ? ' — unsaved changes' : attachedFiles.length ? ' — attachments remain in this tab' : ''}
      {:else if dirty}
        Unsaved changes
      {:else if attachedFiles.length}
        Attachments remain only in this tab
      {/if}
    </div>
  </header>

  {#if form?.error}
    <div class="form-error" role="alert">{form.error}</div>
  {/if}
  {#if saveError}<div class="form-error" role="alert">{saveError}</div>{/if}
  {#if saveConflict}
    <div class="recovery-warning" role="alert">
      <div>
        <strong>Draft changed in another tab</strong>
        <span>Your local text is retained. Reload the server version to compare it with this recovery copy.</span>
      </div>
      <div class="recovery-actions">
        <button type="button" class="btn btn-sm" onclick={reloadForDraftConflict}>Reload and compare</button>
      </div>
    </div>
  {/if}
  {#if d.quoteWarning}<div class="form-warning" role="status">{d.quoteWarning}</div>{/if}
  {#if d.isForward && d.forwardedAttachmentCount > 0}
    <div class="form-warning" role="alert">
      <p>The original message has {d.forwardedAttachmentCount} {d.forwardedAttachmentCount === 1 ? 'file or embedded image part' : 'file or embedded image parts'}. They are not forwarded automatically. Download only the parts you intend to resend, then add them below.</p>
      <ul class="forward-source-list">
        {#each d.forwardedAttachments as attachment}
          <li>
            <a href={`/api/attachment/${encodeURIComponent(attachment.id)}`}>Download {attachment.filename}</a>
            <span>{attachment.disposition === 'inline' ? 'Embedded image' : attachment.content_type || 'File'} · {fmtSize(attachment.size_bytes)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if !d.isForward && d.omittedReplyInlineImageCount > 0}
    <div class="form-warning" role="status">
      {d.omittedReplyInlineImageCount === 1 ? 'One embedded image from the original message is' : `${d.omittedReplyInlineImageCount} embedded images from the original message are`} not included in the quoted reply. The original remains available in the message view.
    </div>
  {/if}
  {#if recoveryConflict}
    <div class="recovery-warning" role="alert">
      <div>
        <strong>Local recovery copy available</strong>
        <span>Another tab saved a different version. The server draft is open and the local copy has been kept.</span>
      </div>
      <div class="recovery-actions">
        <button type="button" class="btn btn-sm" onclick={() => applyRecovery(recoveryConflict)} disabled={sending || discarding || navigationInProgress}>Restore local copy</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick={discardRecoveryConflict} disabled={sending || discarding || navigationInProgress}>Discard local copy</button>
      </div>
    </div>
  {/if}
  {#if d.mailboxes.length === 0}<div class="form-error" role="alert">You do not have a mailbox with send permission. Ask an administrator for access.</div>{/if}

  <form
    method="POST"
    action="?/send"
    use:enhance={handleSubmit}
    enctype="multipart/form-data"
    class="card compose-form"
    aria-busy={sending}
  >
    <input type="hidden" name="draft_id" value={draftId} />
    <input type="hidden" name="draft_version" value={draftVersion} />
    <input type="hidden" name="draft_create_token" value={initial.recoveryId} />
    <input type="hidden" name="compose_token" value={d.composeToken} />
    <input type="hidden" name="quoted_html" value={quotedHtml} />
      {#if initial.replySourceId}
        <input type="hidden" name="reply_source_id" value={initial.replySourceId} />
      {/if}

    <fieldset class="compose-fields" disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict || d.mailboxes.length === 0}>
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

    <div class="field importance-field">
      <label for="importance">Importance</label>
      <select name="importance" id="importance" bind:value={importance} oninput={markDirty}>
        <option value="normal">Normal</option>
        <option value="high">High — important</option>
        <option value="low">Low</option>
      </select>
      <small>Signals attention to compatible email clients; it does not speed up delivery.</small>
    </div>

    <div class="field">
      <label for="body">Message</label>
      <textarea name="body" id="body" bind:value={body} oninput={markDirty} rows="14" maxlength="1000000" placeholder="Write your message in plain text…"></textarea>
    </div>

    {#if quotedHtml}
      <section class="quoted-message" aria-labelledby="quoted-message-title">
        <div class="quoted-heading">
          <strong id="quoted-message-title">Original message</strong>
          <span>Formatting preserved · remote images removed for privacy</span>
        </div>
        <EmailHtmlFrame html={quotedHtml} title="Quoted original message" compact />
      </section>
    {/if}

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
      {/if}
      <p class="att-note">
        Max 25 files / 20 MB in cmail. Files remain only in this tab until sent and are not included in text draft saves; cmail warns before leaving. Downloads are forced, but files are not malware-scanned.
        {#if d.outboundProvider === 'cloudflare'} Cloudflare external delivery has a 5 MiB final-message limit including encoded body and attachments.{/if}
        {#if d.outboundProvider === 'postmark'} Postmark external delivery has a 10 MB final-message limit.{/if}
        {#if d.outboundProvider === 'none'} External delivery is not configured; attachments can still be sent to internal cmail mailboxes.{/if}
      </p>
    </div>

    {#if d.signature}
      <details class="signature-preview">
        <summary>Signature preview</summary>
        <iframe class="signature-body" title="Signature preview" sandbox="" srcdoc={d.signature}></iframe>
      </details>
    {/if}
    </fieldset>

    <div class="compose-actions">
      <div class="left">
        <button type="button" class="btn btn-ghost" onclick={() => saveAndNavigate(d.returnHref, true, true)} disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict}>
          {navigationInProgress ? 'Saving…' : d.replyTo ? '← Back to message' : '← Back to mail'}
        </button>
        {#if draftId}
          <button type="submit" formaction="?/discard" class="btn btn-ghost-danger" onclick={confirmDiscard} disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict}>
            {discarding ? 'Discarding…' : 'Discard draft'}
          </button>
        {/if}
      </div>
      <div class="right">
        <button type="button" class="btn" onclick={() => void saveDraft(true)} disabled={saving || sending || !!recoveryConflict || saveConflict || !from || !hasDraftContent()}>Save draft</button>
        <button type="submit" class="btn btn-primary" disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict || d.mailboxes.length === 0}>{sending ? 'Sending…' : 'Send'}</button>
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
  .form-warning {
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 13px;
  }
  .form-warning p { margin:0; }
  .forward-source-list { display:flex; flex-direction:column; gap:5px; margin:8px 0 0; padding:0; list-style:none; }
  .forward-source-list li { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
  .forward-source-list a { color:inherit; font-weight:650; overflow-wrap:anywhere; }
  .forward-source-list span { flex:0 0 auto; color:color-mix(in srgb, var(--warning) 78%, var(--text)); font-size:11px; }
  .recovery-warning { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:11px 14px; border:1px solid color-mix(in srgb, var(--warning) 35%, var(--border)); border-radius:var(--radius); background:var(--warning-soft); color:var(--warning); }
  .recovery-warning > div:first-child { display:flex; flex-direction:column; gap:2px; font-size:13px; }
  .recovery-warning span { color:color-mix(in srgb, var(--warning) 78%, var(--text)); }
  .recovery-actions { display:flex; flex:0 0 auto; gap:6px; }

  .compose-form { padding: 20px; }
  .compose-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
  .compose-form .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .compose-form label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .compose-form textarea { font-family: inherit; resize: vertical; min-height: 240px; }
  .importance-field { max-width:260px; }
  .importance-field small { color:var(--text-muted); font-size:11px; line-height:1.35; }
  .quoted-message { margin: 0 0 14px; }
  .quoted-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:6px; font-size:12px; }
  .quoted-heading strong { color:var(--text); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .quoted-heading span { color:var(--text-muted); }
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
  .compose-actions .left { display:flex; align-items:center; gap:8px; margin-right: auto; }
  .compose-actions .right { display: flex; gap: 8px; }
  .btn-ghost { background: transparent; border-color: transparent; }
  .btn-ghost:hover { background: var(--bg-hover); }
  .btn-ghost-danger { background: transparent; border-color: transparent; color: var(--danger); }
  .btn-ghost-danger:hover { background: #fee2e2; }

  @media (max-width: 768px) {
    .compose-form { padding: 14px; }
    .compose-actions { flex-wrap: wrap; }
    .compose-actions .left, .compose-actions .right { width: 100%; }
    .compose-actions .left { flex-wrap:wrap; }
    .compose-actions .right { justify-content: flex-end; }
    .quoted-heading { align-items:flex-start; flex-direction:column; gap:2px; }
    .recovery-warning { align-items:flex-start; flex-direction:column; }
    .recovery-actions { flex-wrap:wrap; }
  }
</style>
