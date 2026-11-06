// Cloudflare Email Sending reports a bounce as an event, not as a bounce email
// in the sender's mailbox, and people don't check their Sent folder for
// failures. So each terminal failure also puts an "Undeliverable" notice in
// the Inbox of every mailbox that holds the Sent copy.
//
// The notice follows the layout people know from mainstream non-delivery
// reports (RFC 3463 codes, a plain cause, who has to act, how to fix it, then
// details for email admins and the message hops). It only states what the
// provider reported; the remote server's name and IP are not reported, so
// they are not shown.
//
// Notices are idempotent: the message ID and body key are derived from the
// provider event and the mailbox, so a redelivered queue message rewrites the
// same body object and the insert is ignored.

import type { DeliveryEvent } from './delivery-events';

export interface SentCopy {
  id: string;
  mailbox_id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string;
  subject: string;
  thread_id: string | null;
  received_at: string;
}

export interface BounceNoticeEnv {
  DB: D1Database;
  STORAGE: R2Bucket;
}

type FixOwner = 'sender' | 'service' | 'recipient';

interface Advice {
  cause: string;
  fix: string;
  owner: FixOwner;
}

const MAX_NOTICE_MAILBOXES = 5;
const MAX_SUBJECT_CHARS = 998;

/** A UUID-shaped ID derived from `seed`, so a retry reuses the same message and body key. */
export async function derivedId(seed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5 (name-based, SHA)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addressList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

/** RFC 3463 enhanced status code (x.y.z) from the provider's status or reply, if any. */
export function enhancedCode(event: Pick<DeliveryEvent, 'smtpStatus' | 'smtpResponse'>): string | null {
  for (const text of [event.smtpStatus, event.smtpResponse]) {
    const match = text?.match(/\b([245])\.(\d{1,3})\.(\d{1,3})\b/);
    if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  }
  return null;
}

/** Plain cause, fix and owner for a failure, from its type and RFC 3463 code. */
export function bounceAdvice(event: DeliveryEvent): Advice {
  const recipientDomain = domainOf(event.recipient);
  if (event.type === 'rejected') {
    return {
      cause: 'The sending service didn\'t send your message to this address. This usually happens when the address bounced or reported spam recently and was put on a suppression list.',
      fix: 'Check the address is right. If it is, wait a day and send again, or reach the recipient another way. If this keeps happening, ask your email admin.',
      owner: 'service',
    };
  }
  if (event.type === 'failed') {
    return {
      cause: 'The sending service had a problem and couldn\'t deliver your message.',
      fix: 'Send the message again later. If it fails again, ask your email admin.',
      owner: 'service',
    };
  }
  const code = enhancedCode(event);
  const [klass, subject, detail] = code ? code.split('.').map(Number) : [event.bounceType === 'soft' ? 4 : 5, 0, 0];
  const reply = (event.smtpResponse || event.reason || '').toLowerCase();
  if (klass === 4 || event.bounceType === 'soft') {
    return {
      cause: `The receiving mail server for ${recipientDomain} had a temporary problem, and delivery was retried until it was given up.`,
      fix: 'Send the message again later. If it keeps failing, contact the recipient another way and ask them to check with their email admin.',
      owner: 'recipient',
    };
  }
  if (subject === 1 && [1, 10].includes(detail)
    || (subject === 4 && detail === 1 && /reject|denied|unknown|not found|does not exist|no such/.test(reply))
    || (subject === 5 && detail === 0 && /unavailable|not found|unknown/.test(reply))) {
    return {
      cause: `${event.recipient} wasn't found at ${recipientDomain}. The address may be misspelled, or it may no longer exist.`,
      fix: 'Check the spelling of the address, fix it, and send the message again. If the address is right, contact the recipient another way: their address may have changed.',
      owner: 'sender',
    };
  }
  if (subject === 1 && [2, 0].includes(detail) || subject === 4 && [4, 0].includes(detail)) {
    return {
      cause: `Mail for ${recipientDomain} couldn't be routed. The domain may be misspelled, or its mail settings may be wrong.`,
      fix: 'Check the part of the address after the @. If it is right, the recipient\'s email admin has to fix their domain\'s mail settings.',
      owner: 'sender',
    };
  }
  if (subject === 2 && detail === 2) {
    return {
      cause: 'The recipient\'s mailbox is full.',
      fix: 'Send the message again later, or contact the recipient another way and ask them to make room in their mailbox.',
      owner: 'recipient',
    };
  }
  if (subject === 2 && detail === 3 || subject === 3 && detail === 4) {
    return {
      cause: 'Your message is too large for the recipient\'s mail server.',
      fix: 'Remove or shrink the attachments, or share a link to the files instead, then send it again.',
      owner: 'sender',
    };
  }
  if (subject === 4 && [6, 14].includes(detail)) {
    return {
      cause: `A mail loop was detected at ${recipientDomain}, so the message was stopped.`,
      fix: 'Contact the recipient another way and ask their email admin to check their forwarding and mail routing.',
      owner: 'recipient',
    };
  }
  if (subject === 7 && [23, 25, 26, 27].includes(detail) || /spf|dkim|dmarc|authenticat/.test(reply)) {
    return {
      cause: `The receiving mail server for ${recipientDomain} didn't accept your message because your domain's email authentication (SPF, DKIM or DMARC) didn't pass its checks.`,
      fix: 'Ask your email admin to check your domain\'s SPF, DKIM and DMARC records, then send the message again.',
      owner: 'sender',
    };
  }
  if (subject === 7 && (detail >= 500 || /spam|block|banned|reputation|listed/.test(reply))) {
    return {
      cause: `The receiving mail server for ${recipientDomain} blocked your message as possible spam or because of the sending server's reputation.`,
      fix: 'Check the message for anything that looks like spam (links, attachments, wording) and try again. If it keeps happening, ask your email admin to contact the recipient\'s email admin.',
      owner: 'recipient',
    };
  }
  if (subject === 7) {
    return {
      cause: `The recipient's mail system doesn't allow your message. The recipient may only accept mail from certain senders, or a rule at ${recipientDomain} rejected it.`,
      fix: 'Contact the recipient another way and ask them, or their email admin, to allow mail from you.',
      owner: 'recipient',
    };
  }
  return {
    cause: `The receiving mail server for ${recipientDomain} refused your message.`,
    fix: 'Check the address and send the message again. If it fails again, contact the recipient another way and share the error details below with your email admin.',
    owner: 'recipient',
  };
}

function utc(value: string | null): string {
  if (!value) return '';
  const text = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toUTCString().replace('GMT', 'UTC');
}

const CELL = 'padding:3px 12px 3px 0;vertical-align:top;text-align:left;';

function detailTable(rows: [string, string | null | undefined][]): string {
  return `<table style="border-collapse:collapse;font-size:13px;">${rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => `<tr><th style="${CELL}white-space:nowrap;">${escapeHtml(label)}</th><td style="${CELL}overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`)
    .join('')}</table>`;
}

function ownerStrip(owner: FixOwner, senderDomain: string, recipientDomain: string): string {
  const parties: [FixOwner, string, string][] = [
    ['sender', 'Sender', senderDomain],
    ['service', 'Sending service', ''],
    ['recipient', 'Recipient', recipientDomain],
  ];
  const cells = parties.map(([party, label, sub]) => {
    const action = party === owner;
    const style = action
      ? 'background-color:#fde7e9;border:2px solid #c50f1f;color:#a4262c;'
      : 'background-color:#f3f3f3;border:1px solid #d1d1d1;color:#444;';
    return `<td style="${style}padding:8px 12px;text-align:center;width:33%;">`
      + `<div style="font-weight:600;">${escapeHtml(label)}</div>`
      + (sub ? `<div style="font-size:12px;">${escapeHtml(sub)}</div>` : '')
      + `<div style="font-size:12px;font-weight:600;">${action ? 'Action required' : '&nbsp;'}</div></td>`;
  }).join('<td style="padding:0 4px;color:#888;">&#8594;</td>');
  return `<table style="border-collapse:separate;border-spacing:0;margin:12px 0;width:100%;max-width:560px;"><tr>${cells}</tr></table>`;
}

const EVENT_RESULT: Record<string, string> = {
  bounced: 'Bounced',
  failed: 'Failed',
  rejected: 'Not sent (rejected by the sending service)',
};

/** Subject, plain-text snippet and HTML body of one notice. */
export function bounceNoticeContent(
  event: DeliveryEvent,
  copy: SentCopy,
  generatedAt: string,
): { subject: string; snippet: string; html: string } {
  const originalSubject = copy.subject.trim() || '(no subject)';
  const subject = `Undeliverable: ${originalSubject}`.slice(0, MAX_SUBJECT_CHARS);
  const advice = bounceAdvice(event);
  const code = enhancedCode(event);
  const senderDomain = domainOf(copy.from_address);
  const recipientDomain = domainOf(event.recipient);
  // The remote reply usually carries the code already; add it only when it doesn't.
  const reportedError = event.smtpResponse
    ? (code && !event.smtpResponse.includes(code) ? `${code} ${event.smtpResponse}` : event.smtpResponse)
    : (code || '');
  const bounceKind = event.type === 'bounced'
    ? (event.bounceType === 'soft' ? 'Temporary failure, retries given up' : 'Permanent failure')
    : EVENT_RESULT[event.type];
  const eventTime = event.eventTimestamp || generatedAt;

  const html = '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;max-width:640px;">'
    + `<p style="font-size:18px;font-weight:600;margin:0 0 6px;">Your message to ${escapeHtml(event.recipient)} couldn't be delivered.</p>`
    + `<p style="margin:0 0 4px;">${escapeHtml(advice.cause)}</p>`
    + ownerStrip(advice.owner, senderDomain, recipientDomain)
    + '<p style="font-size:16px;font-weight:600;margin:16px 0 4px;">How to fix it</p>'
    + `<p style="margin:0 0 4px;">${escapeHtml(advice.fix)}</p>`
    + '<p style="margin:0 0 4px;">The original message is in your Sent folder.</p>'
    + '<hr style="border:0;border-top:1px solid #d1d1d1;margin:18px 0;">'
    + '<p style="font-size:16px;font-weight:600;margin:0 0 6px;">More info for email admins</p>'
    + detailTable([
      ['Status code', code || (event.type === 'bounced' ? null : event.type)],
      ['Result', bounceKind],
    ])
    + '<p style="font-weight:600;margin:12px 0 4px;">Original message details</p>'
    + detailTable([
      ['Created date', utc(copy.received_at)],
      ['Sender address', copy.from_address],
      ['Recipient address', event.recipient],
      ['To', addressList(copy.to_addresses).join(', ')],
      ['Cc', addressList(copy.cc_addresses).join(', ')],
      ['Subject', originalSubject],
    ])
    + '<p style="font-weight:600;margin:12px 0 4px;">Error details</p>'
    + detailTable([
      ['Reported error', reportedError || null],
      ['Reason', event.reason && event.reason !== event.smtpResponse ? event.reason : null],
      ['Bounce class', event.bounceClassification],
      ['Rejected by', event.rejectionParty],
      ['Receiving provider', event.provider],
      ['Time to outcome', event.deliveryTimeMs != null ? `${(event.deliveryTimeMs / 1000).toFixed(1)} s` : null],
      ['Report time', utc(eventTime)],
      ['Provider message ID', event.providerMessageId],
    ])
    + '<p style="font-weight:600;margin:12px 0 4px;">Message hops</p>'
    + '<table style="border-collapse:collapse;font-size:13px;">'
    + `<tr><th style="${CELL}">Hop</th><th style="${CELL}">Time (UTC)</th><th style="${CELL}">From</th><th style="${CELL}">To</th><th style="${CELL}">Result</th></tr>`
    + `<tr><td style="${CELL}">1</td><td style="${CELL}">${escapeHtml(utc(copy.received_at))}</td><td style="${CELL}">${escapeHtml(senderDomain)} mailbox</td><td style="${CELL}">Sending service</td><td style="${CELL}">Accepted</td></tr>`
    + `<tr><td style="${CELL}">2</td><td style="${CELL}">${escapeHtml(utc(eventTime))}</td><td style="${CELL}">Sending service</td><td style="${CELL}">${escapeHtml(recipientDomain)} mail server</td><td style="${CELL}">${escapeHtml(EVENT_RESULT[event.type] || event.type)}</td></tr>`
    + '</table>'
    + '<p style="color:#666;font-size:12px;margin-top:14px;">The sending service reported this failure; it does not report the remote server\'s name or IP address. This notice was generated by your mail system from that report.</p>'
    + '</div>';
  const snippet = `Your message to ${event.recipient} couldn't be delivered. ${advice.cause}`.slice(0, 200);
  return { subject, snippet, html };
}

/**
 * Puts one notice in the Inbox of each mailbox holding a Sent copy of the
 * failed message. Returns the notices created by this call (none for a retry
 * that finds them already stored), for new-mail alerts.
 */
export async function deliverBounceNotices(
  env: BounceNoticeEnv,
  event: DeliveryEvent,
  copies: SentCopy[],
): Promise<{ mailboxId: string; messageId: string }[]> {
  const byMailbox = new Map<string, SentCopy>();
  for (const copy of copies) if (!byMailbox.has(copy.mailbox_id)) byMailbox.set(copy.mailbox_id, copy);
  const created: { mailboxId: string; messageId: string }[] = [];
  const generatedAt = new Date().toISOString();
  for (const copy of [...byMailbox.values()].slice(0, MAX_NOTICE_MAILBOXES)) {
    const messageId = await derivedId(`bounce-notice:${event.eventId}:${copy.mailbox_id}`);
    const bodyKey = `messages/${messageId}/${messageId}`;
    const { subject, snippet, html } = bounceNoticeContent(event, copy, generatedAt);
    await env.STORAGE.put(bodyKey, html);
    const inserted = await env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, direction, from_address, from_name, to_addresses, subject, snippet,
                             body_r2_key, size_bytes, folder, is_read, importance, thread_id, received_at, created_at)
       SELECT ?, ?, 'internal', ?, 'Mail Delivery System', ?, ?, ?, ?, ?, 'inbox', 0, 'high', ?, datetime('now'), datetime('now')
       WHERE EXISTS (SELECT 1 FROM mailboxes WHERE id = ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      messageId,
      copy.mailbox_id,
      `mailer-daemon@${domainOf(copy.from_address) || 'localhost'}`,
      JSON.stringify([copy.from_address]),
      subject,
      snippet,
      bodyKey,
      new TextEncoder().encode(html).byteLength,
      copy.thread_id,
      copy.mailbox_id,
    ).run();
    if (Number(inserted.meta?.changes || 0) > 0) {
      created.push({ mailboxId: copy.mailbox_id, messageId });
    } else if (!await env.DB.prepare('SELECT 1 FROM messages WHERE id = ?').bind(messageId).first()) {
      // The mailbox is gone, so no row will ever point at this body.
      await env.STORAGE.delete(bodyKey);
    }
  }
  return created;
}
