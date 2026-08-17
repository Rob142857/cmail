import type { MessageImportance } from '@cmail/shared/types';
import type { MailboxStorageReservation } from '@cmail/shared/mailbox-storage';
import type { OutboundAttachment, OutboundEmail, OutboundResult } from './outbound';

export type OutboundJournalState =
  | 'pending'
  | 'dispatching'
  | 'accepted'
  | 'ambiguous'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'cancelled'
  | 'materialized';

export type JournalProvider = 'none' | 'cloudflare' | 'postmark';

export interface JournalAttachmentInput {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface JournalTargetInput {
  id: string;
  messageId: string;
  mailboxId: string;
  direction: 'outbound' | 'internal';
  folder: 'sent' | 'inbox';
  attachmentIds: string[];
}

export interface JournalPayloadInput {
  provider: JournalProvider;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  envelopeRecipients: string[];
  subject: string;
  html: string;
  text: string;
  snippet: string;
  importance: MessageImportance;
  inReplyTo: string | null;
  referencesHeader: string | null;
  threadId: string;
  deliveryTargets: Array<Pick<JournalTargetInput, 'mailboxId' | 'direction' | 'folder'>>;
  attachments: JournalAttachmentInput[];
}

export interface JournalFingerprint {
  payloadHash: string;
  htmlHash: string;
  textHash: string;
  attachmentHashes: string[];
}

export interface StagedJournalPayload {
  htmlKey: string;
  textKey: string;
  attachmentKeys: string[];
  stagedKeys: string[];
}

export interface CreateJournalInput {
  id: string;
  userId: string;
  mailboxId: string;
  idempotencyKey: string;
  fingerprint: JournalFingerprint;
  staged: StagedJournalPayload;
  provider: JournalProvider;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  envelopeRecipients: string[];
  subject: string;
  snippet: string;
  importance: MessageImportance;
  inReplyTo: string | null;
  referencesHeader: string | null;
  threadId: string;
  proposedMessageIdHeader: string;
  persistedBytes: number;
  providerPayloadBytes: number;
  draftId: string | null;
  claimedDraftVersion: number | null;
  draftBodyR2Key: string | null;
  targets: JournalTargetInput[];
  attachments: JournalAttachmentInput[];
  reservations: MailboxStorageReservation[];
}

export interface OutboundJournalRow {
  id: string;
  user_id: string;
  mailbox_id: string;
  idempotency_key: string;
  payload_hash: string;
  html_sha256: string;
  text_sha256: string;
  state: OutboundJournalState;
  provider: JournalProvider;
  from_address: string;
  from_name: string;
  to_addresses: string;
  cc_addresses: string;
  envelope_recipients: string;
  subject: string;
  snippet: string;
  importance: MessageImportance;
  in_reply_to: string | null;
  references_header: string | null;
  thread_id: string | null;
  proposed_message_id_header: string;
  message_id_header: string | null;
  html_r2_key: string;
  text_r2_key: string;
  persisted_bytes: number;
  provider_payload_bytes: number;
  draft_id: string | null;
  claimed_draft_version: number | null;
  draft_body_r2_key: string | null;
  dispatch_token: string | null;
  attempt_count: number;
  provider_message_ids: string;
  failed_recipients: string;
  partial_delivery: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  accepted_at: string | null;
  materialized_at: string | null;
}

export interface OutboundJournalTargetRow {
  id: string;
  journal_id: string;
  ordinal: number;
  message_id: string;
  mailbox_id: string;
  direction: 'outbound' | 'internal';
  folder: 'sent' | 'inbox';
  body_r2_key: string;
  attachment_ids: string;
  reservation_id: string | null;
  materialized_at: string | null;
}

export interface OutboundJournalAttachmentRow {
  id: string;
  journal_id: string;
  ordinal: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_sha256: string;
  staging_r2_key: string;
}

export interface MaterializeResult {
  journal: OutboundJournalRow;
  newInternalDeliveries: Array<{ mailboxId: string; messageId: string }>;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const ACTIVE_STATES: OutboundJournalState[] = [
  'pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure',
];

function validStringArray(value: string, max = 256): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      && parsed.length <= max
      && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

/** Outbound journals retain bare routing addresses; materialized messages also
 * carry the equivalent display-only participant shape. */
function addressOnlyParticipants(value: string): string {
  return JSON.stringify(validStringArray(value, 100).map((address) => ({ address, name: '' })));
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? ENCODER.encode(value) : value;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Canonical fingerprint used to detect a changed payload under one send key. */
export async function fingerprintJournalPayload(input: JournalPayloadInput): Promise<JournalFingerprint> {
  const [htmlHash, textHash, ...attachmentHashes] = await Promise.all([
    sha256(input.html),
    sha256(input.text),
    ...input.attachments.map((attachment) => sha256(attachment.bytes)),
  ]);
  const manifest = JSON.stringify({
    version: 1,
    provider: input.provider,
    from: input.from,
    fromName: input.fromName || '',
    to: input.to,
    cc: input.cc,
    envelopeRecipients: input.envelopeRecipients,
    subject: input.subject,
    snippet: input.snippet,
    importance: input.importance,
    inReplyTo: input.inReplyTo,
    referencesHeader: input.referencesHeader,
    threadId: input.threadId,
    htmlHash,
    textHash,
    deliveryTargets: input.deliveryTargets,
    attachments: input.attachments.map((attachment, ordinal) => ({
      ordinal,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.bytes.byteLength,
      sha256: attachmentHashes[ordinal],
    })),
  });
  return {
    payloadHash: await sha256(manifest),
    htmlHash,
    textHash,
    attachmentHashes,
  };
}

export function journalStagePrefix(journalId: string): string {
  return `outbound-journal/${journalId}`;
}

export function journalProviderResultKey(journalId: string, dispatchToken: string): string {
  return `${journalStagePrefix(journalId)}/provider-results/${dispatchToken}.json`;
}

export function targetBodyKey(mailboxId: string, messageId: string): string {
  return `messages/${mailboxId}/${messageId}/body.html`;
}

export function targetAttachmentKey(messageId: string, attachmentId: string): string {
  return `attachments/${messageId}/${attachmentId}`;
}

export async function stageJournalPayload(
  storage: R2Bucket,
  journalId: string,
  html: string,
  text: string,
  attachments: readonly JournalAttachmentInput[],
  fingerprint: JournalFingerprint,
): Promise<StagedJournalPayload> {
  const prefix = journalStagePrefix(journalId);
  const htmlKey = `${prefix}/body.html`;
  const textKey = `${prefix}/body.txt`;
  const attachmentKeys = attachments.map((_, ordinal) => `${prefix}/attachments/${ordinal}`);
  const stagedKeys: string[] = [];
  const put = async (
    key: string,
    body: string | Uint8Array,
    contentType: string,
    digest: string,
  ): Promise<void> => {
    const object = await storage.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { sha256: digest },
    });
    if (!object) throw new Error('Outbound staging write was not confirmed');
    stagedKeys.push(key);
  };

  try {
    await put(htmlKey, html, 'text/html; charset=utf-8', fingerprint.htmlHash);
    await put(textKey, text, 'text/plain; charset=utf-8', fingerprint.textHash);
    for (let ordinal = 0; ordinal < attachments.length; ordinal += 1) {
      await put(
        attachmentKeys[ordinal],
        attachments[ordinal].bytes,
        attachments[ordinal].contentType,
        fingerprint.attachmentHashes[ordinal],
      );
    }
    return { htmlKey, textKey, attachmentKeys, stagedKeys };
  } catch (error) {
    await Promise.all(stagedKeys.map((key) => storage.delete(key).catch(() => undefined)));
    throw error;
  }
}

export async function cleanupJournalStaging(
  storage: R2Bucket,
  journal: Pick<OutboundJournalRow, 'id' | 'html_r2_key' | 'text_r2_key'>,
  attachments: readonly Pick<OutboundJournalAttachmentRow, 'staging_r2_key'>[],
  dispatchToken?: string | null,
): Promise<void> {
  const keys = [
    journal.html_r2_key,
    journal.text_r2_key,
    ...attachments.map((attachment) => attachment.staging_r2_key),
    ...(dispatchToken ? [journalProviderResultKey(journal.id, dispatchToken)] : []),
  ];
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)));
  const resultPrefix = `${journalStagePrefix(journal.id)}/provider-results/`;
  let cursor: string | undefined;
  do {
    const page = await storage.list({ prefix: resultPrefix, ...(cursor ? { cursor } : {}) }).catch(() => null);
    if (!page) break;
    await Promise.all(page.objects.map((object) => storage.delete(object.key).catch(() => undefined)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function findActiveOutboundJournal(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<OutboundJournalRow | null> {
  return db.prepare(
    `SELECT * FROM outbound_send_journal
     WHERE user_id = ? AND idempotency_key = ?
       AND state IN ('pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure', 'materialized')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, idempotencyKey).first<OutboundJournalRow>();
}

/**
 * Resolve both forms of a legitimate retry: the original form still holds the
 * pre-claim version, while a reload observes the claim-incremented version.
 * A later autosave advances beyond both and therefore starts a new generation.
 */
export async function findDraftOutboundJournal(
  db: D1Database,
  userId: string,
  draftId: string,
  observedDraftVersion: number,
): Promise<OutboundJournalRow | null> {
  return db.prepare(
    `SELECT * FROM outbound_send_journal
     WHERE user_id = ? AND draft_id = ?
       AND claimed_draft_version IN (?, ?)
       AND state IN ('pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure', 'materialized')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(
    userId,
    draftId,
    observedDraftVersion,
    observedDraftVersion + 1,
  ).first<OutboundJournalRow>();
}

export async function findLatestOutboundJournal(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<OutboundJournalRow | null> {
  return db.prepare(
    `SELECT * FROM outbound_send_journal
     WHERE user_id = ? AND idempotency_key = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, idempotencyKey).first<OutboundJournalRow>();
}

export async function getOutboundJournal(db: D1Database, id: string): Promise<OutboundJournalRow | null> {
  return db.prepare('SELECT * FROM outbound_send_journal WHERE id = ?')
    .bind(id).first<OutboundJournalRow>();
}

export async function getOutboundJournalParts(
  db: D1Database,
  journalId: string,
): Promise<{ targets: OutboundJournalTargetRow[]; attachments: OutboundJournalAttachmentRow[] }> {
  const [targets, attachments] = await Promise.all([
    db.prepare('SELECT * FROM outbound_send_targets WHERE journal_id = ? ORDER BY ordinal')
      .bind(journalId).all<OutboundJournalTargetRow>(),
    db.prepare('SELECT * FROM outbound_send_attachments WHERE journal_id = ? ORDER BY ordinal')
      .bind(journalId).all<OutboundJournalAttachmentRow>(),
  ]);
  return { targets: targets.results || [], attachments: attachments.results || [] };
}

export async function insertOutboundJournal(db: D1Database, input: CreateJournalInput): Promise<void> {
  const reservationsByDelivery = new Map(input.reservations.map((reservation) => [
    reservation.deliveryKey,
    reservation.reservationId,
  ]));
  const statements = [
    db.prepare(
      `INSERT INTO outbound_send_journal
       (id, user_id, mailbox_id, idempotency_key, payload_hash, html_sha256,
        text_sha256, state, provider,
        from_address, from_name, to_addresses, cc_addresses, envelope_recipients, subject,
        snippet, importance, in_reply_to, references_header, thread_id,
        proposed_message_id_header, message_id_header, html_r2_key, text_r2_key,
        persisted_bytes, provider_payload_bytes, draft_id, claimed_draft_version,
        draft_body_r2_key, created_at, updated_at)
       VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'pending', ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, datetime('now'), datetime('now')
       )`,
    ).bind(
      input.id,
      input.userId,
      input.mailboxId,
      input.idempotencyKey,
      input.fingerprint.payloadHash,
      input.fingerprint.htmlHash,
      input.fingerprint.textHash,
      input.provider,
      input.from,
      input.fromName || '',
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      JSON.stringify(input.envelopeRecipients),
      input.subject,
      input.snippet,
      input.importance,
      input.inReplyTo,
      input.referencesHeader,
      input.threadId,
      input.proposedMessageIdHeader,
      input.proposedMessageIdHeader,
      input.staged.htmlKey,
      input.staged.textKey,
      input.persistedBytes,
      input.providerPayloadBytes,
      input.draftId,
      input.claimedDraftVersion,
      input.draftBodyR2Key,
    ),
    ...input.targets.map((target, ordinal) => db.prepare(
      `INSERT INTO outbound_send_targets
       (id, journal_id, ordinal, message_id, mailbox_id, direction, folder,
        body_r2_key, attachment_ids, reservation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      target.id,
      input.id,
      ordinal,
      target.messageId,
      target.mailboxId,
      target.direction,
      target.folder,
      targetBodyKey(target.mailboxId, target.messageId),
      JSON.stringify(target.attachmentIds),
      reservationsByDelivery.get(target.messageId) || null,
    )),
    ...input.attachments.map((attachment, ordinal) => db.prepare(
      `INSERT INTO outbound_send_attachments
       (id, journal_id, ordinal, filename, content_type, size_bytes,
        content_sha256, staging_r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `${input.id}:attachment:${ordinal}`,
      input.id,
      ordinal,
      attachment.filename,
      attachment.contentType,
      attachment.bytes.byteLength,
      input.fingerprint.attachmentHashes[ordinal],
      input.staged.attachmentKeys[ordinal],
    )),
  ];
  const result = await db.batch(statements);
  if (result.length !== statements.length) {
    throw new Error('Outbound journal transaction was not confirmed');
  }
}

export async function claimOutboundDispatch(
  db: D1Database,
  journalId: string,
  dispatchToken: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE outbound_send_journal
     SET state = 'dispatching', dispatch_token = ?, attempt_count = attempt_count + 1,
         dispatched_at = datetime('now'), updated_at = datetime('now'), last_error = NULL
     WHERE id = ? AND state IN ('pending', 'retryable_failure')`,
  ).bind(dispatchToken, journalId).run();
  return Number(result.meta.changes || 0) === 1;
}

interface PersistedProviderResult {
  version: 1;
  result: OutboundResult;
}

function boundedProviderResult(result: OutboundResult): OutboundResult {
  const ids = (result.providerMessageIds || (result.messageId ? [result.messageId] : []))
    .filter((value) => typeof value === 'string' && value.length <= 998 && !/[\r\n\u0000]/.test(value))
    .slice(0, 50);
  const failed = (result.permanentBounces || [])
    .filter((value) => typeof value === 'string' && value.length <= 320 && !/[\r\n\u0000]/.test(value))
    .slice(0, 50);
  return {
    success: result.success === true,
    provider: result.provider,
    ...(result.messageId && ids.includes(result.messageId) ? { messageId: result.messageId } : {}),
    ...(ids.length ? { providerMessageIds: ids } : {}),
    ...(result.messageIdHeader && /^<[^<>\s]+@[^<>\s]+>$/.test(result.messageIdHeader)
      ? { messageIdHeader: result.messageIdHeader }
      : result.messageIdUnavailable ? { messageIdUnavailable: true as const } : {}),
    ...(result.partial ? { partial: true as const } : {}),
    ...(result.permanentFailure ? { permanentFailure: true as const } : {}),
    ...(result.ambiguous ? { ambiguous: true as const } : {}),
    ...(failed.length ? { permanentBounces: failed } : {}),
    ...(result.error ? { error: result.error.replace(/[\r\n\u0000]/g, ' ').slice(0, 1000) } : {}),
  };
}

export async function persistProviderResultSnapshot(
  storage: R2Bucket,
  journalId: string,
  dispatchToken: string,
  result: OutboundResult,
): Promise<void> {
  const body: PersistedProviderResult = { version: 1, result: boundedProviderResult(result) };
  const stored = await storage.put(
    journalProviderResultKey(journalId, dispatchToken),
    JSON.stringify(body),
    { httpMetadata: { contentType: 'application/json' } },
  );
  if (!stored) throw new Error('Provider result snapshot was not confirmed');
}

export async function loadProviderResultSnapshot(
  storage: R2Bucket,
  journalId: string,
  dispatchToken: string,
): Promise<OutboundResult | null> {
  const object = await storage.get(journalProviderResultKey(journalId, dispatchToken));
  if (!object || object.size > 64 * 1024) return null;
  try {
    const parsed = JSON.parse(await object.text()) as PersistedProviderResult;
    if (parsed?.version !== 1 || !parsed.result || typeof parsed.result.success !== 'boolean') return null;
    if (!['none', 'cloudflare', 'postmark'].includes(parsed.result.provider)) return null;
    return boundedProviderResult(parsed.result);
  } catch {
    return null;
  }
}

export async function applyProviderResult(
  db: D1Database,
  journalId: string,
  dispatchToken: string,
  rawResult: OutboundResult,
): Promise<OutboundJournalState> {
  const result = boundedProviderResult(rawResult);
  const providerIds = result.providerMessageIds || (result.messageId ? [result.messageId] : []);
  const failedRecipients = result.permanentBounces || [];
  const nextState: OutboundJournalState = result.success
    ? 'accepted'
    : result.ambiguous
      ? 'ambiguous'
      : result.permanentFailure
        ? 'permanent_failure'
        : 'retryable_failure';
  const messageIdHeader = result.messageIdHeader || null;
  const update = await db.prepare(
    `UPDATE outbound_send_journal
     SET state = ?, message_id_header = ?, provider_message_ids = ?,
         failed_recipients = ?, partial_delivery = ?, last_error = ?,
         accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END,
         updated_at = datetime('now')
     WHERE id = ? AND state = 'dispatching' AND dispatch_token = ?`,
  ).bind(
    nextState,
    messageIdHeader,
    JSON.stringify(providerIds),
    JSON.stringify(failedRecipients),
    result.partial ? 1 : 0,
    result.error || null,
    nextState,
    journalId,
    dispatchToken,
  ).run();
  if (Number(update.meta.changes || 0) === 1) return nextState;

  const current = await getOutboundJournal(db, journalId);
  if (current && current.dispatch_token === dispatchToken && current.state === nextState) return nextState;
  throw new Error('Provider result could not be reconciled with the outbound journal');
}

export async function acceptInternalJournal(db: D1Database, journalId: string): Promise<void> {
  const result = await db.prepare(
    `UPDATE outbound_send_journal
     SET state = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND state = 'pending' AND provider = 'none'`,
  ).bind(journalId).run();
  if (Number(result.meta.changes || 0) === 1) return;
  const current = await getOutboundJournal(db, journalId);
  if (!current || !['accepted', 'materialized'].includes(current.state)) {
    throw new Error('Internal outbound journal could not be accepted');
  }
}

export async function releaseJournalReservations(
  db: D1Database,
  journalId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE mailbox_reservations
     SET storage_pending = 0, delivery_key = NULL
     WHERE id IN (
       SELECT reservation_id FROM outbound_send_targets
       WHERE journal_id = ? AND reservation_id IS NOT NULL
     )`,
  ).bind(journalId).run();
}

export async function cancelRetryableJournal(
  db: D1Database,
  journalId: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE outbound_send_journal
     SET state = 'cancelled', updated_at = datetime('now')
     WHERE id = ? AND state IN ('pending', 'retryable_failure')`,
  ).bind(journalId).run();
  return Number(result.meta.changes || 0) === 1;
}

export async function loadJournalOutboundEmail(
  storage: R2Bucket,
  journal: OutboundJournalRow,
  attachments: readonly OutboundJournalAttachmentRow[],
): Promise<OutboundEmail> {
  const [htmlObject, textObject, ...attachmentObjects] = await Promise.all([
    readVerifiedStagedObject(storage, journal.html_r2_key, journal.html_sha256),
    readVerifiedStagedObject(storage, journal.text_r2_key, journal.text_sha256),
    ...attachments.map((attachment) => readVerifiedStagedObject(
      storage,
      attachment.staging_r2_key,
      attachment.content_sha256,
      attachment.size_bytes,
    )),
  ]);
  const html = DECODER.decode(htmlObject.bytes);
  const text = DECODER.decode(textObject.bytes);
  const outboundAttachments = attachments.map<OutboundAttachment>((attachment, ordinal) => ({
    filename: attachment.filename,
    contentType: attachment.content_type,
    content: attachmentObjects[ordinal].bytes,
  }));
  return {
    from: journal.from_address,
    ...(journal.from_name ? { fromName: journal.from_name } : {}),
    to: validStringArray(journal.to_addresses, 50),
    cc: validStringArray(journal.cc_addresses, 50),
    envelopeRecipients: validStringArray(journal.envelope_recipients, 50),
    subject: journal.subject,
    html,
    text,
    headers: journal.in_reply_to ? {
      'In-Reply-To': journal.in_reply_to,
      ...(journal.references_header ? { References: journal.references_header } : {}),
    } : undefined,
    importance: journal.importance,
    messageIdHeader: journal.proposed_message_id_header,
    attachments: outboundAttachments,
  };
}

interface VerifiedStagedObject {
  bytes: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

async function readVerifiedStagedObject(
  storage: R2Bucket,
  sourceKey: string,
  expectedHash: string,
  expectedSize?: number,
): Promise<VerifiedStagedObject> {
  const source = await storage.get(sourceKey);
  if (!source) throw new Error('Staged outbound payload is incomplete');
  if (expectedSize !== undefined && source.size !== expectedSize) {
    throw new Error('Staged outbound payload failed integrity verification');
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
    throw new Error('Staged outbound payload failed integrity verification');
  }
  if (await sha256(bytes) !== expectedHash) {
    throw new Error('Staged outbound payload failed integrity verification');
  }
  return {
    bytes,
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  };
}

async function copyStagedObject(
  storage: R2Bucket,
  sourceKey: string,
  targetKey: string,
  fallbackContentType: string,
  expectedHash: string,
  expectedSize?: number,
): Promise<void> {
  const source = await readVerifiedStagedObject(storage, sourceKey, expectedHash, expectedSize);
  const stored = await storage.put(targetKey, source.bytes, {
    httpMetadata: source.httpMetadata || { contentType: fallbackContentType },
    customMetadata: { ...source.customMetadata, sha256: expectedHash },
  });
  if (!stored) throw new Error('Outbound destination write was not confirmed');
}

async function materializeTarget(
  db: D1Database,
  storage: R2Bucket,
  journal: OutboundJournalRow,
  target: OutboundJournalTargetRow,
  attachments: readonly OutboundJournalAttachmentRow[],
): Promise<boolean> {
  if (target.materialized_at) return false;
  const attachmentIds = validStringArray(target.attachment_ids, 25);
  if (attachmentIds.length !== attachments.length) throw new Error('Outbound target attachment plan is invalid');

  await copyStagedObject(
    storage,
    journal.html_r2_key,
    target.body_r2_key,
    'text/html; charset=utf-8',
    journal.html_sha256,
  );
  for (let ordinal = 0; ordinal < attachments.length; ordinal += 1) {
    await copyStagedObject(
      storage,
      attachments[ordinal].staging_r2_key,
      targetAttachmentKey(target.message_id, attachmentIds[ordinal]),
      attachments[ordinal].content_type,
      attachments[ordinal].content_sha256,
      attachments[ordinal].size_bytes,
    );
  }

  const providerIds = target.direction === 'outbound' ? journal.provider_message_ids : '[]';
  const failedRecipients = target.direction === 'outbound' ? journal.failed_recipients : '[]';
  const toParticipants = addressOnlyParticipants(journal.to_addresses);
  const ccParticipants = addressOnlyParticipants(journal.cc_addresses);
  const statements = [
    db.prepare(
      `INSERT INTO messages
       (id, mailbox_id, message_id_header, provider_message_ids, failed_recipients,
        direction, from_address, from_name, to_addresses, cc_addresses, to_participants, cc_participants, subject, snippet,
        body_r2_key, has_attachments, size_bytes, folder, is_read, importance,
        received_at, created_at, in_reply_to, references_header, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?)`,
    ).bind(
      target.message_id,
      target.mailbox_id,
      journal.message_id_header,
      providerIds,
      failedRecipients,
      target.direction,
      journal.from_address,
      journal.from_name,
      journal.to_addresses,
      journal.cc_addresses,
      toParticipants,
      ccParticipants,
      journal.subject,
      journal.snippet,
      target.body_r2_key,
      attachments.length ? 1 : 0,
      journal.persisted_bytes,
      target.folder,
      target.folder === 'sent' ? 1 : 0,
      journal.importance,
      journal.accepted_at,
      journal.accepted_at,
      journal.in_reply_to,
      journal.references_header,
      journal.thread_id || journal.message_id_header || journal.proposed_message_id_header,
    ),
    ...attachments.map((attachment, ordinal) => db.prepare(
      `INSERT INTO attachments
       (id, message_id, filename, content_type, size_bytes, r2_key, content_id, disposition)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'attachment')`,
    ).bind(
      attachmentIds[ordinal],
      target.message_id,
      attachment.filename,
      attachment.content_type,
      attachment.size_bytes,
      targetAttachmentKey(target.message_id, attachmentIds[ordinal]),
    )),
    db.prepare(
      `UPDATE outbound_send_targets
       SET materialized_at = datetime('now')
       WHERE id = ? AND journal_id = ? AND materialized_at IS NULL`,
    ).bind(target.id, journal.id),
  ];

  try {
    const result = await db.batch(statements);
    if (result.length === statements.length && Number(result.at(-1)?.meta.changes || 0) === 1) return true;
  } catch {
    const recovered = await db.prepare(
      'SELECT materialized_at FROM outbound_send_targets WHERE id = ? AND journal_id = ?',
    ).bind(target.id, journal.id).first<{ materialized_at: string | null }>();
    if (recovered?.materialized_at) return false;
    throw new Error('Outbound target materialization was not confirmed');
  }
  throw new Error('Outbound target materialization was not confirmed');
}

export async function materializeOutboundJournal(
  db: D1Database,
  storage: R2Bucket,
  journalId: string,
): Promise<MaterializeResult> {
  let journal = await getOutboundJournal(db, journalId);
  if (!journal) throw new Error('Outbound journal no longer exists');
  if (journal.state === 'materialized') {
    const parts = await getOutboundJournalParts(db, journal.id);
    if (journal.draft_id && journal.claimed_draft_version !== null) {
      let draftAbsent = false;
      try {
        await db.prepare(
          `DELETE FROM messages
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
        ).bind(journal.draft_id, journal.user_id, journal.claimed_draft_version).run();
        const remaining = await db.prepare(
          `SELECT 1 AS present FROM messages
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
        ).bind(journal.draft_id, journal.user_id).first<{ present: number }>();
        draftAbsent = !remaining;
      } catch {
        // Leave the immutable tombstone and staging in place for a later replay.
      }
      if (draftAbsent && journal.draft_body_r2_key) {
        await storage.delete(journal.draft_body_r2_key).catch(() => undefined);
      }
    }
    await cleanupJournalStaging(storage, journal, parts.attachments, journal.dispatch_token);
    return { journal, newInternalDeliveries: [] };
  }
  if (journal.state !== 'accepted') throw new Error('Outbound journal is not accepted');

  const parts = await getOutboundJournalParts(db, journal.id);
  if (!parts.targets.length) throw new Error('Outbound journal has no delivery targets');
  const newInternalDeliveries: Array<{ mailboxId: string; messageId: string }> = [];
  for (const target of parts.targets) {
    const created = await materializeTarget(db, storage, journal, target, parts.attachments);
    if (created && target.direction === 'internal') {
      newInternalDeliveries.push({ mailboxId: target.mailbox_id, messageId: target.message_id });
    }
  }

  try {
    const result = await db.prepare(
      `UPDATE outbound_send_journal
       SET state = 'materialized', materialized_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND state = 'accepted'`,
    ).bind(journal.id).run();
    if (Number(result.meta.changes || 0) !== 1) throw new Error('Outbound journal completion was not confirmed');
  } catch {
    const recovered = await getOutboundJournal(db, journal.id);
    if (recovered?.state !== 'materialized') throw new Error('Outbound journal completion was not confirmed');
  }
  journal = await getOutboundJournal(db, journal.id);
  if (!journal || journal.state !== 'materialized') throw new Error('Outbound journal completion was not confirmed');

  if (journal.draft_id && journal.claimed_draft_version !== null) {
    let deleteConfirmed: boolean;
    try {
      const deleted = await db.prepare(
        `DELETE FROM messages
         WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ? AND draft_version = ?`,
      ).bind(journal.draft_id, journal.user_id, journal.claimed_draft_version).run();
      deleteConfirmed = Number(deleted.meta.changes || 0) === 1;
      if (!deleteConfirmed) {
        const draft = await db.prepare(
          `SELECT 1 AS present FROM messages
           WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
        ).bind(journal.draft_id, journal.user_id).first<{ present: number }>();
        deleteConfirmed = !draft;
      }
    } catch {
      const draft = await db.prepare(
        `SELECT 1 AS present FROM messages
         WHERE id = ? AND folder = 'drafts' AND draft_owner_id = ?`,
      ).bind(journal.draft_id, journal.user_id).first<{ present: number }>();
      deleteConfirmed = !draft;
    }
    if (deleteConfirmed && journal.draft_body_r2_key) {
      await storage.delete(journal.draft_body_r2_key).catch(() => undefined);
    }
  }

  await cleanupJournalStaging(storage, journal, parts.attachments, journal.dispatch_token);
  return { journal, newInternalDeliveries };
}

export function journalStateResponse(state: OutboundJournalState):
  | 'dispatch'
  | 'materialize'
  | 'complete'
  | 'unknown'
  | 'retryable'
  | 'permanent' {
  switch (state) {
    case 'pending': return 'dispatch';
    case 'retryable_failure': return 'retryable';
    case 'accepted': return 'materialize';
    case 'materialized': return 'complete';
    case 'permanent_failure': return 'permanent';
    case 'cancelled': return 'permanent';
    case 'dispatching':
    case 'ambiguous':
      return 'unknown';
  }
}

export function isActiveJournalState(state: OutboundJournalState): boolean {
  return ACTIVE_STATES.includes(state);
}
