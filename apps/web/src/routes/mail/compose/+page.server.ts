import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Mailbox, Message } from '@cmail/shared/types';
import { sendNewMailNotifications } from '@cmail/shared/push';
import {
  releaseMailboxStorageReservations,
  reserveMailboxStorage,
  type MailboxStorageReservation,
} from '@cmail/shared/mailbox-storage';
import {
  draftSaveRatePerHour,
  maxDraftsPerMailboxUser,
  maxRecipientsPerMessage,
  outboundRateLimitPerHour,
  outboundWorkLimitPerHour,
} from '$lib/server/config';
import {
  calculateComposeWorkload,
  draftStorageReservationBytes,
  MAX_DELIVERY_BYTES_PER_SEND,
  MAX_PERSISTED_BYTES_PER_SEND,
  MAX_PERSISTED_OBJECTS_PER_SEND,
} from '$lib/server/compose-limits';
import { audit, generateId, traceEmail } from '$lib/server/db';
import {
  getProviderInfo,
  preflightEmail,
  sendEmail,
  type OutboundAttachment,
  type OutboundEmail,
} from '$lib/server/outbound';
import { consumeRateLimit } from '$lib/server/rate-limit';
import { htmlToPlainText, normalizeDomain, normalizeEmail, parseRecipientList, plainTextToHtml } from '$lib/server/validation';

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1', '.msi',
  '.com', '.pif', '.hta', '.cpl', '.reg', '.inf', '.wsf',
]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 25;
const MAX_SUBJECT_LENGTH = 500;
const MAX_BODY_LENGTH = 1_000_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_COMPOSE_REQUEST_BYTES = 24 * 1024 * 1024;

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

function safeMessageId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 998 && !/[\r\n]/.test(trimmed) ? trimmed : null;
}

function requestExceedsComposeLimit(request: Request): boolean {
  const value = request.headers.get('content-length');
  if (!value) return false;
  const size = Number(value);
  return Number.isFinite(size) && size > MAX_COMPOSE_REQUEST_BYTES;
}

function formDataExceedsComposeLimit(formData: FormData): boolean {
  const encoder = new TextEncoder();
  let size = 0;
  for (const [name, value] of formData) {
    size += encoder.encode(name).byteLength;
    size += typeof value === 'string' ? encoder.encode(value).byteLength : value.size;
    if (size > MAX_COMPOSE_REQUEST_BYTES) return true;
  }
  return false;
}

async function loadBody(storage: R2Bucket, key: string | null): Promise<string> {
  if (!key) return '';
  const object = await storage.get(key);
  return object ? object.text() : '';
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) throw redirect(303, '/');

  const sendableMailboxes = await env.DB.prepare(
    `SELECT m.* FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address`,
  ).bind(locals.user.id).all<Mailbox>();

  const replyId = url.searchParams.get('reply');
  const forwardId = url.searchParams.get('forward');
  const draftId = url.searchParams.get('draft');
  let replyTo: Message | null = null;
  let replyBody = '';
  let draft: { id: string; from_address: string; to_addresses: string; cc_addresses: string; subject: string; body: string } | null = null;

  if (draftId) {
    const existing = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
         AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
    ).bind(draftId, locals.user.id, locals.user.id).first<Message>();
    if (existing) {
      draft = {
        id: existing.id,
        from_address: existing.from_address,
        to_addresses: existing.to_addresses,
        cc_addresses: existing.cc_addresses,
        subject: existing.subject,
        body: htmlToPlainText(await loadBody(env.STORAGE, existing.body_r2_key)),
      };
    }
  }

  const sourceId = replyId || forwardId;
  if (sourceId) {
    replyTo = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'`,
    ).bind(sourceId, locals.user.id).first<Message>();
    if (replyTo) replyBody = htmlToPlainText(await loadBody(env.STORAGE, replyTo.body_r2_key));
  }

  const signature = await env.DB.prepare(
    `SELECT html_body, plain_text_body FROM signature_templates WHERE applies_to = '*' LIMIT 1`,
  ).first<{ html_body: string; plain_text_body: string }>();

  const mailboxes = sendableMailboxes.results || [];
  const preferredFrom = draft?.from_address
    || (replyTo ? mailboxes.find((mailbox) => mailbox.id === replyTo.mailbox_id)?.address : '')
    || mailboxes[0]?.address
    || '';

  return {
    mailboxes,
    preferredFrom,
    replyTo,
    replyBody,
    isForward: !!forwardId,
    signature: signature?.html_body || '',
    draft,
    composeToken: crypto.randomUUID(),
    outboundProvider: getProviderInfo(env as unknown as Record<string, unknown>).name,
  };
};

export const actions: Actions = {
  send: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    if (requestExceedsComposeLimit(request)) return fail(413, { error: 'Compose request exceeds the 24 MB limit' });

    const formData = await request.formData();
    if (formDataExceedsComposeLimit(formData)) return fail(413, { error: 'Compose request exceeds the 24 MB limit' });
    const from = normalizeEmail(stringValue(formData.get('from')));
    const subjectInput = stringValue(formData.get('subject')).trim();
    const subject = subjectInput || '(no subject)';
    const body = stringValue(formData.get('body'));
    const inReplyTo = safeMessageId(stringValue(formData.get('in_reply_to')));
    const draftId = stringValue(formData.get('draft_id')) || null;
    const composeToken = stringValue(formData.get('compose_token'));
    const envRecord = env as unknown as Record<string, unknown>;
    const recipientLimit = maxRecipientsPerMessage(envRecord);
    const toResult = parseRecipientList(formData.get('to'), recipientLimit);
    const ccResult = parseRecipientList(formData.get('cc'), recipientLimit);

    if (!from) return fail(400, { error: 'Choose a valid From address' });
    if (toResult.error || !toResult.recipients.length) return fail(400, { error: toResult.error || 'At least one To recipient is required' });
    if (ccResult.error) return fail(400, { error: ccResult.error });
    const toSet = new Set(toResult.recipients);
    const ccRecipients = ccResult.recipients.filter((address) => !toSet.has(address));
    const allRecipients = [...toResult.recipients, ...ccRecipients];
    if (allRecipients.length > recipientLimit) return fail(400, { error: `A message can have at most ${recipientLimit} recipients` });
    if (subject.length > MAX_SUBJECT_LENGTH) return fail(400, { error: `Subject is too long (max ${MAX_SUBJECT_LENGTH} characters)` });
    if (body.length > MAX_BODY_LENGTH) return fail(413, { error: 'Message body is too large' });
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > MAX_BODY_BYTES) return fail(413, { error: 'Message body exceeds the 1 MB limit' });
    if (!/^[0-9a-f-]{36}$/i.test(composeToken)) return fail(400, { error: 'This compose form expired. Reload it and try again.' });

    const mailbox = await env.DB.prepare(
      `SELECT m.id, m.address FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
    ).bind(from, locals.user.id).first<{ id: string; address: string }>();
    if (!mailbox) return fail(403, { error: 'You do not have permission to send from this address' });

    const rawAttachments = formData.getAll('attachments').filter((value): value is File => value instanceof File && value.size > 0);
    if (rawAttachments.length > MAX_ATTACHMENTS) return fail(413, { error: `A message can have at most ${MAX_ATTACHMENTS} attachments` });
    let totalAttachmentBytes = 0;
    const attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }> = [];
    for (const file of rawAttachments) {
      const filename = file.name.replace(/[\x00-\x1f\x7f\\/]/g, '_').slice(0, 255) || 'attachment';
      const extension = getExtension(filename);
      if (BLOCKED_EXTENSIONS.has(extension)) return fail(400, { error: `Attachment type not allowed: ${extension}` });
      totalAttachmentBytes += file.size;
      if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) return fail(413, { error: 'Attachments exceed the 20 MB total limit' });
      attachments.push({
        filename,
        contentType: file.type.replace(/[\r\n]/g, '').slice(0, 150) || 'application/octet-stream',
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }

    const internalRows = await env.DB.prepare(
      `SELECT address, id FROM mailboxes WHERE status = 'active' AND address IN (${allRecipients.map(() => '?').join(',')})`,
    ).bind(...allRecipients).all<{ address: string; id: string }>();
    const internalMap = new Map((internalRows.results || []).map((row) => [row.address.toLowerCase(), row.id]));
    const externalTo = toResult.recipients.filter((address) => !internalMap.has(address));
    const externalCc = ccRecipients.filter((address) => !internalMap.has(address));
    const externalRecipients = [...externalTo, ...externalCc];

    const signature = await env.DB.prepare(
      `SELECT html_body, plain_text_body FROM signature_templates
       WHERE applies_to = '*' OR applies_to = ?
       ORDER BY CASE WHEN applies_to = ? THEN 0 ELSE 1 END LIMIT 1`,
    ).bind(from, from).first<{ html_body: string; plain_text_body: string }>();
    const htmlWithSignature = `${plainTextToHtml(body)}${signature?.html_body || ''}`;
    const textWithSignature = `${body}${signature?.plain_text_body ? `\n\n${signature.plain_text_body}` : ''}`;
    const mailDomain = normalizeDomain(env.MAIL_DOMAIN);
    if (!mailDomain) {
      return fail(503, { error: 'MAIL_DOMAIN is not configured' });
    }

    const providerTo = externalTo.length ? externalTo : externalCc;
    const providerCc = externalTo.length ? externalCc : [];
    const outboundEmail: OutboundEmail | null = externalRecipients.length ? {
      from,
      to: providerTo,
      cc: providerCc,
      subject,
      html: htmlWithSignature,
      text: textWithSignature,
      headers: inReplyTo ? { 'In-Reply-To': inReplyTo, 'References': inReplyTo } : undefined,
      attachments: attachments.map<OutboundAttachment>((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.bytes,
      })),
    } : null;
    if (outboundEmail) {
      const preflight = preflightEmail(outboundEmail, envRecord);
      if (!preflight.ok) return fail(preflight.status, { error: preflight.error });
    }

    const encoder = new TextEncoder();
    const persistedPayloadBytes = encoder.encode(htmlWithSignature).byteLength + totalAttachmentBytes;
    const providerPayloadBytes = persistedPayloadBytes + encoder.encode(textWithSignature).byteLength;
    const workload = calculateComposeWorkload(
      persistedPayloadBytes,
      providerPayloadBytes,
      allRecipients.length,
      internalMap.size,
      attachments.length,
    );
    if (workload.deliveryBytes > MAX_DELIVERY_BYTES_PER_SEND) {
      return fail(413, { error: 'This send exceeds the 250 MB aggregate delivery limit. Reduce recipients or attachment size.' });
    }
    if (workload.persistedBytes > MAX_PERSISTED_BYTES_PER_SEND) {
      return fail(413, { error: 'This send would store more than 100 MB across internal mailboxes. Reduce internal recipients or attachment size.' });
    }
    if (workload.persistedObjects > MAX_PERSISTED_OBJECTS_PER_SEND) {
      return fail(413, { error: 'This send would create too many internal attachment copies. Reduce internal recipients or attachment count.' });
    }

    const claimed = await env.DB.prepare(
      `INSERT OR IGNORE INTO send_idempotency (id, user_id, created_at) VALUES (?, ?, datetime('now'))`,
    ).bind(composeToken, locals.user.id).run();
    if (!claimed.meta.changes) return fail(409, { error: 'This message was already submitted. Check Sent before trying again.' });

    const sendRate = await consumeRateLimit(
      env.DB,
      'outbound',
      locals.user.id,
      outboundRateLimitPerHour(env as unknown as Record<string, unknown>),
      60 * 60,
    );
    if (!sendRate.allowed) {
      await env.DB.prepare('DELETE FROM send_idempotency WHERE id = ?').bind(composeToken).run();
      return fail(429, { error: `Hourly send limit reached. Try again in about ${Math.ceil(sendRate.retryAfter / 60)} minutes.` });
    }

    const workRate = await consumeRateLimit(
      env.DB,
      'outbound-work',
      locals.user.id,
      outboundWorkLimitPerHour(env as unknown as Record<string, unknown>),
      60 * 60,
      workload.workUnits,
    );
    if (!workRate.allowed) {
      await env.DB.prepare('DELETE FROM send_idempotency WHERE id = ?').bind(composeToken).run();
      return fail(429, { error: `Hourly recipient and attachment workload limit reached. Try again in about ${Math.ceil(workRate.retryAfter / 60)} minutes.` });
    }

    const messageId = generateId();
    let messageIdHeader = `<${messageId}@${mailDomain}>`;
    const plannedInternalDeliveries = allRecipients.flatMap((recipient) => {
      const mailboxId = internalMap.get(recipient);
      return mailboxId ? [{ mailboxId, messageId: generateId() }] : [];
    });
    const storageResult = await reserveMailboxStorage(
      env.DB,
      env,
      [
        { mailboxId: mailbox.id, deliveryKey: messageId, bytes: persistedPayloadBytes },
        ...plannedInternalDeliveries.map((delivery) => ({
          mailboxId: delivery.mailboxId,
          deliveryKey: delivery.messageId,
          bytes: persistedPayloadBytes,
        })),
      ],
    );
    if (storageResult.status !== 'accepted') {
      await env.DB.prepare('DELETE FROM send_idempotency WHERE id = ?').bind(composeToken).run().catch(() => undefined);
      return fail(storageResult.status === 'rejected' ? 507 : 503, {
        error: storageResult.status === 'rejected'
          ? 'Mailbox storage limit reached. Free some space or ask an administrator to raise the configured quota.'
          : 'Mailbox storage is temporarily unavailable. Please try again later.',
      });
    }
    const storageReservations: MailboxStorageReservation[] = storageResult.reservations;

    if (outboundEmail) {
      let result;
      try {
        result = await sendEmail(outboundEmail, envRecord);
      } catch {
        await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
        await audit(env.DB, {
          event_type: 'email.delivery_unknown',
          actor_id: locals.user.id,
          actor_role: locals.user.role,
          target: messageId,
          detail: 'Outbound provider delivery status is unknown after an unexpected failure',
        }).catch(() => undefined);
        return fail(502, {
          error: 'Delivery status is unknown. Do not resend this message; ask an administrator to check outbound provider activity.',
        });
      }

      if (!result.success) {
        await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
        if (!result.ambiguous) {
          await env.DB.prepare('DELETE FROM send_idempotency WHERE id = ?').bind(composeToken).run().catch(() => undefined);
        }
        await audit(env.DB, {
          event_type: result.ambiguous ? 'email.delivery_unknown' : 'email.failed',
          actor_id: locals.user.id,
          actor_role: locals.user.role,
          target: messageId,
          detail: result.ambiguous
            ? `Outbound provider ${result.provider} delivery status is unknown`
            : `Outbound provider ${result.provider} rejected the request`,
        }).catch(() => undefined);
        return fail(502, {
          error: result.ambiguous
            ? 'Delivery status is unknown. Do not resend this message; ask an administrator to check outbound provider activity.'
            : 'The outbound provider could not send this message. Please try again later.',
        });
      }

      if (result.messageIdHeader) messageIdHeader = result.messageIdHeader;

      await traceEmail(env.DB, {
        message_id_header: messageIdHeader,
        direction: 'outbound',
        envelope_from: from,
        envelope_to: externalRecipients.join(', '),
        header_from: from,
        subject: subject.slice(0, 256),
        status: 'sent',
        status_detail: `via ${result.provider}`,
      }).catch(() => undefined);
    }

    const createdMessageIds: string[] = [];
    const createdKeys: string[] = [];
    try {
      const bodyKey = `messages/${mailbox.id}/${messageId}/body.html`;
      await env.STORAGE.put(bodyKey, htmlWithSignature);
      createdKeys.push(bodyKey);
      await env.DB.prepare(
        `INSERT INTO messages
         (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, received_at, created_at, in_reply_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, datetime('now'), datetime('now'), ?)`,
      ).bind(
        messageId, mailbox.id, messageIdHeader, externalRecipients.length ? 'outbound' : 'internal',
        from, JSON.stringify(toResult.recipients), JSON.stringify(ccRecipients), subject,
        body.replace(/\s+/g, ' ').trim().slice(0, 200), bodyKey,
        attachments.length ? 1 : 0, persistedPayloadBytes,
        inReplyTo,
      ).run();
      createdMessageIds.push(messageId);

      for (const attachment of attachments) {
        const attachmentId = generateId();
        const key = `attachments/${messageId}/${attachmentId}`;
        await env.STORAGE.put(key, attachment.bytes);
        createdKeys.push(key);
        await env.DB.prepare(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(attachmentId, messageId, attachment.filename, attachment.contentType, attachment.bytes.byteLength, key).run();
      }

      for (const { mailboxId: recipientMailboxId, messageId: deliveryId } of plannedInternalDeliveries) {
        const recipientBodyKey = `messages/${recipientMailboxId}/${deliveryId}/body.html`;
        await env.STORAGE.put(recipientBodyKey, htmlWithSignature);
        createdKeys.push(recipientBodyKey);
        await env.DB.prepare(
          `INSERT INTO messages
           (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, received_at, created_at, in_reply_to)
           VALUES (?, ?, ?, 'internal', ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', 0, datetime('now'), datetime('now'), ?)`,
        ).bind(
          deliveryId, recipientMailboxId, messageIdHeader, from,
          JSON.stringify(toResult.recipients), JSON.stringify(ccRecipients), subject,
          body.replace(/\s+/g, ' ').trim().slice(0, 200), recipientBodyKey,
          attachments.length ? 1 : 0, persistedPayloadBytes,
          inReplyTo,
        ).run();
        createdMessageIds.push(deliveryId);
        for (const attachment of attachments) {
          const attachmentId = generateId();
          const key = `attachments/${deliveryId}/${attachmentId}`;
          await env.STORAGE.put(key, attachment.bytes);
          createdKeys.push(key);
          await env.DB.prepare(
            `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(attachmentId, deliveryId, attachment.filename, attachment.contentType, attachment.bytes.byteLength, key).run();
        }
      }
    } catch (error) {
      if (createdMessageIds.length) {
        await Promise.all(createdMessageIds.map((id) => env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run().catch(() => undefined)));
      }
      if (createdKeys.length) await Promise.all(createdKeys.map((key) => env.STORAGE.delete(key).catch(() => undefined)));
      await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
      if (!externalRecipients.length) {
        await env.DB.prepare('DELETE FROM send_idempotency WHERE id = ?').bind(composeToken).run().catch(() => undefined);
      }
      console.error('Sent-copy persistence failed', error instanceof Error ? error.message : String(error));
      return fail(500, {
        error: externalRecipients.length
          ? 'The provider accepted this message, but the local sent copy failed. Do not resend; ask an administrator to check the mail trace.'
          : 'The message could not be stored. Please try again.',
      });
    }

    if (plannedInternalDeliveries.length) {
      platform?.context.waitUntil(Promise.all(
        plannedInternalDeliveries.map((delivery) =>
          sendNewMailNotifications(env, delivery.mailboxId, delivery.messageId)),
      ).then(() => undefined));
    }

    if (draftId) {
      const draft = await env.DB.prepare(
        `SELECT m.body_r2_key FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
           AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
      ).bind(draftId, locals.user.id, locals.user.id).first<{ body_r2_key: string | null }>();
      if (draft) {
        if (draft.body_r2_key) await env.STORAGE.delete(draft.body_r2_key);
        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(draftId).run();
      }
    }

    await audit(env.DB, {
      event_type: 'email.sent',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: messageId,
      detail: `Sent to ${allRecipients.length} recipient(s); ${externalRecipients.length} external`,
      session_id: locals.sessionId,
    });
    throw redirect(303, '/mail?folder=sent');
  },

  save: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    if (requestExceedsComposeLimit(request)) return fail(413, { error: 'Compose request exceeds the 24 MB limit' });
    const formData = await request.formData();
    if (formDataExceedsComposeLimit(formData)) return fail(413, { error: 'Compose request exceeds the 24 MB limit' });
    const from = normalizeEmail(stringValue(formData.get('from')));
    const to = stringValue(formData.get('to')).slice(0, 20_000);
    const cc = stringValue(formData.get('cc')).slice(0, 20_000);
    const subject = stringValue(formData.get('subject')).slice(0, MAX_SUBJECT_LENGTH) || '(no subject)';
    const body = stringValue(formData.get('body'));
    const inReplyTo = safeMessageId(stringValue(formData.get('in_reply_to')));
    const existingDraftId = stringValue(formData.get('draft_id')) || null;
    if (!from) return fail(400, { error: 'Choose a valid From address to save a draft' });
    if (body.length > MAX_BODY_LENGTH) return fail(413, { error: 'Message body is too large' });
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return fail(413, { error: 'Message body exceeds the 1 MB limit' });

    const mailbox = await env.DB.prepare(
      `SELECT m.id FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
    ).bind(from, locals.user.id).first<{ id: string }>();
    if (!mailbox) return fail(403, { error: 'You do not have permission to draft from this address' });

    const toRecipients = to.split(/[;,]/).map((address) => address.trim()).filter(Boolean).slice(0, 200);
    const ccRecipients = cc.split(/[;,]/).map((address) => address.trim()).filter(Boolean).slice(0, 200);
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 200);
    const htmlBody = plainTextToHtml(body);
    const htmlBodyBytes = new TextEncoder().encode(htmlBody).byteLength;
    const draftRate = await consumeRateLimit(
      env.DB,
      'draft-save',
      `${locals.user.id}:${mailbox.id}`,
      draftSaveRatePerHour(env as unknown as Record<string, unknown>),
      60 * 60,
    );
    if (!draftRate.allowed) {
      return fail(429, { error: `Draft save limit reached. Try again in about ${Math.ceil(draftRate.retryAfter / 60)} minutes.` });
    }
    const draftRowLimit = maxDraftsPerMailboxUser(env as unknown as Record<string, unknown>);

    if (existingDraftId) {
      const existing = await env.DB.prepare(
        `SELECT m.body_r2_key, m.mailbox_id, m.size_bytes FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
           AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
      ).bind(existingDraftId, locals.user.id, locals.user.id).first<{
        body_r2_key: string | null;
        mailbox_id: string;
        size_bytes: number;
      }>();
      if (!existing) return fail(404, { error: 'Draft not found' });
      const reservationBytes = draftStorageReservationBytes(
        existing.mailbox_id,
        existing.size_bytes,
        mailbox.id,
        htmlBodyBytes,
      );
      const movedMailbox = existing.mailbox_id !== mailbox.id;
      const storageResult = await reserveMailboxStorage(env.DB, env, reservationBytes > 0 || movedMailbox ? [{
        mailboxId: mailbox.id,
        deliveryKey: `draft-update/${existingDraftId}`,
        bytes: reservationBytes,
        ...(movedMailbox ? { draftOwnerId: locals.user.id, draftRowLimit } : {}),
      }] : []);
      if (storageResult.status !== 'accepted') {
        return fail(storageResult.status === 'rejected' ? 507 : 503, {
          error: storageResult.status === 'rejected'
            ? 'Mailbox storage or draft limit reached. Delete old drafts or ask an administrator to raise the configured limit.'
            : 'Draft storage is temporarily unavailable. Please try again later.',
        });
      }

      const key = `messages/${mailbox.id}/${existingDraftId}/body-${generateId()}.html`;
      let bodyWritten = false;
      try {
        await env.STORAGE.put(key, htmlBody);
        bodyWritten = true;
        const updated = await env.DB.prepare(
          `UPDATE messages SET mailbox_id = ?, from_address = ?, to_addresses = ?, cc_addresses = ?,
           subject = ?, snippet = ?, body_r2_key = ?, size_bytes = ?, in_reply_to = ?, received_at = datetime('now')
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
        ).bind(
          mailbox.id,
          from,
          JSON.stringify(toRecipients),
          JSON.stringify(ccRecipients),
          subject,
          snippet,
          key,
          htmlBodyBytes,
          inReplyTo,
          existingDraftId,
          locals.user.id,
        ).run();
        if (!updated.meta.changes) throw new Error('Draft update was not applied');
      } catch {
        if (bodyWritten) await env.STORAGE.delete(key).catch(() => undefined);
        await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
        return fail(500, { error: 'The draft could not be stored. Please try again.' });
      }

      await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
      if (existing.body_r2_key && existing.body_r2_key !== key) {
        await env.STORAGE.delete(existing.body_r2_key).catch(() => undefined);
      }
      return { savedDraftId: existingDraftId, savedAt: new Date().toISOString() };
    }

    const draftId = generateId();
    const domain = normalizeDomain(env.MAIL_DOMAIN) || 'invalid.local';
    const key = `messages/${mailbox.id}/${draftId}/body.html`;
    const storageResult = await reserveMailboxStorage(env.DB, env, [{
      mailboxId: mailbox.id,
      deliveryKey: draftId,
      bytes: htmlBodyBytes,
      draftOwnerId: locals.user.id,
      draftRowLimit,
    }]);
    if (storageResult.status !== 'accepted') {
      return fail(storageResult.status === 'rejected' ? 507 : 503, {
        error: storageResult.status === 'rejected'
          ? 'Mailbox storage or draft limit reached. Delete old drafts or ask an administrator to raise the configured limit.'
          : 'Draft storage is temporarily unavailable. Please try again later.',
      });
    }

    let bodyWritten = false;
    try {
      await env.STORAGE.put(key, htmlBody);
      bodyWritten = true;
      await env.DB.prepare(
        `INSERT INTO messages
         (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, size_bytes, folder, draft_owner_id, is_read, received_at, created_at, in_reply_to)
         VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, 'drafts', ?, 1, datetime('now'), datetime('now'), ?)`,
      ).bind(
        draftId, mailbox.id, `<${draftId}@${domain}>`, from, JSON.stringify(toRecipients),
        JSON.stringify(ccRecipients), subject, snippet, key, htmlBodyBytes, locals.user.id, inReplyTo,
      ).run();
    } catch {
      if (bodyWritten) await env.STORAGE.delete(key).catch(() => undefined);
      await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
      return fail(500, { error: 'The draft could not be stored. Please try again.' });
    }
    return { savedDraftId: draftId, savedAt: new Date().toISOString() };
  },

  discard: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    const formData = await request.formData();
    const draftId = stringValue(formData.get('draft_id'));
    if (!draftId) return fail(400, { error: 'Draft ID is required' });
    const draft = await env.DB.prepare(
      `SELECT m.body_r2_key FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
         AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
    ).bind(draftId, locals.user.id, locals.user.id).first<{ body_r2_key: string | null }>();
    if (!draft) return fail(404, { error: 'Draft not found' });
    if (draft.body_r2_key) await env.STORAGE.delete(draft.body_r2_key);
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(draftId).run();
    throw redirect(303, '/mail?folder=drafts');
  },
};
