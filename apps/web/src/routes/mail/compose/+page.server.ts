import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Attachment, Mailbox, Message, MessageImportance } from '@cmail/shared/types';
import { sendNewMailNotifications } from '@cmail/shared/push';
import { normalizeMessageImportance } from '@cmail/shared/message-importance';
import { sanitizeParticipantName } from '@cmail/shared/message-participants';
import { contactUpsertStatements } from '@cmail/shared/contacts';
import { buildReplyRecipients } from '$lib/server/reply-recipients';
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
  publicRuntimeConfig,
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
  acceptInternalJournal,
  applyProviderResult,
  cancelRetryableJournal,
  claimOutboundDispatch,
  cleanupJournalStaging,
  findActiveOutboundJournal,
  findDraftOutboundJournal,
  fingerprintJournalPayload,
  getOutboundJournal,
  getOutboundJournalParts,
  insertOutboundJournal,
  journalStateResponse,
  loadJournalOutboundEmail,
  loadProviderResultSnapshot,
  materializeOutboundJournal,
  persistProviderResultSnapshot,
  releaseJournalReservations,
  stageJournalPayload,
  type OutboundJournalRow,
} from '$lib/server/outbound-journal';
import {
  getProviderInfo,
  preflightEmail,
  sanitizeSenderDisplayName,
  sendEmail,
  supportsSeparatedEnvelope,
  type OutboundAttachment,
  type OutboundEmail,
} from '$lib/server/outbound';
import { consumeRateLimit } from '$lib/server/rate-limit';
import { planRecipientDelivery } from '$lib/server/recipient-delivery';
import {
  deriveReplyThreading,
  safeMessageId,
  safeReferences,
} from '$lib/server/message-threading';
import { sendIdempotencyKey } from '$lib/server/send-idempotency';
import { normalizeDomain, normalizeEmail, parseRecipientList } from '$lib/server/validation';
import {
  buildQuotedMessageHtml,
  prepareComposeBody,
  safeComposeReturnHref,
  splitStoredComposeBody,
  type ComposeBodyFailureReason,
} from '$lib/server/compose-body';
import { formatQuoteDate } from '$lib/dates';
import { appendSignatureToAuthoredHtml, getEffectiveSignature } from '$lib/server/signatures';

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

async function replyThreadingForSource(
  db: D1Database,
  userId: string,
  sourceId: string,
): Promise<{ inReplyTo: string | null; referencesHeader: string | null } | null> {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(sourceId)) return null;
  const source = await db.prepare(
    `SELECT m.message_id_header, m.in_reply_to, m.references_header
     FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(sourceId, userId, userId).first<Pick<Message, 'message_id_header' | 'in_reply_to' | 'references_header'>>();
  if (!source) return null;
  return deriveReplyThreading(source);
}

function safeDraftVersion(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
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
  if (!object) throw new Error('Message body object is unavailable');
  return object.text();
}

type AddressParticipant = { address: string; name?: string };

function addressParticipants(value: string): AddressParticipant[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.flatMap((item): AddressParticipant[] => typeof item === 'string' && item.trim()
        ? [{ address: item }]
        : [])
      : [];
  } catch {
    return [];
  }
}

function displayParticipants(value: string, fallback: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      const labels = parsed.flatMap((item): string[] => {
        if (!item || typeof item !== 'object') return [];
        const participant = item as { address?: unknown; name?: unknown };
        if (typeof participant.address !== 'string' || !participant.address.trim()) return [];
        const address = participant.address.trim();
        const name = sanitizeParticipantName(participant.name);
        return [name ? `${name} <${address}>` : address];
      });
      if (labels.length) return labels.join(', ');
    }
  } catch {
    // Historic rows store only the address array.
  }
  return addressParticipants(fallback).map((participant) => participant.address).join(', ');
}

function displaySender(name: string | undefined, address: string): string {
  const safeName = sanitizeParticipantName(name);
  return safeName ? `${safeName} <${address}>` : address;
}

function validTraceRecipients(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 50).join(', ')
      : '';
  } catch {
    return '';
  }
}

async function restoreJournalDraftClaim(db: D1Database, journal: OutboundJournalRow): Promise<void> {
  if (!journal.draft_id || journal.claimed_draft_version === null || journal.claimed_draft_version < 1) return;
  await db.prepare(
    `UPDATE messages SET draft_version = ?
     WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
  ).bind(
    journal.claimed_draft_version - 1,
    journal.draft_id,
    journal.user_id,
    journal.claimed_draft_version,
  ).run().catch(() => undefined);
}

async function cleanupTerminalJournal(
  db: D1Database,
  storage: R2Bucket,
  journal: OutboundJournalRow,
): Promise<void> {
  await releaseJournalReservations(db, journal.id).catch(() => undefined);
  await restoreJournalDraftClaim(db, journal);
  const parts = await getOutboundJournalParts(db, journal.id).catch(() => null);
  if (parts) {
    await cleanupJournalStaging(storage, journal, parts.attachments, journal.dispatch_token);
  }
}

function composeBodyFailure(reason: ComposeBodyFailureReason): { status: 400 | 413; error: string } {
  if (reason === 'combined_bytes') {
    return { status: 413, error: 'Message and quoted email exceed the 1 MB draft limit.' };
  }
  if (reason === 'input_bytes' || reason === 'output_bytes') {
    return { status: 413, error: 'Quoted email exceeds the 512 KB safety limit. Remove the quote and try again.' };
  }
  return {
    status: 400,
    error: 'Quoted email is too complex to include safely. Remove the quote and try again.',
  };
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
  const requestedMailboxId = (url.searchParams.get('mailbox') || '').slice(0, 64);

  const replyId = url.searchParams.get('reply');
  const replyAllId = url.searchParams.get('replyAll');
  const forwardId = url.searchParams.get('forward');
  const draftId = url.searchParams.get('draft');
  const requestedRecoveryId = url.searchParams.get('compose');
  const recoveryId = requestedRecoveryId && UUID_PATTERN.test(requestedRecoveryId)
    ? requestedRecoveryId
    : crypto.randomUUID();
  let replyTo: Message | null = null;
  let replyQuoteHtml = '';
  let quoteWarning = '';
  let forwardedAttachmentCount = 0;
  let forwardedAttachments: Array<Pick<Attachment, 'id' | 'filename' | 'content_type' | 'size_bytes' | 'disposition'>> = [];
  let omittedReplyInlineImageCount = 0;
  let draft: {
    id: string;
    from_address: string;
    to_addresses: string;
    cc_addresses: string;
    bcc_addresses: string;
    subject: string;
    body: string;
    quoted_html: string;
    in_reply_to: string | null;
    references_header: string | null;
    importance: MessageImportance;
    saved_at: string;
    draft_version: number;
  } | null = null;

  if (draftId) {
    const existing = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
         AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
    ).bind(draftId, locals.user.id, locals.user.id).first<Message>();
    if (existing) {
      let storedBody;
      try {
        storedBody = splitStoredComposeBody(await loadBody(env.STORAGE, existing.body_r2_key));
      } catch {
        throw error(503, 'This draft\'s content is temporarily unavailable. Reload before editing so the saved text is not overwritten.');
      }
      draft = {
        id: existing.id,
        from_address: existing.from_address,
        to_addresses: existing.to_addresses,
        cc_addresses: existing.cc_addresses,
        bcc_addresses: existing.bcc_addresses,
        subject: existing.subject,
        body: storedBody.authoredText,
        quoted_html: storedBody.quotedHtml,
        in_reply_to: existing.in_reply_to,
        references_header: existing.references_header,
        importance: existing.importance,
        saved_at: existing.received_at,
        draft_version: existing.draft_version,
      };
    }
  }

  const sourceId = replyId || replyAllId || forwardId;
  if (sourceId) {
    replyTo = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
        WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
          AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
    ).bind(sourceId, locals.user.id, locals.user.id).first<Message>();
    if (replyTo) {
      // Quoted HTML deliberately strips cid: sources. Surface that content loss
      // on replies. For forwards, expose every MIME part through the existing
      // authenticated forced-download endpoint for deliberate reattachment.
      if (forwardId) {
        const sourceAttachments = await env.DB.prepare(
          `SELECT id, filename, content_type, size_bytes, disposition
           FROM attachments WHERE message_id = ?
           ORDER BY filename COLLATE NOCASE, id`,
        ).bind(replyTo.id).all<Pick<Attachment, 'id' | 'filename' | 'content_type' | 'size_bytes' | 'disposition'>>();
        forwardedAttachments = sourceAttachments.results || [];
        forwardedAttachmentCount = forwardedAttachments.length;
      } else {
        const attachmentCounts = await env.DB.prepare(
          `SELECT SUM(CASE WHEN disposition = 'inline' OR content_id IS NOT NULL THEN 1 ELSE 0 END) AS inline_count
           FROM attachments WHERE message_id = ?`,
        ).bind(replyTo.id).first<{ inline_count: number | null }>();
        omittedReplyInlineImageCount = Number(attachmentCounts?.inline_count || 0);
      }
      const runtime = publicRuntimeConfig(env as unknown as Record<string, unknown>);
      const draftKind = forwardId ? 'forward' : 'reply';
      try {
        const builtQuote = buildQuotedMessageHtml(
          await loadBody(env.STORAGE, replyTo.body_r2_key),
          {
            kind: forwardId ? 'forward' : 'reply',
            from: displaySender(replyTo.from_name, replyTo.from_address),
            date: formatQuoteDate(replyTo.received_at, runtime.locale, runtime.timeZone),
            subject: replyTo.subject,
            to: displayParticipants(replyTo.to_participants, replyTo.to_addresses),
            cc: displayParticipants(replyTo.cc_participants, replyTo.cc_addresses),
          },
        );
        if (builtQuote.ok) replyQuoteHtml = builtQuote.html;
        else quoteWarning = `The original message is too large or complex to quote safely. Your ${draftKind} can still be saved and sent.`;
      } catch {
        quoteWarning = `The original message is temporarily unavailable and was not included. Your ${draftKind} can still be saved and sent.`;
      }
    }
  }

  const mailboxes = sendableMailboxes.results || [];
  const assignedMailboxRows = sourceId && !forwardId
    ? await env.DB.prepare(
      `SELECT m.address FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE ma.user_id = ? AND m.status = 'active'`,
    ).bind(locals.user.id).all<{ address: string }>()
    : { results: [] as Array<{ address: string }> };
  const replyRecipients = replyTo && !forwardId
    ? buildReplyRecipients(
      replyTo,
      (assignedMailboxRows.results || []).map((mailbox) => mailbox.address),
      Boolean(replyAllId),
    )
    : { to: [], cc: [] };
  const preferredFrom = draft?.from_address
    || (replyTo ? mailboxes.find((mailbox) => mailbox.id === replyTo.mailbox_id)?.address : '')
    || mailboxes.find((mailbox) => mailbox.id === requestedMailboxId)?.address
    || mailboxes[0]?.address
    || '';
  const signature = await getEffectiveSignature(env.DB, locals.user.id, preferredFrom);
  const fallbackReturn = sourceId
    ? `/mail/${encodeURIComponent(sourceId)}`
    : draftId
      ? `/mail/${encodeURIComponent(draftId)}?folder=drafts`
      : '/mail';

  return {
    mailboxes,
    preferredFrom,
    replyTo,
    replyRecipients,
    replyQuoteHtml,
    quoteWarning,
    forwardedAttachmentCount,
    forwardedAttachments,
    omittedReplyInlineImageCount,
    isForward: !!forwardId,
    isReplyAll: Boolean(replyAllId),
    replySourceId: replyTo && !forwardId ? replyTo.id : '',
    // Kept for the existing preview. The separate fields let settings-aware UI
    // label personal versus organisation content without parsing HTML.
    signature: signature.html,
    effectiveSignature: signature,
    draft,
    returnHref: safeComposeReturnHref(url.searchParams.get('returnTo'), fallbackReturn),
    recoveryId,
    recoveryKey: `cmail:compose:${locals.user.id}:${draftId ? `draft:${draftId}` : sourceId ? `${forwardId ? 'forward' : replyAllId ? 'reply-all' : 'reply'}:${sourceId}:${recoveryId}` : `new:${recoveryId}`}`,
    recoveryPrefix: `cmail:compose:${locals.user.id}:`,
    composeToken: crypto.randomUUID(),
    outboundProvider: getProviderInfo(env as unknown as Record<string, unknown>).name,
  };
};

export const actions: Actions = {
  send: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const user = locals.user;
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    // Set once bcc is parsed below, before completeAcceptedJournal can ever
    // run. Bcc never enters the durable journal/materialize path (it stays
    // an envelope-only routing detail there); it is applied to the sender's
    // own sent-copy row as a best-effort follow-up, the same way drafts
    // persist it directly. A crash between materialize and this follow-up
    // only risks the sender's own "Bcc:" display label, never delivery.
    let bccRecipients: string[] = [];
    const completeAcceptedJournal = async (journal: OutboundJournalRow): Promise<boolean> => {
      const completed = await materializeOutboundJournal(env.DB, env.STORAGE, journal.id);
      if (completed.newInternalDeliveries.length) {
        platform?.context.waitUntil(Promise.all(
          completed.newInternalDeliveries.map((delivery) =>
            sendNewMailNotifications(env, delivery.mailboxId, delivery.messageId)),
        ).then(() => undefined));
      }
      if (journal.state === 'accepted') {
        await audit(env.DB, {
          event_type: 'email.sent',
          actor_id: user.id,
          actor_role: user.role,
          target: journal.id,
          detail: `Durable outbound send materialized; provider ${journal.provider}`,
          session_id: locals.sessionId,
        }).catch(() => undefined);
      }
      if (bccRecipients.length) {
        await env.DB.prepare(
          `UPDATE messages SET bcc_addresses = ?, bcc_participants = ?
           WHERE id = ? AND mailbox_id = ? AND folder = 'sent'`,
        ).bind(
          JSON.stringify(bccRecipients),
          JSON.stringify(bccRecipients.map((address) => ({ address, name: '' }))),
          journal.id,
          journal.mailbox_id,
        ).run().catch(() => undefined);
      }
      return completed.journal.partial_delivery === 1;
    };
    if (requestExceedsComposeLimit(request)) return fail(413, { error: 'Compose request exceeds 24 MB limit' });

    const formData = await request.formData();
    if (formDataExceedsComposeLimit(formData)) return fail(413, { error: 'Compose request exceeds 24 MB limit' });
    const from = normalizeEmail(stringValue(formData.get('from')));
    const subjectInput = stringValue(formData.get('subject')).trim();
    const subject = subjectInput || '(no subject)';
    const body = stringValue(formData.get('body'));
    const quotedHtml = stringValue(formData.get('quoted_html'));
    const replySourceId = stringValue(formData.get('reply_source_id'));
    const importance = normalizeMessageImportance(stringValue(formData.get('importance')));
    const draftId = stringValue(formData.get('draft_id')) || null;
    const expectedDraftVersion = safeDraftVersion(formData.get('draft_version'));
    const composeToken = stringValue(formData.get('compose_token'));
    const envRecord = env as unknown as Record<string, unknown>;
    const recipientLimit = maxRecipientsPerMessage(envRecord);
    const toResult = parseRecipientList(formData.get('to'), recipientLimit);
    const ccResult = parseRecipientList(formData.get('cc'), recipientLimit);
    const bccResult = parseRecipientList(formData.get('bcc'), recipientLimit);

    if (!from) return fail(400, { error: 'Choose a valid From address' });
    if (toResult.error || !toResult.recipients.length) return fail(400, { error: toResult.error || 'At least one To recipient is required' });
    if (ccResult.error) return fail(400, { error: ccResult.error });
    if (bccResult.error) return fail(400, { error: bccResult.error });
    const toSet = new Set(toResult.recipients);
    const ccRecipients = ccResult.recipients.filter((address) => !toSet.has(address));
    const toCcSet = new Set([...toResult.recipients, ...ccRecipients]);
    // Bcc is silently deduped against To/Cc: an address already visible on
    // the message gains nothing from also being envelope-only.
    bccRecipients = bccResult.recipients.filter((address) => !toCcSet.has(address));
    const allRecipients = [...toResult.recipients, ...ccRecipients, ...bccRecipients];
    if (allRecipients.length > recipientLimit) return fail(400, { error: `Max ${recipientLimit} recipients per message` });
    if (subject.length > MAX_SUBJECT_LENGTH) return fail(400, { error: `Subject is too long (max ${MAX_SUBJECT_LENGTH} characters)` });
    if (body.length > MAX_BODY_LENGTH) return fail(413, { error: 'Message body is too large' });
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > MAX_BODY_BYTES) return fail(413, { error: 'Message body exceeds 1 MB limit' });
    const preparedBody = prepareComposeBody(body, quotedHtml);
    if (!preparedBody.ok) {
      const failure = composeBodyFailure(preparedBody.reason);
      return fail(failure.status, { error: failure.error });
    }
    if (!/^[0-9a-f-]{36}$/i.test(composeToken)) return fail(400, { error: 'This compose form expired. Reload and try again.' });
    if (draftId && expectedDraftVersion === null) {
      return fail(400, { error: 'Draft version missing. Reload before sending.' });
    }
    const observedDraftVersion = expectedDraftVersion ?? 0;
    let sendClaimId = draftId
      ? sendIdempotencyKey(draftId, composeToken, observedDraftVersion + 1)
      : sendIdempotencyKey(null, composeToken);
    let existingJournal: OutboundJournalRow | null;
    try {
      existingJournal = draftId
        ? await findDraftOutboundJournal(
          env.DB,
          locals.user.id,
          draftId,
          observedDraftVersion,
        )
        : await findActiveOutboundJournal(env.DB, locals.user.id, sendClaimId);
    } catch {
      return fail(503, { error: 'The send journal is temporarily unavailable. No provider call was made; retry shortly.' });
    }
    if (existingJournal) sendClaimId = existingJournal.idempotency_key;
    if (existingJournal?.state === 'dispatching' && existingJournal.dispatch_token) {
      const recoveredResult = await loadProviderResultSnapshot(
        env.STORAGE,
        existingJournal.id,
        existingJournal.dispatch_token,
      ).catch(() => null);
      if (recoveredResult) {
        await applyProviderResult(
          env.DB,
          existingJournal.id,
          existingJournal.dispatch_token,
          recoveredResult,
        ).catch(() => undefined);
        existingJournal = await getOutboundJournal(env.DB, existingJournal.id);
      }
    }
    if (existingJournal && ['accepted', 'materialized'].includes(existingJournal.state)) {
      try {
        const partial = await completeAcceptedJournal(existingJournal);
        throw redirect(303, `/mail?folder=sent${partial ? '&delivery=partial' : ''}`);
      } catch (caught) {
        if (caught && typeof caught === 'object' && 'status' in caught && 'location' in caught) throw caught;
        return fail(503, {
          error: 'The provider accepted this message, but its Sent copy is still recovering. Retry this draft — cmail won\'t send it again.',
        });
      }
    }
    if (existingJournal?.state === 'permanent_failure') {
      await cleanupTerminalJournal(env.DB, env.STORAGE, existingJournal);
      return fail(502, {
        error: existingJournal.last_error || 'The provider rejected this message. It wasn\'t delivered; review the draft before trying again.',
      });
    }
    if (existingJournal?.state === 'retryable_failure') {
      const cancelled = await cancelRetryableJournal(env.DB, existingJournal.id).catch(() => false);
      if (!cancelled) {
        return fail(503, { error: 'The previous rejected attempt couldn\'t be released safely. Retry after the database recovers.' });
      }
      await cleanupTerminalJournal(env.DB, env.STORAGE, { ...existingJournal, state: 'cancelled' });
      existingJournal = null;
    }
    if (existingJournal && ['dispatching', 'ambiguous'].includes(existingJournal.state)) {
      return fail(502, {
        error: 'Delivery status is unknown. Don\'t resend this message — ask an administrator to check the send record.',
      });
    }

    const mailbox = await env.DB.prepare(
      `SELECT m.id, m.address, m.display_name FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
    ).bind(from, locals.user.id).first<{ id: string; address: string; display_name: string }>();
    if (!mailbox) return fail(403, { error: 'You don\'t have permission to send from this address' });
    const fromName = sanitizeSenderDisplayName(
      mailbox.display_name.trim() || locals.user.display_name.trim(),
    );

    let sourceDraft: {
      body_r2_key: string | null;
      draft_version: number;
      in_reply_to: string | null;
      references_header: string | null;
    } | null = null;
    if (draftId) {
      sourceDraft = await env.DB.prepare(
        `SELECT m.body_r2_key, m.draft_version, m.in_reply_to, m.references_header FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
           AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
      ).bind(draftId, locals.user.id, locals.user.id).first<{
        body_r2_key: string | null;
        draft_version: number;
        in_reply_to: string | null;
        references_header: string | null;
      }>();
      if (!sourceDraft) return fail(404, { error: 'Draft not found' });
      const journalOwnsDraftClaim = existingJournal
        && existingJournal.draft_id === draftId
        && existingJournal.claimed_draft_version === sourceDraft.draft_version
        && (
          existingJournal.claimed_draft_version === observedDraftVersion
          || existingJournal.claimed_draft_version === observedDraftVersion + 1
        );
      if (sourceDraft.draft_version !== expectedDraftVersion && !journalOwnsDraftClaim) {
        return fail(409, {
          error: 'This draft changed in another tab. Your copy is safe; reload to compare versions.',
          draftConflict: true,
        });
      }
    }

    let inReplyTo = safeMessageId(sourceDraft?.in_reply_to || '');
    let referencesHeader = safeReferences(sourceDraft?.references_header || '');
    if (!sourceDraft && replySourceId) {
      const threading = await replyThreadingForSource(env.DB, locals.user.id, replySourceId);
      if (!threading) return fail(404, { error: 'The original message is no longer available for this reply. Reload and try again.' });
      inReplyTo = threading.inReplyTo;
      referencesHeader = threading.referencesHeader;
    }

    const rawAttachments = formData.getAll('attachments').filter((value): value is File => value instanceof File && value.size > 0);
    if (rawAttachments.length > MAX_ATTACHMENTS) return fail(413, { error: `Max ${MAX_ATTACHMENTS} attachments per message` });
    let totalAttachmentBytes = 0;
    const attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }> = [];
    for (const file of rawAttachments) {
      const filename = file.name.replace(/[\x00-\x1f\x7f\\/]/g, '_').slice(0, 255) || 'attachment';
      const extension = getExtension(filename);
      if (BLOCKED_EXTENSIONS.has(extension)) return fail(400, { error: `Attachment type not allowed: ${extension}` });
      totalAttachmentBytes += file.size;
      if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) return fail(413, { error: 'Attachments exceed 20 MB limit' });
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
    const {
      providerTo,
      providerCc,
      providerRecipients,
      localRecipients,
    } = planRecipientDelivery(
      toResult.recipients,
      ccRecipients,
      bccRecipients,
      new Set(internalMap.keys()),
      supportsSeparatedEnvelope(envRecord),
    );
    const hasExternalRecipients = providerRecipients.length > 0;
    // Mixed messages retain the complete visible To/Cc list while Cloudflare's
    // raw transport sends only to the external SMTP envelope. This avoids both
    // header distortion and duplicate/loopback delivery to local recipients.

    const signature = await getEffectiveSignature(env.DB, locals.user.id, from);
    // Match familiar email clients: the sender's signature belongs immediately
    // after their new text, before the immutable quoted conversation.
    const htmlWithSignature = `${appendSignatureToAuthoredHtml(preparedBody.authoredHtml, signature.html)}${preparedBody.quotedHtml}`;
    const textWithSignature = [
      body.trimEnd(),
      signature.text,
      preparedBody.quotedText,
    ].filter(Boolean).join('\n\n');
    const mailDomain = normalizeDomain(env.MAIL_DOMAIN);
    if (!mailDomain) {
      return fail(503, { error: 'Mail domain is not configured. Contact an administrator.' });
    }
    const messageId = generateId();
    const localMessageIdHeader = `<${messageId}@${mailDomain}>`;

    const outboundEmail: OutboundEmail | null = hasExternalRecipients ? {
      from,
      ...(fromName ? { fromName } : {}),
      to: providerTo,
      cc: providerCc,
      envelopeRecipients: providerRecipients,
      subject,
      html: htmlWithSignature,
      text: textWithSignature,
      headers: inReplyTo ? {
        'In-Reply-To': inReplyTo,
        ...(referencesHeader ? { 'References': referencesHeader } : {}),
      } : undefined,
      importance,
      messageIdHeader: localMessageIdHeader,
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
      providerRecipients.length,
      localRecipients.length,
      internalMap.size,
      attachments.length,
    );
    if (workload.deliveryBytes > MAX_DELIVERY_BYTES_PER_SEND) {
      return fail(413, { error: 'This send exceeds the 250 MB delivery limit. Reduce recipients or attachment size.' });
    }
    if (workload.persistedBytes > MAX_PERSISTED_BYTES_PER_SEND) {
      return fail(413, { error: 'This send would store more than 100 MB across internal mailboxes. Reduce recipients or attachment size.' });
    }
    if (workload.persistedObjects > MAX_PERSISTED_OBJECTS_PER_SEND) {
      return fail(413, { error: 'This send would create too many internal attachment copies. Reduce recipients or attachment count.' });
    }

    const plannedInternalDeliveries = localRecipients.flatMap((recipient) => {
      const mailboxId = internalMap.get(recipient);
      return mailboxId ? [{ mailboxId, messageId: generateId() }] : [];
    });
    const plannedTargets = [
      {
        id: generateId(),
        messageId,
        mailboxId: mailbox.id,
        direction: 'outbound' as const,
        folder: 'sent' as const,
        attachmentIds: attachments.map(() => generateId()),
      },
      ...plannedInternalDeliveries.map((delivery) => ({
        id: generateId(),
        messageId: delivery.messageId,
        mailboxId: delivery.mailboxId,
        direction: 'internal' as const,
        folder: 'inbox' as const,
        attachmentIds: attachments.map(() => generateId()),
      })),
    ];
    const journalProvider = outboundEmail ? getProviderInfo(envRecord).name : 'none';
    const threadId = referencesHeader?.split(' ')[0] || inReplyTo || localMessageIdHeader;
    const fingerprint = await fingerprintJournalPayload({
      provider: journalProvider,
      from,
      fromName,
      to: toResult.recipients,
      cc: ccRecipients,
      envelopeRecipients: providerRecipients,
      subject,
      html: htmlWithSignature,
      text: textWithSignature,
      snippet: preparedBody.snippet,
      importance,
      inReplyTo,
      referencesHeader,
      threadId,
      deliveryTargets: plannedTargets.map((target) => ({
        mailboxId: target.mailboxId,
        direction: target.direction,
        folder: target.folder,
      })),
      attachments,
    });

    if (existingJournal && existingJournal.payload_hash !== fingerprint.payloadHash) {
      const cancelled = await cancelRetryableJournal(env.DB, existingJournal.id).catch(() => false);
      if (!cancelled) {
        return fail(409, {
          error: 'This message already crossed the delivery boundary. Don\'t resend it — check Sent, or ask an administrator to inspect the send record.',
        });
      }
      await cleanupTerminalJournal(env.DB, env.STORAGE, {
        ...existingJournal,
        state: 'cancelled',
      });
      existingJournal = null;
      if (sourceDraft && expectedDraftVersion !== null) sourceDraft.draft_version = expectedDraftVersion;
    }

    let claimedDraftVersion: number | null = existingJournal?.claimed_draft_version ?? null;
    const releaseDraftClaim = async (): Promise<void> => {
      if (!draftId || claimedDraftVersion === null || expectedDraftVersion === null) return;
      await env.DB.prepare(
        `UPDATE messages SET draft_version = ?
         WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
      ).bind(expectedDraftVersion, draftId, user.id, claimedDraftVersion).run().catch(() => undefined);
      claimedDraftVersion = null;
    };

    let journal = existingJournal;
    if (!journal) {
      if (draftId && expectedDraftVersion !== null) {
        let claim: D1Result;
        try {
          claim = await env.DB.prepare(
            `UPDATE messages SET draft_version = draft_version + 1
             WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
          ).bind(draftId, locals.user.id, expectedDraftVersion).run();
        } catch {
          return fail(503, {
            error: 'The draft couldn\'t be reserved for sending. Your text is safe; reload to compare the latest draft before retrying.',
            draftConflict: true,
          });
        }
        if (!claim.meta.changes) {
          return fail(409, {
            error: 'This draft changed in another tab. Your copy is safe; reload to compare versions.',
            draftConflict: true,
          });
        }
        claimedDraftVersion = expectedDraftVersion + 1;
      }

      let sendRate: Awaited<ReturnType<typeof consumeRateLimit>>;
      try {
        sendRate = await consumeRateLimit(
          env.DB,
          'outbound',
          locals.user.id,
          outboundRateLimitPerHour(envRecord),
          60 * 60,
        );
      } catch {
        await releaseDraftClaim();
        return fail(503, { error: 'Couldn\'t check sending limits right now. Your draft is safe; try again shortly.' });
      }
      if (!sendRate.allowed) {
        await releaseDraftClaim();
        return fail(429, { error: `Hourly send limit reached. Try again in about ${Math.ceil(sendRate.retryAfter / 60)} minutes.` });
      }

      let workRate: Awaited<ReturnType<typeof consumeRateLimit>>;
      try {
        workRate = await consumeRateLimit(
          env.DB,
          'outbound-work',
          locals.user.id,
          outboundWorkLimitPerHour(envRecord),
          60 * 60,
          workload.workUnits,
        );
      } catch {
        await releaseDraftClaim();
        return fail(503, { error: 'Couldn\'t check sending limits right now. Your draft is safe; try again shortly.' });
      }
      if (!workRate.allowed) {
        await releaseDraftClaim();
        return fail(429, { error: `Hourly recipient and attachment limit reached. Try again in about ${Math.ceil(workRate.retryAfter / 60)} minutes.` });
      }

      const storageResult = await reserveMailboxStorage(
        env.DB,
        env,
        plannedTargets.map((target) => ({
          mailboxId: target.mailboxId,
          deliveryKey: target.messageId,
          bytes: persistedPayloadBytes,
        })),
      );
      if (storageResult.status !== 'accepted') {
        await releaseDraftClaim();
        return fail(storageResult.status === 'rejected' ? 507 : 503, {
          error: storageResult.status === 'rejected'
            ? 'Mailbox storage limit reached. Free some space or ask an administrator to raise the configured quota.'
            : 'Mailbox storage is temporarily unavailable. Please try again later.',
        });
      }
      const storageReservations: MailboxStorageReservation[] = storageResult.reservations;
      let staged;
      try {
        staged = await stageJournalPayload(
          env.STORAGE,
          messageId,
          htmlWithSignature,
          textWithSignature,
          attachments,
          fingerprint,
        );
      } catch {
        await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
        await releaseDraftClaim();
        return fail(503, { error: 'The message couldn\'t be prepared safely. Your draft is unchanged; try again shortly.' });
      }

      try {
        await insertOutboundJournal(env.DB, {
          id: messageId,
          userId: locals.user.id,
          mailboxId: mailbox.id,
          idempotencyKey: sendClaimId,
          fingerprint,
          staged,
          provider: journalProvider,
          from,
          fromName,
          to: toResult.recipients,
          cc: ccRecipients,
          envelopeRecipients: providerRecipients,
          subject,
          snippet: preparedBody.snippet,
          importance,
          inReplyTo,
          referencesHeader,
          threadId,
          proposedMessageIdHeader: localMessageIdHeader,
          persistedBytes: persistedPayloadBytes,
          providerPayloadBytes,
          draftId,
          claimedDraftVersion,
          draftBodyR2Key: sourceDraft?.body_r2_key || null,
          targets: plannedTargets,
          attachments,
          reservations: storageReservations,
        });
        journal = await getOutboundJournal(env.DB, messageId);
      } catch {
        let recoveryReadSucceeded = false;
        let recovered: OutboundJournalRow | null = null;
        try {
          recovered = await findActiveOutboundJournal(env.DB, locals.user.id, sendClaimId);
          recoveryReadSucceeded = true;
        } catch {
          // A failed D1 batch response can follow a committed transaction. Keep
          // every staged object and reservation unless D1 proves it did not.
        }
        if (!recoveryReadSucceeded) {
          return fail(503, {
            error: 'The send reservation couldn\'t be confirmed. No provider call was made; retry after the database recovers so cmail can reconcile it safely.',
          });
        }
        if (!recovered || recovered.payload_hash !== fingerprint.payloadHash) {
          await Promise.all(staged.stagedKeys.map((key) => env.STORAGE.delete(key).catch(() => undefined)));
          await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
          await releaseDraftClaim();
          return fail(recovered ? 409 : 503, {
            error: recovered
              ? 'A different version of this message was already reserved. Reload before continuing.'
              : 'The send record couldn\'t be confirmed. Your draft is safe; try again shortly.',
            ...(recovered ? { draftConflict: true } : {}),
          });
        }
        journal = recovered;
        if (recovered.id !== messageId) {
          await Promise.all(staged.stagedKeys.map((key) => env.STORAGE.delete(key).catch(() => undefined)));
          await releaseMailboxStorageReservations(env.DB, storageReservations).catch(() => undefined);
        }
      }
    }

    if (!journal) {
      await releaseDraftClaim();
      return fail(503, { error: 'The send record is unavailable. Your draft is safe; try again shortly.' });
    }

    if (journal.state === 'pending' || journal.state === 'retryable_failure') {
      if (journal.provider === 'none') {
        try {
          await acceptInternalJournal(env.DB, journal.id);
        } catch {
          return fail(503, { error: 'Internal delivery was safely prepared but couldn\'t be completed. Retry this draft.' });
        }
      } else {
        const parts = await getOutboundJournalParts(env.DB, journal.id).catch(() => null);
        if (!parts) return fail(503, { error: 'The prepared message is temporarily unavailable. Retry shortly.' });
        let stagedEmail: OutboundEmail;
        try {
          stagedEmail = await loadJournalOutboundEmail(env.STORAGE, journal, parts.attachments);
        } catch {
          return fail(503, { error: 'The prepared message is incomplete. Don\'t resend; ask an administrator to inspect the send record.' });
        }
        const pinnedEnv = { ...envRecord, OUTBOUND_PROVIDER: journal.provider };
        const preflight = preflightEmail(stagedEmail, pinnedEnv);
        if (!preflight.ok) return fail(preflight.status, { error: preflight.error });

        const dispatchToken = crypto.randomUUID();
        let claimed: boolean;
        try {
          claimed = await claimOutboundDispatch(env.DB, journal.id, dispatchToken);
        } catch {
          return fail(503, { error: 'Couldn\'t confirm dispatch state. No provider call was made; retry shortly.' });
        }
        if (!claimed) {
          journal = await getOutboundJournal(env.DB, journal.id);
          if (!journal || ['dispatching', 'ambiguous'].includes(journal.state)) {
            return fail(502, { error: 'Delivery is already in progress, or its status is unknown. Don\'t resend; ask an administrator to check the send record.' });
          }
        } else {
          let result: Awaited<ReturnType<typeof sendEmail>>;
          try {
            result = await sendEmail(stagedEmail, pinnedEnv);
          } catch {
            result = {
              success: false,
              provider: journal.provider,
              ambiguous: true,
              error: 'The provider result is unknown',
            };
          }
          await persistProviderResultSnapshot(
            env.STORAGE,
            journal.id,
            dispatchToken,
            result,
          ).catch(() => undefined);
          let resultState;
          try {
            resultState = await applyProviderResult(env.DB, journal.id, dispatchToken, result);
          } catch {
            await audit(env.DB, {
              event_type: 'email.delivery_unknown',
              actor_id: locals.user.id,
              actor_role: locals.user.role,
              target: journal.id,
              detail: `Provider ${journal.provider} returned, but durable reconciliation could not be confirmed`,
            }).catch(() => undefined);
            return fail(502, { error: 'Delivery status couldn\'t be reconciled. Don\'t resend; ask an administrator to inspect the send record.' });
          }

          await traceEmail(env.DB, {
            message_id_header: result.messageIdHeader || null,
            provider_message_ids: result.providerMessageIds || (result.messageId ? [result.messageId] : []),
            failed_recipients: result.permanentBounces || [],
            direction: 'outbound',
            envelope_from: journal.from_address,
            envelope_to: validTraceRecipients(journal.envelope_recipients),
            header_from: journal.from_address,
            subject: journal.subject.slice(0, 256),
            size_bytes: journal.provider_payload_bytes,
            status: result.success ? 'sent' : result.permanentFailure ? 'bounced' : result.ambiguous ? 'deferred' : 'rejected',
            status_detail: result.success
              ? result.partial
                ? `via ${result.provider}; permanent bounce: ${(result.permanentBounces || []).join(', ')}`
                : `via ${result.provider}`
              : result.error || `via ${result.provider}`,
          }).catch(() => undefined);
          journal = await getOutboundJournal(env.DB, journal.id);
          if (!journal) return fail(503, { error: 'The provider result was recorded, but the send record is temporarily unavailable.' });

          if (resultState === 'ambiguous') {
            await audit(env.DB, {
              event_type: 'email.delivery_unknown',
              actor_id: locals.user.id,
              actor_role: locals.user.role,
              target: journal.id,
              detail: `Outbound provider ${journal.provider} delivery status is unknown`,
            }).catch(() => undefined);
            return fail(502, { error: 'Delivery status is unknown. Don\'t resend this message — ask an administrator to check the send record.' });
          }
          if (resultState === 'permanent_failure') {
            await cleanupTerminalJournal(env.DB, env.STORAGE, journal);
            return fail(result.permanentBounces?.length ? 422 : 502, {
              error: result.permanentBounces?.length
                ? `Permanently rejected: ${result.permanentBounces.join(', ')}. Edit the recipients before sending again.`
                : 'The provider rejected this message. It wasn\'t delivered; review it and try again.',
            });
          }
          if (resultState === 'retryable_failure') {
            const cancelled = await cancelRetryableJournal(env.DB, journal.id).catch(() => false);
            if (cancelled) {
              await cleanupTerminalJournal(env.DB, env.STORAGE, { ...journal, state: 'cancelled' });
            }
            return fail(502, {
              error: cancelled
                ? 'The provider didn\'t accept this message. Your draft was kept; review it and try again.'
                : 'The provider didn\'t accept this message, but cleanup is pending. Retry after the database recovers.',
            });
          }
        }
      }
      journal = await getOutboundJournal(env.DB, journal.id);
    }

    const journalAction = journal ? journalStateResponse(journal.state) : 'unknown';
    if (journal && journalAction === 'materialize') {
      try {
        const partial = await completeAcceptedJournal(journal);
        // Recipient-suggestion history is best-effort: it must never turn an
        // already-successful send into a failure response, so its own
        // failure is swallowed here rather than reaching the outer catch.
        try {
          const contactStatements = contactUpsertStatements(
            env.DB,
            mailbox.id,
            [...toResult.recipients, ...ccRecipients, ...bccRecipients].map((address) => ({ address, name: '' })),
          );
          if (contactStatements.length) await env.DB.batch(contactStatements);
        } catch { /* non-fatal: suggestions are best-effort */ }
        throw redirect(303, `/mail?folder=sent${partial ? '&delivery=partial' : ''}`);
      } catch (caught) {
        if (caught && typeof caught === 'object' && 'status' in caught && 'location' in caught) throw caught;
        console.error('Accepted-send materialization failed', caught instanceof Error ? caught.message : String(caught));
        return fail(503, {
          error: 'The provider accepted this message, but its Sent copy is still recovering. Retry this draft — cmail won\'t send it again.',
        });
      }
    }
    if (journalAction === 'unknown') {
      return fail(502, { error: 'Delivery status is unknown. Don\'t resend this message — ask an administrator to check the send record.' });
    }
    if (journalAction === 'retryable') {
      return fail(502, { error: 'The provider didn\'t accept this message. Retry the same prepared copy, or edit it to start a new attempt.' });
    }
    return fail(503, { error: 'The send couldn\'t be completed. Your draft and send record are intact.' });
  },

  save: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    if (requestExceedsComposeLimit(request)) return fail(413, { error: 'Compose request exceeds 24 MB limit' });
    const formData = await request.formData();
    if (formDataExceedsComposeLimit(formData)) return fail(413, { error: 'Compose request exceeds 24 MB limit' });
    const from = normalizeEmail(stringValue(formData.get('from')));
    const to = stringValue(formData.get('to')).slice(0, 20_000);
    const cc = stringValue(formData.get('cc')).slice(0, 20_000);
    const bcc = stringValue(formData.get('bcc')).slice(0, 20_000);
    const subject = stringValue(formData.get('subject')).slice(0, MAX_SUBJECT_LENGTH) || '(no subject)';
    const body = stringValue(formData.get('body'));
    const quotedHtml = stringValue(formData.get('quoted_html'));
    const replySourceId = stringValue(formData.get('reply_source_id'));
    let inReplyTo: string | null = null;
    let referencesHeader: string | null = null;
    const importance = normalizeMessageImportance(stringValue(formData.get('importance')));
    const existingDraftId = stringValue(formData.get('draft_id')) || null;
    const expectedDraftVersion = safeDraftVersion(formData.get('draft_version'));
    const draftCreateToken = stringValue(formData.get('draft_create_token'));
    if (!from) return fail(400, { error: 'Choose a valid From address to save a draft' });
    if (!existingDraftId && !UUID_PATTERN.test(draftCreateToken)) {
      return fail(400, { error: 'This compose recovery token expired. Reload before saving.' });
    }
    if (body.length > MAX_BODY_LENGTH) return fail(413, { error: 'Message body is too large' });
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return fail(413, { error: 'Message body exceeds 1 MB limit' });
    const preparedBody = prepareComposeBody(body, quotedHtml);
    if (!preparedBody.ok) {
      const failure = composeBodyFailure(preparedBody.reason);
      return fail(failure.status, { error: failure.error });
    }

    const mailbox = await env.DB.prepare(
      `SELECT m.id, m.display_name FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
    ).bind(from, locals.user.id).first<{ id: string; display_name: string }>();
    if (!mailbox) return fail(403, { error: 'You don\'t have permission to draft from this address' });
    const fromName = sanitizeSenderDisplayName(mailbox.display_name.trim() || locals.user.display_name.trim());

    if (!existingDraftId) {
      const recovered = await env.DB.prepare(
        'SELECT draft_owner_id, folder, draft_version, received_at FROM messages WHERE id = ?',
      ).bind(draftCreateToken).first<{
        draft_owner_id: string | null;
        folder: string;
        draft_version: number;
        received_at: string;
      }>();
      if (recovered) {
        if (recovered.folder !== 'drafts' || recovered.draft_owner_id !== locals.user.id) {
          return fail(409, { error: 'This compose recovery token is already in use. Reload before saving.' });
        }
        return {
          savedDraftId: draftCreateToken,
          draftVersion: recovered.draft_version,
          savedAt: recovered.received_at,
          recoveredDraft: true,
        };
      }
    }

    if (!existingDraftId && replySourceId) {
      const threading = await replyThreadingForSource(env.DB, locals.user.id, replySourceId);
      if (!threading) return fail(404, { error: 'The original message is no longer available for this reply. Reload and try again.' });
      inReplyTo = threading.inReplyTo;
      referencesHeader = threading.referencesHeader;
    }

    const toRecipients = to.split(/[;,]/).map((address) => address.trim()).filter(Boolean).slice(0, 200);
    const ccRecipients = cc.split(/[;,]/).map((address) => address.trim()).filter(Boolean).slice(0, 200);
    const bccRecipients = bcc.split(/[;,]/).map((address) => address.trim()).filter(Boolean).slice(0, 200);
    // Draft entry is deliberately address-only. The authoritative send path
    // still validates and normalizes these values before any delivery.
    const toParticipantJson = JSON.stringify(toRecipients.map((address) => ({ address, name: '' })));
    const ccParticipantJson = JSON.stringify(ccRecipients.map((address) => ({ address, name: '' })));
    const bccParticipantJson = JSON.stringify(bccRecipients.map((address) => ({ address, name: '' })));
    const toAddressesJson = JSON.stringify(toRecipients);
    const ccAddressesJson = JSON.stringify(ccRecipients);
    const bccAddressesJson = JSON.stringify(bccRecipients);
    const snippet = preparedBody.snippet;
    const htmlBody = preparedBody.html;
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
        `SELECT m.body_r2_key, m.mailbox_id, m.size_bytes, m.draft_version, m.in_reply_to, m.references_header FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
           AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
      ).bind(existingDraftId, locals.user.id, locals.user.id).first<{
        body_r2_key: string | null;
        mailbox_id: string;
         size_bytes: number;
         draft_version: number;
         in_reply_to: string | null;
         references_header: string | null;
       }>();
      if (!existing) return fail(404, { error: 'Draft not found' });
      if (expectedDraftVersion === null) return fail(400, { error: 'Draft version missing. Reload before saving.' });
      if (existing.draft_version !== expectedDraftVersion) {
        return fail(409, {
          error: 'This draft changed in another tab. Your copy is safe; reload to compare versions.',
          draftConflict: true,
        });
      }
      // Threading metadata is immutable client-side once the draft exists.
      inReplyTo = safeMessageId(existing.in_reply_to || '');
      referencesHeader = safeReferences(existing.references_header || '');
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
            ? 'Mailbox storage or draft limit reached. Delete old drafts, or ask an administrator to raise the limit.'
            : 'Draft storage is temporarily unavailable. Try again later.',
        });
      }

      const key = `messages/${mailbox.id}/${existingDraftId}/body-${generateId()}.html`;
      const savedAt = new Date();
      const savedAtDb = savedAt.toISOString().replace('T', ' ').slice(0, 19);
      let databaseWriteAttempted = false;
      try {
        await env.STORAGE.put(key, htmlBody);
        databaseWriteAttempted = true;
        const updated = await env.DB.prepare(
          `UPDATE messages SET mailbox_id = ?, from_address = ?, from_name = ?, to_addresses = ?, cc_addresses = ?, bcc_addresses = ?,
           to_participants = ?, cc_participants = ?, bcc_participants = ?,
           subject = ?, snippet = ?, body_r2_key = ?, size_bytes = ?, importance = ?, in_reply_to = ?, references_header = ?, received_at = ?,
           draft_version = draft_version + 1
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
        ).bind(
          mailbox.id,
          from,
          fromName,
          toAddressesJson,
          ccAddressesJson,
          bccAddressesJson,
          toParticipantJson,
          ccParticipantJson,
          bccParticipantJson,
          subject,
          snippet,
           key,
           htmlBodyBytes,
           importance,
           inReplyTo,
           referencesHeader,
           savedAtDb,
           existingDraftId,
           locals.user.id,
           expectedDraftVersion,
         ).run();
        if (!updated.meta.changes) {
          await env.STORAGE.delete(key).catch(() => undefined);
          await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
          return fail(409, {
            error: 'This draft changed in another tab. Your copy is safe; reload to compare versions.',
            draftConflict: true,
          });
        }
      } catch {
        if (!databaseWriteAttempted) {
          // STORAGE.put may commit before rejecting. No D1 write was attempted,
          // so this unique object is unreferenced and safe to remove.
          await env.STORAGE.delete(key).catch(() => undefined);
          await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
          return fail(500, { error: 'Couldn\'t store draft. Try again.' });
        }
        let recoveryReadSucceeded = false;
        let recovered: { body_r2_key: string | null; draft_version: number; received_at: string } | null = null;
        try {
          recovered = await env.DB.prepare(
            `SELECT body_r2_key, draft_version, received_at FROM messages
             WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
          ).bind(existingDraftId, locals.user.id).first<{
            body_r2_key: string | null;
            draft_version: number;
            received_at: string;
          }>();
          recoveryReadSucceeded = true;
        } catch {
          // Keep the newly written object when D1 cannot prove it is unreferenced.
        }

        await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
        if (recovered?.body_r2_key === key && recovered.draft_version === expectedDraftVersion + 1) {
          if (existing.body_r2_key && existing.body_r2_key !== key) {
            await env.STORAGE.delete(existing.body_r2_key).catch(() => undefined);
          }
          return {
            savedDraftId: existingDraftId,
            draftVersion: recovered.draft_version,
            savedAt: recovered.received_at,
            recoveredDraft: true,
          };
        }

        if (recoveryReadSucceeded) {
          await env.STORAGE.delete(key).catch(() => undefined);
        }
        if (recovered && recovered.draft_version !== expectedDraftVersion) {
          return fail(409, {
            error: 'This draft changed in another tab. Your copy is safe; reload to compare versions.',
            draftConflict: true,
          });
        }
        return fail(recoveryReadSucceeded ? 500 : 503, {
          error: recoveryReadSucceeded
            ? 'Couldn\'t store draft. Try again.'
            : 'Couldn\'t confirm draft storage. Your recovery copy is safe; try again shortly.',
        });
      }

      await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
      if (existing.body_r2_key && existing.body_r2_key !== key) {
        await env.STORAGE.delete(existing.body_r2_key).catch(() => undefined);
      }
      return {
        savedDraftId: existingDraftId,
        draftVersion: expectedDraftVersion + 1,
        savedAt: savedAt.toISOString(),
      };
    }

    const draftId = draftCreateToken;
    const domain = normalizeDomain(env.MAIL_DOMAIN) || 'invalid.local';
    const key = `messages/${mailbox.id}/${draftId}/body-${generateId()}.html`;
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
          ? 'Mailbox storage or draft limit reached. Delete old drafts, or ask an administrator to raise the limit.'
          : 'Draft storage is temporarily unavailable. Try again later.',
      });
    }

    const savedAt = new Date();
    const savedAtDb = savedAt.toISOString().replace('T', ' ').slice(0, 19);
    let databaseWriteAttempted = false;
    try {
      await env.STORAGE.put(key, htmlBody);
      databaseWriteAttempted = true;
      await env.DB.prepare(
        `INSERT INTO messages
         (id, mailbox_id, message_id_header, direction, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, to_participants, cc_participants, bcc_participants, subject, snippet, body_r2_key, size_bytes, folder, draft_owner_id, draft_version, is_read, importance, received_at, created_at, in_reply_to, references_header)
         VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafts', ?, 1, 1, ?, ?, datetime('now'), ?, ?)`,
      ).bind(
        draftId, mailbox.id, `<${draftId}@${domain}>`, from, fromName, toAddressesJson,
        ccAddressesJson, bccAddressesJson, toParticipantJson, ccParticipantJson, bccParticipantJson, subject, snippet, key, htmlBodyBytes, locals.user.id, importance, savedAtDb, inReplyTo, referencesHeader,
      ).run();
    } catch {
      if (!databaseWriteAttempted) {
        // STORAGE.put may commit before rejecting. The INSERT was never attempted,
        // so this unique object cannot be referenced by the draft row.
        await env.STORAGE.delete(key).catch(() => undefined);
        await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
        return fail(500, { error: 'Couldn\'t store draft. Try again.' });
      }
      let recoveryReadSucceeded = false;
      let recovered: {
        body_r2_key: string | null;
        draft_version: number;
        received_at: string;
      } | null = null;
      try {
        recovered = await env.DB.prepare(
          `SELECT body_r2_key, draft_version, received_at FROM messages
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
        ).bind(draftId, locals.user.id).first<{
          body_r2_key: string | null;
          draft_version: number;
          received_at: string;
        }>();
        recoveryReadSucceeded = true;
      } catch {
        // Keep the object when D1 cannot prove an ambiguous INSERT did not commit.
      }
      await releaseMailboxStorageReservations(env.DB, storageResult.reservations).catch(() => undefined);
      if (recovered) {
        if (recovered.body_r2_key !== key) {
          await env.STORAGE.delete(key).catch(() => undefined);
        }
        return {
          savedDraftId: draftId,
          draftVersion: recovered.draft_version,
          savedAt: recovered.received_at,
          recoveredDraft: true,
        };
      }
      if (recoveryReadSucceeded) {
        await env.STORAGE.delete(key).catch(() => undefined);
      }
      return fail(recoveryReadSucceeded ? 500 : 503, {
        error: recoveryReadSucceeded
          ? 'Couldn\'t store draft. Try again.'
          : 'Couldn\'t confirm draft storage. Your recovery copy is safe; try again shortly.',
      });
    }
    return { savedDraftId: draftId, draftVersion: 1, savedAt: savedAt.toISOString() };
  },

  discard: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });
    const formData = await request.formData();
    const draftId = stringValue(formData.get('draft_id'));
    const expectedDraftVersion = safeDraftVersion(formData.get('draft_version'));
    if (!draftId) return fail(400, { error: 'Draft ID is required' });
    if (expectedDraftVersion === null) return fail(400, { error: 'Draft version missing. Reload before discarding.' });
    const draft = await env.DB.prepare(
      `SELECT m.body_r2_key, m.draft_version FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')
         AND m.folder = 'drafts' AND m.draft_owner_id = ? AND mb.status = 'active'`,
    ).bind(draftId, locals.user.id, locals.user.id).first<{ body_r2_key: string | null; draft_version: number }>();
    if (!draft) return fail(404, { error: 'Draft not found' });
    if (draft.draft_version !== expectedDraftVersion) {
      return fail(409, {
        error: 'This draft changed in another tab. Reload before discarding.',
        draftConflict: true,
      });
    }
    const deleted = await env.DB.prepare(
      `DELETE FROM messages
       WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
    ).bind(draftId, locals.user.id, expectedDraftVersion).run();
    if (!deleted.meta.changes) {
      return fail(409, {
        error: 'This draft changed in another tab. Reload before discarding.',
        draftConflict: true,
      });
    }
    if (draft.body_r2_key) await env.STORAGE.delete(draft.body_r2_key).catch(() => undefined);
    throw redirect(303, '/mail?folder=drafts');
  },
};
