<script>
  import { dateTimeAttribute, formatDateTime, formatDate } from '$lib/dates';
  import { sanitizeParticipantName } from '@cmail/shared/message-participants';
  import { quarantineReasonPhrase } from '$lib/quarantine-reason';

  let { message, locale, timeZone, mailboxHref } = $props();

  let expanded = $state(false);

  /** @typedef {{ address: string, name?: string }} Participant */

  /** @param {string} value */
  function parseAddresses(value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  /** @param {string} value @param {string} fallback */
  function parseParticipants(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const participants = parsed.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || typeof entry.address !== 'string' || !entry.address.trim()) return [];
          const name = sanitizeParticipantName(entry.name);
          return [{ address: entry.address, ...(name ? { name } : {}) }];
        });
        if (participants.length) return participants;
      }
    } catch {
      // Old messages have only JSON address arrays.
    }
    return parseAddresses(fallback).map((address) => ({ address }));
  }

  /** @param {Participant} participant */
  function renderParticipant(participant) {
    return participant.name ? `${participant.name} <${participant.address}>` : participant.address;
  }

  /** @param {Participant} participant */
  function shortName(participant) {
    return participant.name || participant.address.split('@')[0] || participant.address;
  }

  const fromName = $derived(sanitizeParticipantName(message.from_name));
  const fromLabel = $derived(fromName ? `${fromName} <${message.from_address}>` : message.from_address);
  const toParticipants = $derived(parseParticipants(message.to_participants, message.to_addresses));
  const ccParticipants = $derived(parseParticipants(message.cc_participants, message.cc_addresses));
  // Only the sender's own drafts/sent copy ever has a non-empty bcc_addresses
  // — a received copy never carries one, so this line only ever appears there.
  const bccParticipants = $derived(parseParticipants(message.bcc_participants, message.bcc_addresses));
  const toList = $derived(toParticipants.map(renderParticipant).join(', '));
  const ccList = $derived(ccParticipants.map(renderParticipant).join(', '));
  const bccList = $derived(bccParticipants.map(renderParticipant).join(', '));
  const replyToList = $derived(parseParticipants(message.reply_to_participants, message.reply_to_addresses).map(renderParticipant).join(', '));
  const failedRecipientList = $derived(parseAddresses(message.failed_recipients).join(', '));
  const quarantineReason = $derived(quarantineReasonPhrase(message.quarantine_reason));
  const mailboxPermission = $derived({
    read: 'Read only',
    'send-as': 'Read and send as',
    full: 'Full access',
  }[message.mailbox_permissions] || message.mailbox_permissions);

  const initials = $derived.by(() => {
    const source = fromName || message.from_address || '?';
    const words = source.replace(/[<>"']/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  });
  const recipientSummary = $derived.by(() => {
    const all = [...toParticipants, ...ccParticipants];
    if (!all.length) return '';
    const extra = all.length - 1;
    return `to ${shortName(all[0])}${extra > 0 ? ` +${extra}` : ''}`;
  });
</script>

<div class="meta-compact">
  <span class="avatar" aria-hidden="true">{initials}</span>
  <div class="compact-main">
    <div class="compact-top">
      <span class="compact-from" title={fromLabel}>{fromName || message.from_address}</span>
      <time class="compact-date" datetime={dateTimeAttribute(message.received_at)}>{formatDate(message.received_at, locale, timeZone)}</time>
    </div>
    <div class="compact-sub">
      {#if recipientSummary}<span class="compact-to">{recipientSummary}</span>{/if}
      <button
        type="button"
        class="details-toggle"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >Details <span class="chevron" class:open={expanded} aria-hidden="true">⌄</span></button>
    </div>
    {#if message.folder === 'spam'}
      <p class="compact-flag quarantine-note">{quarantineReason ? `In Spam: ${quarantineReason}` : 'In Spam'}</p>
    {/if}
    {#if failedRecipientList}
      <p class="compact-flag delivery-failure">Permanent bounce: {failedRecipientList}</p>
    {/if}
    {#if message.importance === 'high'}
      <p class="compact-flag importance-label high">High — important</p>
    {/if}
  </div>
</div>

{#if expanded}
  <dl class="message-meta">
    <div><dt>From</dt><dd>{fromLabel}</dd></div>
    {#if replyToList}<div><dt>Reply to</dt><dd>{replyToList}</dd></div>{/if}
    <div><dt>To</dt><dd>{toList}</dd></div>
    {#if ccList}<div><dt>Cc</dt><dd>{ccList}</dd></div>{/if}
    {#if bccList}<div><dt>Bcc</dt><dd>{bccList}</dd></div>{/if}
    {#if message.importance !== 'normal'}
      <div>
        <dt>Importance</dt>
        <dd><span class:high={message.importance === 'high'} class:low={message.importance === 'low'} class="importance-label">{message.importance === 'high' ? 'High — important' : 'Low'}</span></dd>
      </div>
    {/if}
    <div>
      <dt>Mailbox</dt>
      <dd class="mailbox-context">
        <a href={mailboxHref}>{message.mailbox_display_name || message.mailbox_address}</a>
        {#if message.mailbox_display_name && message.mailbox_display_name !== message.mailbox_address}
          <span>&lt;{message.mailbox_address}&gt;</span>
        {/if}
        <span class="permission-label">{mailboxPermission}</span>
      </dd>
    </div>
    <div>
      <dt>Date</dt>
      <dd><time datetime={dateTimeAttribute(message.received_at)}>{formatDateTime(message.received_at, locale, timeZone)}</time></dd>
    </div>
  </dl>
{/if}

<style>
  .meta-compact { display:flex; align-items:flex-start; gap:10px; margin-bottom:12px; }
  .avatar {
    flex:0 0 auto;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:36px;
    height:36px;
    border-radius:50%;
    background:var(--bg-active);
    color:var(--text);
    font-size:13px;
    font-weight:650;
    letter-spacing:.02em;
    user-select:none;
  }
  .compact-main { min-width:0; flex:1 1 auto; }
  .compact-top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
  .compact-from { font-weight:650; font-size:14px; overflow-wrap:anywhere; }
  .compact-date { flex:0 0 auto; color:var(--text-muted); font-size:12px; white-space:nowrap; }
  .compact-sub { display:flex; align-items:center; gap:8px; min-width:0; }
  .compact-to { color:var(--text-muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .details-toggle {
    flex:0 0 auto;
    display:inline-flex;
    align-items:center;
    gap:3px;
    padding:1px 6px;
    border:0;
    background:none;
    color:var(--primary);
    font-size:12px;
    cursor:pointer;
    border-radius:var(--radius-sm, 4px);
  }
  .details-toggle:hover { background:var(--bg-hover); }
  .chevron { display:inline-block; transition:transform .12s ease; line-height:1; }
  .chevron.open { transform:rotate(180deg); }
  .compact-flag { margin:3px 0 0; font-size:12.5px; }

  .message-meta { display:flex; flex-direction:column; gap:4px; margin:0 0 14px 46px; padding:10px 12px; font-size:13px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-subtle); }
  /* The label column has to clear the longest label ("Importance"), otherwise
     it collides with its own value. */
  .message-meta div { display:grid; grid-template-columns:80px minmax(0,1fr); gap:8px; }
  .message-meta dt { color:var(--text-muted); font-weight:600; }
  .message-meta dd { overflow-wrap:anywhere; }
  .mailbox-context { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .mailbox-context > span { color:var(--text-muted); }
  .permission-label { padding:1px 7px; border:1px solid var(--border); border-radius:999px; font-size:11px; white-space:nowrap; }
  .importance-label { display:inline-flex; align-items:center; gap:4px; font-weight:650; }
  .importance-label.high { color:var(--danger); }
  .importance-label.low { color:var(--primary); }
  .delivery-failure { color:var(--danger); font-weight:650; }
  .quarantine-note { color:var(--danger); font-weight:650; }

  @media (max-width:560px) {
    .message-meta { margin-left:0; }
  }
</style>
