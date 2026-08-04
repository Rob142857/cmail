<script>
  import { dateTimeAttribute, formatDateTime } from '$lib/dates';

  let { message, locale, timeZone, mailboxHref } = $props();

  /** @param {string} value */
  function parseAddresses(value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  const toList = $derived(parseAddresses(message.to_addresses).join(', '));
  const ccList = $derived(parseAddresses(message.cc_addresses).join(', '));
  const replyToList = $derived(parseAddresses(message.reply_to_addresses).join(', '));
  const failedRecipientList = $derived(parseAddresses(message.failed_recipients).join(', '));
  const mailboxPermission = $derived({
    read: 'Read only',
    'send-as': 'Read and send as',
    full: 'Full access',
  }[message.mailbox_permissions] || message.mailbox_permissions);
</script>

<dl class="message-meta">
  <div><dt>From</dt><dd>{message.from_address}</dd></div>
  {#if replyToList}<div><dt>Reply to</dt><dd>{replyToList}</dd></div>{/if}
  <div><dt>To</dt><dd>{toList}</dd></div>
  {#if ccList}<div><dt>Cc</dt><dd>{ccList}</dd></div>{/if}
  {#if message.importance !== 'normal'}
    <div>
      <dt>Importance</dt>
      <dd><span class:high={message.importance === 'high'} class:low={message.importance === 'low'} class="importance-label">{message.importance === 'high' ? 'High — important' : 'Low'}</span></dd>
    </div>
  {/if}
  {#if failedRecipientList}
    <div><dt>Failed</dt><dd class="delivery-failure">Permanent bounce: {failedRecipientList}</dd></div>
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

<style>
  .message-meta { display:flex; flex-direction:column; gap:4px; margin-bottom:16px; font-size:13px; }
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
</style>
