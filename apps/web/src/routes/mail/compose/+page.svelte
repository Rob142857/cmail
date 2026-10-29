<script>
  import { deserialize, enhance } from '$app/forms';
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { afterNavigate, beforeNavigate, goto, replaceState } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import EmailAutocomplete from '#lib/EmailAutocomplete.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import { signaturePreviewDocument } from '#lib/signature-preview.js';
  import EmailHtmlFrame from '#lib/mail/EmailHtmlFrame.svelte';
  import RichTextEditor from '#lib/RichTextEditor.svelte';
  import { plainTextToRichHtml, richDocToPlainText } from '#lib/rich-text.js';
  let { data, form } = $props();

  const FORMAT_PREFERENCE_KEY = 'cmail:compose-format';
  /** @returns {'text' | 'html'} */
  function preferredFormat() {
    if (!browser) return 'html';
    try {
      return localStorage.getItem(FORMAT_PREFERENCE_KEY) === 'text' ? 'text' : 'html';
    } catch {
      return 'html';
    }
  }
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
      // Replies never inherit Bcc — buildReplyRecipients() deliberately never
      // returns one, so a reply/forward always starts with an empty Bcc field.
      bcc: d.draft ? parseList(d.draft.bcc_addresses) : '',
      from: d.draft?.from_address || d.preferredFrom || d.mailboxes[0]?.address || '',
      body: d.draft?.body || '',
      // A saved draft keeps the mode it was written in; a new message uses the
      // person's last choice (rich text unless they switched it off).
      // (The stored preference is applied in onMount so SSR and hydration agree.)
      bodyFormat: d.draft ? (d.draft.body_format === 'html' ? 'html' : 'text') : 'html',
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
  let bcc = $state(initial.bcc);
  let showBcc = $state(Boolean(initial.bcc));
  let from = $state(initial.from);
  let body = $state(initial.body);
  /** @type {'text' | 'html'} */
  let bodyFormat = $state(initial.bodyFormat);
  // Remounts the rich-text editor when its content is replaced from outside
  // (recovery restore or a mode switch); the editor owns its content otherwise.
  let editorKey = $state(0);
  /** @type {{ getJson: () => any } | null} */
  let richApi = null;
  let richEditorFailed = $state(false);
  let quotedHtml = $state(initial.quotedHtml);
  let importance = $state(initial.importance);
  let draftId = $state(initial.draftId);
  let draftVersion = $state(initial.draftVersion);
  let recoveryKey = $state(initial.recoveryKey);
  let recoveryReady = $state(false);
  /** @type {{ subject: string, to: string, cc: string, bcc: string, from: string, body: string, bodyFormat: 'text' | 'html', importance: 'low' | 'normal' | 'high' } | null} */
  let recoveryConflict = $state(null);

  /** D1 timestamps are UTC but omit the ISO separator and zone. */
  function utcTimestamp(value) {
    if (typeof value !== 'string' || !value) return 0;
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

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
        attachmentError = 'Max 25 attachments per message';
        break;
      }
      const ext = getExt(f.name);
      if (BLOCKED_EXT.has(ext)) {
        attachmentError = `Blocked file type: ${ext} (${f.name})`;
        continue;
      }
      if (total + f.size > MAX_TOTAL) {
        attachmentError = `Attachments exceed 20 MB limit`;
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

  let composeUrlSynced = false;

  afterNavigate(() => {
    resolveHistoryNavigation?.();
    resolveHistoryNavigation = null;
    // Pin the recovery id in the URL so a reload restores this compose. This
    // must not run in onMount: on a full page load the root component's mount
    // effects flush inside SvelteKit's `new Root()`, before the router has a
    // root to update, so replaceState() throws and leaves the router broken
    // (later replaceState/goto/form updates all fail and Send can't finish).
    // afterNavigate only fires once the router is ready, on hydration and on
    // client-side navigation alike.
    if (composeUrlSynced) return;
    composeUrlSynced = true;
    // During hydration SvelteKit runs afterNavigate callbacks a moment before
    // it marks the router started, and dev builds refuse replaceState until
    // then. A microtask runs right after start-up in every build.
    queueMicrotask(() => {
      if (!initial.isUnsavedCompose || draftId) return;
      const current = new URL(window.location.href);
      if (current.searchParams.get('compose') !== initial.recoveryId) {
        current.searchParams.set('compose', initial.recoveryId);
        try {
          replaceState(`${current.pathname}?${current.searchParams}${current.hash}`, { ...page.state });
        } catch {
          // The id only helps reload recovery; autosave stays authoritative.
        }
      }
    });
  });

  function hasDraftContent() {
    return Boolean(draftId || body || subject || to || cc || bcc || quotedHtml || importance !== 'normal');
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
    const hasSavedContent = ['subject', 'to', 'cc', 'bcc', 'from', 'body']
      .some((key) => typeof saved[key] === 'string' && saved[key].length > 0);
    const savedImportance = saved.importance === 'high' || saved.importance === 'low' ? saved.importance : 'normal';
    if (!hasSavedContent && savedImportance === 'normal') return null;
    const copy = {
      subject: typeof saved.subject === 'string' ? saved.subject.slice(0, 500) : '',
      to: typeof saved.to === 'string' ? saved.to.slice(0, 20_000) : '',
      cc: typeof saved.cc === 'string' ? saved.cc.slice(0, 20_000) : '',
      bcc: typeof saved.bcc === 'string' ? saved.bcc.slice(0, 20_000) : '',
      from: typeof saved.from === 'string' && d.mailboxes.some((mailbox) => mailbox.address === saved.from) ? saved.from : from,
      body: typeof saved.body === 'string' ? saved.body.slice(0, 1_000_000) : '',
      // Snapshots written before rich text existed hold plain text.
      bodyFormat: saved.bodyFormat === 'html' ? 'html' : 'text',
      importance: savedImportance,
    };
    return copy;
  }

  /** @param {{ subject: string, to: string, cc: string, bcc: string, from: string, body: string, bodyFormat: 'text' | 'html', importance: 'low' | 'normal' | 'high' }} copy */
  function applyRecovery(copy) {
    subject = copy.subject;
    to = copy.to;
    cc = copy.cc;
    bcc = copy.bcc;
    if (copy.bcc) showBcc = true;
    from = copy.from;
    body = copy.body;
    bodyFormat = copy.bodyFormat;
    editorKey += 1;
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
        bcc,
        from,
        body,
        bodyFormat,
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
    if (!writeRecoverySnapshot() && !window.confirm('Recovery storage unavailable — reloading may lose unsaved text in this tab. Reload anyway?')) return;
    allowNavigation = true;
    window.location.reload();
  }

  onMount(() => {
    // Start a new message in the person's preferred mode. A draft, reply text
    // or restored copy decides its own mode instead.
    if (!d.draft && !body && preferredFormat() === 'text') bodyFormat = 'text';
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
    void subject; void to; void cc; void bcc; void from; void body; void bodyFormat; void importance; void dirty; void recoveryKey; void recoveryReady; void recoveryConflict; void saveConflict;
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
      ? 'Save the text draft and leave? Attachments aren\'t saved in drafts and will be removed.'
      : 'Leave and remove attached files? No draft will be created.';
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
        if (!window.confirm('Can\'t save this draft — no sendable mailbox available. Leave and lose these changes?')) return;
        dirty = false;
        clearRecovery();
      } else if (neededSave && !(await saveDraft(true))) {
        return;
      }
      allowNavigation = true;
      const message = draftId
        ? attachedFiles.length ? 'Draft saved. Attachments weren\'t included.' : 'Draft saved.'
        : attachedFiles.length ? 'Attachments removed. No draft created.' : '';
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
          saveError = 'Couldn\'t go back automatically. Press Back again.';
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
    if (!window.confirm('Discard this draft? Can\'t be undone.')) {
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
    const snapshot = { from, to, cc, bcc, subject, body, bodyFormat, quotedHtml, importance };
    try {
      const fd = new FormData();
      fd.set('from', snapshot.from);
      fd.set('to', snapshot.to);
      fd.set('cc', snapshot.cc);
      fd.set('bcc', snapshot.bcc);
      fd.set('subject', snapshot.subject || '(no subject)');
      fd.set('body', snapshot.body);
      fd.set('body_format', snapshot.bodyFormat);
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
        throw new Error(result.type === 'failure' && result.data?.error ? result.data.error : 'Couldn\'t save draft');
      }
      const payload = result.data;
      const firstSave = Boolean(payload?.savedDraftId) && !draftId;
      if (payload?.savedDraftId) draftId = payload.savedDraftId;
      if (Number.isSafeInteger(payload?.draftVersion)) {
        draftVersion = payload.draftVersion;
        knownDraftVersion = payload.draftVersion;
      }
      // The save has committed; record the new id/version before touching the
      // URL so a URL bookkeeping failure can never leave a stale version that
      // the next save or Send reports as a conflict.
      if (firstSave) {
        try {
          keepDraftInUrl(draftId);
        } catch {
          // The URL only helps reload recovery; the server draft is saved.
        }
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
      saveError = saveConflict ? '' : error instanceof Error ? error.message : 'Couldn\'t save draft';
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
    formData.set('bcc', bcc);
    formData.set('subject', subject);
    formData.set('body', body);
    formData.set('body_format', bodyFormat);
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

  /** @param {'text' | 'html'} next */
  function switchFormat(next) {
    if (next === bodyFormat) return;
    if (next === 'text') {
      if (body && !window.confirm('Switch to plain text? Bold, italics, underline, links and lists will be removed from this message.')) return;
      body = !body ? '' : richApi ? richDocToPlainText(richApi.getJson()) : htmlTextContent(body);
    } else {
      body = plainTextToRichHtml(body);
    }
    bodyFormat = next;
    richApi = null;
    editorKey += 1;
    try { localStorage.setItem(FORMAT_PREFERENCE_KEY, next); } catch { /* preference is optional */ }
    if (body) markDirty();
  }

  /**
   * Text of stored rich-text HTML when the editor isn't available to ask.
   * DOMParser documents are inert: nothing in them loads or runs.
   * @param {string} html
   */
  function htmlTextContent(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const br of parsed.body.querySelectorAll('br')) br.replaceWith('\n');
    for (const block of parsed.body.querySelectorAll('p, li, blockquote, div')) block.append('\n');
    return (parsed.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** The editor bundle couldn't load: keep the text and carry on in plain text. */
  function richEditorUnavailable() {
    richEditorFailed = true;
    if (bodyFormat !== 'html') return;
    if (body) {
      body = htmlTextContent(body);
      markDirty();
    }
    bodyFormat = 'text';
  }

  // Autosave shortly after the user pauses. A second pause is scheduled when
  // an edit lands during an in-flight request; navigation explicitly flushes it.
  $effect(() => {
    void body; void bodyFormat; void subject; void to; void cc; void bcc; void from; void importance; void quotedHtml; void dirty; void sending;
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
        Text saved at {savedAt}{dirty ? ' — unsaved changes' : attachedFiles.length ? ' — attachments stay in this tab' : ''}
      {:else if dirty}
        Unsaved changes
      {:else if attachedFiles.length}
        Attachments stay only in this tab
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
        <span>Your local text is kept. Reload to compare with the server version.</span>
      </div>
      <div class="recovery-actions">
        <button type="button" class="btn btn-sm" onclick={reloadForDraftConflict}>Reload and compare</button>
      </div>
    </div>
  {/if}
  {#if d.quoteWarning}<div class="form-warning" role="status">{d.quoteWarning}</div>{/if}
  {#if d.isForward && d.forwardedAttachmentCount > 0}
    <div class="form-warning" role="alert">
      <p>The original message has {d.forwardedAttachmentCount} {d.forwardedAttachmentCount === 1 ? 'file or embedded image part' : 'file or embedded image parts'}, not forwarded automatically. Download the ones you want to resend, then add them below.</p>
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
      {d.omittedReplyInlineImageCount === 1 ? 'One embedded image from the original message is' : `${d.omittedReplyInlineImageCount} embedded images from the original message are`} not in the quoted reply. See the original message to view it.
    </div>
  {/if}
  {#if recoveryConflict}
    <div class="recovery-warning" role="alert">
      <div>
        <strong>Local recovery copy available</strong>
        <span>Another tab saved a different version. This is the server draft; your local copy is kept.</span>
      </div>
      <div class="recovery-actions">
        <button type="button" class="btn btn-sm" onclick={() => applyRecovery(recoveryConflict)} disabled={sending || discarding || navigationInProgress}>Restore local copy</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick={discardRecoveryConflict} disabled={sending || discarding || navigationInProgress}>Discard local copy</button>
      </div>
    </div>
  {/if}
  {#if d.mailboxes.length === 0}<div class="form-error" role="alert">No mailbox with send permission. Ask an administrator for access.</div>{/if}

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
    <div class="header-lines">
      <div class="line">
        <label for="from">From</label>
        <select name="from" id="from" bind:value={from} oninput={markDirty} required disabled={d.mailboxes.length === 0}>
          {#each d.mailboxes as mb}
            <option value={mb.address}>{mb.display_name ? `${mb.display_name} <${mb.address}>` : mb.address}</option>
          {/each}
        </select>
      </div>

      <div class="line">
        <label for="to">To</label>
        <EmailAutocomplete bind:value={to} name="to" id="to" placeholder="" required multi mailbox={from} oninput={markDirty} />
      </div>

      <div class="line">
        <label for="cc">Cc</label>
        <EmailAutocomplete bind:value={cc} name="cc" id="cc" placeholder="" multi mailbox={from} oninput={markDirty} />
        {#if !showBcc}
          <button type="button" class="bcc-toggle" onclick={() => (showBcc = true)}>Bcc</button>
        {/if}
      </div>

      {#if showBcc}
        <div class="line">
          <label for="bcc">Bcc</label>
          <EmailAutocomplete bind:value={bcc} name="bcc" id="bcc" placeholder="" multi mailbox={from} oninput={markDirty} />
        </div>
      {/if}

      <div class="line">
        <label for="subject" class="sr-only">Subject</label>
        <input type="text" name="subject" id="subject" class="subject-input" bind:value={subject} oninput={markDirty} maxlength="500" placeholder="Add a subject" spellcheck="true" autocapitalize="sentences" />
        <label for="importance" class="sr-only">Importance</label>
        <select name="importance" id="importance" class="importance-select" class:raised={importance !== 'normal'} bind:value={importance} oninput={markDirty} title="Importance is shown in compatible email clients; it doesn't speed up delivery.">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
    </div>

    <div class="field body-field">
      <div class="field-label-row">
        <label for="body" id="body-label" class="sr-only">Message</label>
        <div class="format-toggle" role="group" aria-label="Message format">
          <button type="button" aria-pressed={bodyFormat === 'html'} onclick={() => switchFormat('html')} disabled={richEditorFailed}>Rich text</button>
          <button type="button" aria-pressed={bodyFormat === 'text'} onclick={() => switchFormat('text')}>Plain text</button>
        </div>
      </div>
      <input type="hidden" name="body_format" value={bodyFormat} />
      {#if bodyFormat === 'html'}
        <input type="hidden" name="body" value={body} />
        {#key editorKey}
          <RichTextEditor
            id="body"
            value={body}
            defaults={d.composeDefaults}
            disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict || d.mailboxes.length === 0}
            onchange={(html) => { if (html !== body) { body = html; markDirty(); } }}
            onready={(api) => { richApi = api; }}
            onfailed={richEditorUnavailable}
          />
        {/key}
      {:else}
        <textarea name="body" id="body" bind:value={body} oninput={markDirty} rows="14" maxlength="1000000" placeholder="Write in plain text…" spellcheck="true" autocapitalize="sentences"></textarea>
      {/if}
      {#if richEditorFailed}<small class="format-note">The formatting editor couldn't load, so this message is in plain text.</small>{/if}
    </div>

    {#if d.signature}
      <details class="signature-preview">
        <summary>
          <span class="signature-summary-copy">
            <strong>Email signature</strong>
            <small>Personal first, then organisation</small>
          </span>
          {#if d.effectiveSignature?.personalLocked}<span class="signature-lock">Admin managed</span>{/if}
        </summary>
        <div class="signature-preview-body">
          <p class="signature-help">Added below your message and above quoted history when you send.</p>
          <div class="signature-layers">
            {#if d.effectiveSignature?.personalHtml}
              <section class="signature-layer">
                <span>1 · Personal</span>
                <iframe title="Personal signature preview" sandbox="" srcdoc={signaturePreviewDocument(d.effectiveSignature.personalHtml)}></iframe>
              </section>
            {/if}
            {#if d.effectiveSignature?.organisationHtml}
              <section class="signature-layer signature-layer-org">
                <span>2 · Organisation</span>
                <iframe title="Organisation signature preview" sandbox="" srcdoc={signaturePreviewDocument(d.effectiveSignature.organisationHtml)}></iframe>
              </section>
            {/if}
          </div>
          <div class="signature-footer">
            <span>Kept outside your message so it can't be changed by accident.</span>
            <a href="/mail/settings">{d.effectiveSignature?.personalLocked ? 'View signature settings' : 'Manage personal signature'}</a>
          </div>
        </div>
      </details>
    {/if}

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
        <button type="button" class="btn" onclick={() => fileInput?.click()}><Icon name="attach" size={16} /> Add files</button>
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
              <span class="att-name"><Icon name="document" size={14} /> {f.name}</span>
              <span class="att-size">{fmtSize(f.size)}</span>
              <button type="button" class="att-remove" onclick={() => removeFile(i)} aria-label="Remove {f.name}"><Icon name="close" size={14} /></button>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="att-note">
        Max 25 files / 20 MB. Files stay in this tab until sent and aren't included in draft saves — cmail warns before you leave. Downloads are forced but not malware-scanned.
        {#if d.outboundProvider === 'cloudflare'} Cloudflare delivery has a 5 MiB limit for the whole encoded message.{/if}
        {#if d.outboundProvider === 'postmark'} Postmark delivery has a 10 MB message limit.{/if}
        {#if d.outboundProvider === 'none'} External delivery isn't set up; attachments can still go to internal cmail mailboxes.{/if}
      </p>
    </div>

    </fieldset>

    <div class="compose-actions">
      <div class="left">
        <button type="button" class="btn btn-ghost secondary-action" onclick={() => saveAndNavigate(d.returnHref, true, true)} disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict}>
          <Icon name="arrowLeft" size={16} />
          <span class="action-label">{navigationInProgress ? 'Saving…' : d.replyTo ? 'Back to message' : 'Back to mail'}</span>
        </button>
        {#if draftId}
          <button type="submit" formaction="?/discard" class="btn btn-ghost-danger secondary-action" onclick={confirmDiscard} disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict}>
            <Icon name="trash" size={16} />
            <span class="action-label">{discarding ? 'Discarding…' : 'Discard draft'}</span>
          </button>
        {/if}
      </div>
      <div class="right">
        <button type="button" class="btn" onclick={() => void saveDraft(true)} disabled={saving || sending || !!recoveryConflict || saveConflict || !from || !hasDraftContent()}>Save draft</button>
        <button type="submit" class="btn btn-primary send-button" disabled={sending || discarding || navigationInProgress || !!recoveryConflict || saveConflict || d.mailboxes.length === 0}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  </form>
</div>

<style>
  /* Fill the pane up to a generous column (Rob, 29 Oct: 820px left dead space on wide screens). */
  .compose-page { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .compose-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .compose-header h1 { font-size: 20px; margin: 0; font-weight: 600; }
  .status { font-size: 12px; color: var(--text-muted); }

  .form-error {
    padding: 10px 14px;
    background: var(--danger-soft);
    color: var(--danger-text);
    border-radius: var(--radius);
    font-size: 14px;
  }
  .form-warning {
    padding: 10px 14px;
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
  .recovery-warning { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:11px 14px; border-radius:var(--radius); background:var(--warning-soft); color:var(--warning); }
  .recovery-warning > div:first-child { display:flex; flex-direction:column; gap:2px; font-size:13px; }
  .recovery-warning span { color:color-mix(in srgb, var(--warning) 78%, var(--text)); }
  .recovery-actions { display:flex; flex:0 0 auto; gap:6px; }

  /* No card: the page background and spacing frame the message (Rob, 29 Oct). */
  .compose-form.card { padding: 0; border-color: transparent; border-radius: 0; background: transparent; box-shadow: none; }
  .compose-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
  .compose-form .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .compose-form label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .field-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .bcc-toggle {
    padding: 0; border: 0; background: none;
    color: var(--primary-text); font-size: 12px; font-weight: 500;
    cursor: pointer;
  }
  .bcc-toggle:hover { text-decoration: underline; }
  .compose-form textarea { font-family: inherit; resize: vertical; min-height: 240px; }

  /* Outlook-style header: each field is one typed-on line with a hairline
     rule, not a boxed input; the message body takes the rest of the page. */
  .header-lines { margin: -4px 0 12px; }
  .line { display: flex; align-items: center; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--border); }
  .line:focus-within { border-bottom-color: var(--primary); }
  .compose-form .line > label { flex: 0 0 44px; margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .line > :global(.ac-wrap) { flex: 1 1 auto; min-width: 0; }
  .line select, .line input, .line :global(.ac-wrap input) {
    min-height: 40px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none;
  }
  .line select:focus, .line input:focus, .line :global(.ac-wrap input:focus) { border: 0; padding-bottom: 0; }
  .line #from { flex: 1 1 auto; min-width: 0; text-overflow: ellipsis; cursor: pointer; }
  .subject-input { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 600; }
  .importance-select { flex: 0 0 auto; width: auto; color: var(--text-muted); font-size: 12px; cursor: pointer; }
  .importance-select.raised { color: var(--warning); font-weight: 600; }
  .body-field .field-label-row { justify-content: flex-end; }
  /* Editor without a frame: the toolbar sits on the page, buttons have no
     boxes (hover and pressed are tones), and the white writing paper is the
     only boundary. Focus shows as the same primary underline as the lines. */
  .body-field :global(.rich-text) { border-color: transparent; background: transparent; }
  .body-field :global(.rich-text:focus-within) { border-color: transparent; box-shadow: none; }
  .body-field :global(.toolbar-wrap) { border-bottom-color: transparent; border-radius: 0; background: var(--bg); }
  .body-field :global(.toolbar) { padding-inline: 0; }
  .body-field :global(.tb:hover:not(:disabled)) { border-color: transparent; }
  .body-field :global(.tb[aria-pressed='true']), .body-field :global(.tb[aria-expanded='true']) { border-color: transparent; }
  .body-field :global(.tb-select) { border-color: transparent; background-color: transparent; }
  .body-field :global(.tb-select:hover) { border-color: transparent; background-color: var(--bg-hover); }
  .body-field :global(.tb-select:focus) { border-color: transparent; border-bottom-color: var(--primary); }
  /* Transparent selects can open a white list in dark mode on Windows. */
  .body-field :global(.tb-select option) { background: var(--bg-surface); color: var(--text); }
  .body-field :global(.sep) { background: var(--divider); }
  .body-field :global(.more-button) { background: var(--bg); }
  .body-field :global(.surface-wrap) { border-radius: 2px; }
  .body-field :global(.surface-wrap:focus-within) { box-shadow: inset 0 -2px 0 var(--primary); }
  /* The primary underline is the editor's focus cue; drop the global 1px ring. */
  .body-field :global(.host .rich-text-surface:focus-visible) { box-shadow: none; }
  /* Dark mode: the bright paper was the heaviest thing on the page. Show the
     body on the surface tone and invert its content for display only, so
     default black (and black pasted from Word) reads light while colours keep
     their hue. Sent HTML is untouched; images are flipped back. */
  @media (prefers-color-scheme: dark) {
    .body-field :global(.surface-wrap) { background: var(--bg-surface); }
    /* Lighter primary keeps the focus underline above 3:1 on the dark tone. */
    .body-field :global(.surface-wrap:focus-within) { box-shadow: inset 0 -2px 0 var(--primary-text); }
    .body-field :global(.surface-wrap .host) { filter: invert(0.88) hue-rotate(180deg); }
    .body-field :global(.surface-wrap .host img) { filter: hue-rotate(180deg) invert(1); }
    .body-field :global(.surface-wrap .placeholder),
    .body-field :global(.surface-wrap .editor-state) { color: var(--text-muted); }
  }
  /* Windows High Contrast: the writing area gets its frame back. */
  @media (forced-colors: active) {
    .body-field :global(.surface-wrap) { border: 1px solid CanvasText; }
    .body-field :global(.surface-wrap:focus-within) { outline: 2px solid Highlight; }
  }
  /* Comfortable inner padding so text and caret never sit on the edge; the
     placeholder and loading line follow it. */
  .body-field :global(.host .rich-text-surface) { min-height: max(240px, 45vh); padding: 18px 20px; }
  .body-field :global(.surface-wrap .placeholder) { top: 18px; left: 20px; }
  .body-field :global(.surface-wrap .editor-state) { padding: 18px 20px; }
  .body-field textarea { min-height: max(240px, 45vh); border-color: transparent; padding: 18px 20px; }
  .body-field textarea:focus { border-bottom-color: var(--primary); }
  /* Quiet text tabs; the selected one is ink-coloured with a primary underline. */
  .format-toggle { display:inline-flex; gap:4px; }
  .format-toggle button { min-height:30px; padding:2px 8px; border:0; border-radius:var(--radius); background:transparent; color:var(--text-muted); font-size:12px; font-weight:600; cursor:pointer; }
  .format-toggle button:hover:not(:disabled) { background:var(--bg-hover); color:var(--text); }
  .format-toggle button[aria-pressed='true'] { color:var(--text); box-shadow:inset 0 -2px 0 var(--primary); border-radius:var(--radius) var(--radius) 0 0; }
  .format-toggle button:disabled { opacity:.5; cursor:not-allowed; }
  .format-note { color:var(--text-muted); font-size:11px; }
  .quoted-message { margin: 0 0 14px; }
  .quoted-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:6px; font-size:12px; }
  .quoted-heading strong { color:var(--text); font-size:13px; font-weight:600; }
  .quoted-heading span { color:var(--text-muted); }

  .signature-preview { margin: 4px 0 14px; border-radius: var(--radius); font-size: 12px; }
  .signature-preview > summary { display:flex; align-items:center; gap:12px; min-height:46px; padding:8px 4px; border-radius:var(--radius); cursor:pointer; list-style:none; }
  .signature-preview > summary:hover { background:var(--bg-hover); }
  .signature-preview > summary::-webkit-details-marker { display:none; }
  .signature-preview > summary::before { content:'›'; color:var(--text-muted); font-size:18px; line-height:1; transition:transform var(--dur-fast) var(--ease); }
  .signature-preview[open] > summary::before { transform:rotate(90deg); }
  .signature-summary-copy { display:flex; flex:1; flex-direction:column; min-width:0; }
  .signature-summary-copy strong { color:var(--text); font-size:12px; font-weight:600; }
  .signature-summary-copy small { color:var(--text-muted); font-size:10.5px; }
  .signature-lock { flex:0 0 auto; padding:3px 7px; border-radius:var(--radius-pill); background:var(--warning-soft); color:var(--warning); font-size:10px; font-weight:650; }
  .signature-preview-body { padding:0 4px 12px 26px; }
  .signature-help { margin:10px 0; color:var(--text-muted); font-size:11px; }
  .signature-layers { display:flex; flex-direction:column; gap:8px; }
  .signature-layer { overflow:hidden; border-left:3px solid var(--primary); border-radius:var(--radius); }
  .signature-layer-org { border-left-color:#7c3aed; }
  .signature-layer > span { display:block; padding:4px 8px; color:var(--text-muted); font-size:11px; font-weight:600; }
  .signature-layer iframe { display:block; width:100%; min-height:76px; border:0; background:#fff; }
  .signature-footer { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-top:9px; color:var(--text-faint); font-size:10.5px; }
  .signature-footer a { flex:0 0 auto; font-weight:600; }

  .attachments { margin: 0 0 14px; }
  .attachments-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .attachments-label { font-size: 13px; font-weight: 500; color: var(--text-muted); }
  /* Secondary actions are quiet text buttons; Send is the one filled primary. */
  .attachments-head .btn, .compose-actions .right .btn:not(.btn-primary) { border-color: transparent; background: transparent; color: var(--primary-text); }
  .attachments-head .btn:hover, .compose-actions .right .btn:not(.btn-primary):hover:not(:disabled) { background: var(--bg-hover); color: var(--primary-text); }
  .compose-actions .right .btn:not(.btn-primary):disabled { background: transparent; border-color: transparent; color: var(--text-disabled); }
  .attachment-list { list-style: none; padding: 0; margin: 8px 0 4px; display: flex; flex-direction: column; gap: 6px; }
  .attachment-list li {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    background: var(--bg-hover);
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
  .att-remove:hover { background: var(--bg-hover); color: var(--text); }
  .att-note { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; }
  .attachment-error {
    padding: 6px 10px; font-size: 12px;
    background: var(--danger-soft); color: var(--danger-text);
    border-radius: var(--radius);
    margin-bottom: 8px;
  }

  .compose-actions { display: flex; align-items: center; gap: 8px; padding-top: 8px; margin-top: 8px; }
  .compose-actions .left { display:flex; align-items:center; gap:8px; margin-right: auto; }
  .compose-actions .right { display: flex; gap: 8px; }
  .btn-ghost { background: transparent; border-color: transparent; }
  .btn-ghost:hover { background: var(--bg-hover); }
  .btn-ghost-danger { background: transparent; border-color: transparent; color: var(--danger); }
  .btn-ghost-danger:hover { background: var(--danger-soft); }

  @media (pointer: coarse), (max-width: 860px) {
    .format-toggle button { min-height: 44px; padding: 2px 14px; font-size: 13px; }
    .format-toggle { padding: 0; }
    .bcc-toggle { min-width: 44px; min-height: 44px; font-size: 13px; }
    .att-remove { min-width: 44px; min-height: 44px; }
  }

  @media (max-width: 768px) {
    .body-field :global(.host .rich-text-surface) { padding: 14px 16px; }
    .body-field :global(.surface-wrap .placeholder) { top: 14px; left: 16px; }
    .body-field :global(.surface-wrap .editor-state) { padding: 14px 16px; }
    .body-field textarea { padding: 14px 16px; }
    /* The action bar sticks to the bottom of the screen (and above the
       on-screen keyboard), so Send never needs a scroll to the end. Back
       and Discard shrink to icons so Save draft and Send always fit; at
       very large text sizes the bar wraps rather than running off-screen. */
    .compose-actions {
      position: sticky;
      bottom: 0;
      z-index: 5;
      flex-wrap: wrap;
      margin: 4px -14px 0;
      padding: 8px 14px max(8px, env(safe-area-inset-bottom));
      background: var(--bg);
      box-shadow: 0 -1px 0 var(--border), 0 -4px 12px rgba(0, 0, 0, 0.06);
      border-top: 0;
    }
    .compose-actions .left { gap: 4px; }
    .compose-actions .right { margin-left: auto; }
    .secondary-action { min-width: 44px; padding-inline: 10px; }
    .action-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .quoted-heading { align-items:flex-start; flex-direction:column; gap:2px; }
    .recovery-warning { align-items:flex-start; flex-direction:column; }
    .recovery-actions { flex-wrap:wrap; }
    .signature-footer { flex-direction:column; gap:5px; }
  }
</style>
