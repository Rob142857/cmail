import { afterEach, describe, expect, it, vi } from 'vitest';
import { traceEmail } from './db';
import { sendEmail, type OutboundEmail, type OutboundResult } from './outbound';
import {
  acceptInternalJournal,
  applyProviderResult,
  cancelRetryableJournal,
  claimOutboundDispatch,
  findActiveOutboundJournal,
  findLatestOutboundJournal,
  fingerprintJournalPayload,
  getOutboundJournal,
  insertOutboundJournal,
  isActiveJournalState,
  journalStateResponse,
  stageJournalPayload,
  type JournalProvider,
} from './outbound-journal';
import { createFixture, type Fixture } from './mcp/testing/harness';

// These tests run the journal against the real migrated schema (node:sqlite),
// so the compare-and-swap statements, the unique idempotency index and the
// terminal-release trigger behave exactly as they do on D1.

const email: OutboundEmail = {
  from: 'alice@example.test',
  to: ['one@example.net'],
  subject: 'Lifecycle',
  html: '<p>Hello</p>',
  text: 'Hello',
};

const postmarkEnv = { OUTBOUND_PROVIDER: 'postmark', POSTMARK_API_KEY: 'postmark-api-key-for-tests' };
const restEnv = {
  OUTBOUND_PROVIDER: 'cloudflare',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_EMAIL_API_TOKEN: 'cloudflare-email-api-token-for-tests',
};

let counter = 0;

async function createJournal(
  fixture: Fixture,
  options: { provider?: JournalProvider; key?: string } = {},
): Promise<{ id: string; key: string; reservationId: string }> {
  counter += 1;
  const id = `journal-${counter}`;
  const key = options.key ?? `compose:token-${counter}`;
  const messageId = `msg-${counter}`;
  const reservationId = `res-${counter}`;
  const provider = options.provider ?? 'postmark';
  const payload = {
    provider,
    from: 'alice@example.test',
    to: ['one@example.net'],
    cc: [],
    envelopeRecipients: ['one@example.net'],
    subject: 'Lifecycle',
    html: '<p>Hello</p>',
    text: 'Hello',
    snippet: 'Hello',
    importance: 'normal' as const,
    inReplyTo: null,
    referencesHeader: null,
    threadId: `<thread-${counter}@example.test>`,
    deliveryTargets: [{ mailboxId: 'mb-alice', direction: 'outbound' as const, folder: 'sent' as const }],
    attachments: [],
  };
  const fingerprint = await fingerprintJournalPayload(payload);
  const staged = await stageJournalPayload(fixture.bucket, id, payload.html, payload.text, [], fingerprint);
  fixture.db.sqlite.prepare(
    `INSERT INTO mailbox_reservations
     (id, delivery_key, reservation_type, mailbox_id, message_bytes, mailbox_message_limit,
      mailbox_byte_limit, sender_message_limit, storage_quota_bytes, storage_pending, pending_expires_at)
     VALUES (?, ?, 'storage', 'mb-alice', 100, 1000, 1000000, 1000, 1000000, 1, 4102444800)`,
  ).run(reservationId, messageId);
  await insertOutboundJournal(fixture.db.d1, {
    id,
    userId: 'user-alice',
    mailboxId: 'mb-alice',
    idempotencyKey: key,
    fingerprint,
    staged,
    provider,
    from: payload.from,
    to: payload.to,
    cc: payload.cc,
    envelopeRecipients: payload.envelopeRecipients,
    subject: payload.subject,
    snippet: payload.snippet,
    importance: 'normal',
    inReplyTo: null,
    referencesHeader: null,
    threadId: payload.threadId,
    proposedMessageIdHeader: `<${id}@example.test>`,
    persistedBytes: 100,
    providerPayloadBytes: 100,
    draftId: null,
    claimedDraftVersion: null,
    draftBodyR2Key: null,
    targets: [{
      id: `${id}:target:0`,
      messageId,
      mailboxId: 'mb-alice',
      direction: 'outbound',
      folder: 'sent',
      attachmentIds: [],
    }],
    attachments: [],
    reservations: [{ reservationId, deliveryKey: messageId }],
  });
  return { id, key, reservationId };
}

function reservation(fixture: Fixture, id: string) {
  return fixture.db.sqlite.prepare('SELECT storage_pending, delivery_key FROM mailbox_reservations WHERE id = ?')
    .get(id) as { storage_pending: number; delivery_key: string | null };
}

async function dispatch(fixture: Fixture, journalId: string, token = 'attempt-1', result?: OutboundResult) {
  expect(await claimOutboundDispatch(fixture.db.d1, journalId, token)).toBe(true);
  if (result) return applyProviderResult(fixture.db.d1, journalId, token, result);
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider outcome to journal state, end to end', () => {
  it('records an accepted send with provider ids and timestamp, ready to materialize', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageID: 'provider-id-1' }), { status: 200 })));
    const result = await sendEmail({ ...email, messageIdHeader: `<${id}@example.test>` }, postmarkEnv);

    const state = await dispatch(fixture, id, 'attempt-1', result);
    const row = await getOutboundJournal(fixture.db.d1, id);

    expect(state).toBe('accepted');
    expect(row).toMatchObject({ state: 'accepted', attempt_count: 1, last_error: null, partial_delivery: 0 });
    expect(JSON.parse(row!.provider_message_ids)).toEqual(['provider-id-1']);
    expect(row!.accepted_at).toBeTruthy();
    expect(journalStateResponse(row!.state)).toBe('materialize');
  });

  it('keeps the bounced recipients for a partial delivery', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture, { provider: 'cloudflare' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { delivered: ['one@example.net'], queued: [], permanent_bounces: ['two@example.net'] },
    }), { status: 200 })));
    const result = await sendEmail({ ...email, to: ['one@example.net', 'two@example.net'] }, restEnv);

    expect(await dispatch(fixture, id, 'attempt-1', result)).toBe('accepted');
    const row = await getOutboundJournal(fixture.db.d1, id);
    expect(row!.partial_delivery).toBe(1);
    expect(JSON.parse(row!.failed_recipients)).toEqual(['two@example.net']);
  });

  it('holds an ambiguous 5xx result: no auto-retry, no cancel, no duplicate journal, quota kept', async () => {
    const fixture = createFixture();
    const { id, key, reservationId } = await createJournal(fixture);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));
    const result = await sendEmail(email, postmarkEnv);

    expect(await dispatch(fixture, id, 'attempt-1', result)).toBe('ambiguous');
    const row = await getOutboundJournal(fixture.db.d1, id);
    expect(row).toMatchObject({ state: 'ambiguous', last_error: 'Postmark rejected the request (503)' });
    expect(journalStateResponse(row!.state)).toBe('unknown');
    expect(isActiveJournalState(row!.state)).toBe(true);

    expect(await claimOutboundDispatch(fixture.db.d1, id, 'attempt-2')).toBe(false);
    expect(await cancelRetryableJournal(fixture.db.d1, id)).toBe(false);
    expect((await findActiveOutboundJournal(fixture.db.d1, 'user-alice', key))?.id).toBe(id);
    expect(reservation(fixture, reservationId).storage_pending).toBe(1);
    await expect(createJournal(fixture, { key })).rejects.toThrow(/UNIQUE constraint failed: outbound_send_journal\./);
  });

  it('turns a definite 4xx from the provider into a retryable failure the sender can retry', async () => {
    const fixture = createFixture();
    const { id, key } = await createJournal(fixture);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    const result = await sendEmail(email, postmarkEnv);

    expect(await dispatch(fixture, id, 'attempt-1', result)).toBe('retryable_failure');
    let row = await getOutboundJournal(fixture.db.d1, id);
    expect(row).toMatchObject({ state: 'retryable_failure', attempt_count: 1, last_error: 'Postmark rejected the request (429)' });
    expect(journalStateResponse(row!.state)).toBe('retryable');
    expect((await findActiveOutboundJournal(fixture.db.d1, 'user-alice', key))?.state).toBe('retryable_failure');

    expect(await claimOutboundDispatch(fixture.db.d1, id, 'attempt-2')).toBe(true);
    row = await getOutboundJournal(fixture.db.d1, id);
    expect(row).toMatchObject({ state: 'dispatching', attempt_count: 2, last_error: null, dispatch_token: 'attempt-2' });
  });

  it('retries successfully on the second attempt and keeps the attempt count', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ MessageID: 'provider-id-2' }), { status: 200 })));

    expect(await dispatch(fixture, id, 'attempt-1', await sendEmail(email, postmarkEnv))).toBe('retryable_failure');
    expect(await dispatch(fixture, id, 'attempt-2', await sendEmail(email, postmarkEnv))).toBe('accepted');
    const row = await getOutboundJournal(fixture.db.d1, id);
    expect(row).toMatchObject({ state: 'accepted', attempt_count: 2, last_error: null });
    expect(JSON.parse(row!.provider_message_ids)).toEqual(['provider-id-2']);
  });

  it('releases quota and frees the idempotency key after a permanent rejection, so a corrected send can follow', async () => {
    const fixture = createFixture();
    const { id, key, reservationId } = await createJournal(fixture, { provider: 'cloudflare' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { delivered: [], queued: [], permanent_bounces: ['one@example.net'] },
    }), { status: 200 })));
    const result = await sendEmail(email, restEnv);

    expect(await dispatch(fixture, id, 'attempt-1', result)).toBe('permanent_failure');
    const row = await getOutboundJournal(fixture.db.d1, id);
    expect(JSON.parse(row!.failed_recipients)).toEqual(['one@example.net']);
    expect(row!.last_error).toBe('Cloudflare Email Service permanently rejected every recipient');
    expect(journalStateResponse(row!.state)).toBe('permanent');
    expect(isActiveJournalState(row!.state)).toBe(false);

    expect(reservation(fixture, reservationId)).toEqual({ storage_pending: 0, delivery_key: null });
    expect(await findActiveOutboundJournal(fixture.db.d1, 'user-alice', key)).toBeNull();
    expect((await findLatestOutboundJournal(fixture.db.d1, 'user-alice', key))?.state).toBe('permanent_failure');
    await expect(createJournal(fixture, { key })).resolves.toBeDefined();
  });
});

describe('journal transitions on the real schema', () => {
  it('rejects a result from a stale dispatch token and leaves the row untouched', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    await dispatch(fixture, id, 'attempt-1');

    await expect(applyProviderResult(fixture.db.d1, id, 'stale-token', { success: true, provider: 'postmark', messageId: 'x' }))
      .rejects.toThrow('could not be reconciled');
    expect(await getOutboundJournal(fixture.db.d1, id)).toMatchObject({ state: 'dispatching', dispatch_token: 'attempt-1' });
  });

  it('accepts an identical replay of the same result but refuses a contradictory one', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    const accepted: OutboundResult = { success: true, provider: 'postmark', messageId: 'provider-id-3' };
    await dispatch(fixture, id, 'attempt-1', accepted);

    await expect(applyProviderResult(fixture.db.d1, id, 'attempt-1', accepted)).resolves.toBe('accepted');
    await expect(applyProviderResult(fixture.db.d1, id, 'attempt-1', { success: false, provider: 'postmark', permanentFailure: true }))
      .rejects.toThrow('could not be reconciled');
    expect((await getOutboundJournal(fixture.db.d1, id))!.state).toBe('accepted');
  });

  it('refuses a second claim while dispatching, so two requests cannot both call the provider', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    expect(await claimOutboundDispatch(fixture.db.d1, id, 'attempt-1')).toBe(true);
    expect(await claimOutboundDispatch(fixture.db.d1, id, 'attempt-2')).toBe(false);
    expect((await getOutboundJournal(fixture.db.d1, id))!.dispatch_token).toBe('attempt-1');
  });

  it('never re-claims an accepted or permanently failed journal', async () => {
    const fixture = createFixture();
    const done = await createJournal(fixture);
    await dispatch(fixture, done.id, 'attempt-1', { success: true, provider: 'postmark', messageId: 'p' });
    const failed = await createJournal(fixture);
    await dispatch(fixture, failed.id, 'attempt-1', { success: false, provider: 'postmark', permanentFailure: true });

    expect(await claimOutboundDispatch(fixture.db.d1, done.id, 'attempt-2')).toBe(false);
    expect(await claimOutboundDispatch(fixture.db.d1, failed.id, 'attempt-2')).toBe(false);
  });

  it('bounds and flattens a hostile provider error so the row still saves', async () => {
    const fixture = createFixture();
    const { id } = await createJournal(fixture);
    const state = await dispatch(fixture, id, 'attempt-1', {
      success: false,
      provider: 'postmark',
      error: `line one\r\nline two ${'x'.repeat(3000)}`,
    });
    const row = await getOutboundJournal(fixture.db.d1, id);
    expect(state).toBe('retryable_failure');
    expect(row!.last_error!.length).toBe(1000);
    expect(row!.last_error).not.toMatch(/[\r\n]/);
  });

  it('cancels only a pending or retryable journal, and releases its quota', async () => {
    const fixture = createFixture();
    const retryable = await createJournal(fixture);
    await dispatch(fixture, retryable.id, 'attempt-1', { success: false, provider: 'postmark', error: 'later' });
    const inFlight = await createJournal(fixture);
    await dispatch(fixture, inFlight.id, 'attempt-1');
    const accepted = await createJournal(fixture);
    await dispatch(fixture, accepted.id, 'attempt-1', { success: true, provider: 'postmark', messageId: 'p' });

    expect(await cancelRetryableJournal(fixture.db.d1, retryable.id)).toBe(true);
    expect(await cancelRetryableJournal(fixture.db.d1, inFlight.id)).toBe(false);
    expect(await cancelRetryableJournal(fixture.db.d1, accepted.id)).toBe(false);
    expect(reservation(fixture, retryable.reservationId)).toEqual({ storage_pending: 0, delivery_key: null });
    expect(reservation(fixture, inFlight.reservationId).storage_pending).toBe(1);
    expect(reservation(fixture, accepted.reservationId).storage_pending).toBe(1);
  });

  it('accepts an internal-only journal once, tolerates a replay, and refuses a provider-backed one', async () => {
    const fixture = createFixture();
    const internal = await createJournal(fixture, { provider: 'none' });
    await acceptInternalJournal(fixture.db.d1, internal.id);
    await acceptInternalJournal(fixture.db.d1, internal.id);
    expect(await getOutboundJournal(fixture.db.d1, internal.id)).toMatchObject({ state: 'accepted', provider: 'none' });

    const external = await createJournal(fixture, { provider: 'postmark' });
    await expect(acceptInternalJournal(fixture.db.d1, external.id)).rejects.toThrow('could not be accepted');
    expect((await getOutboundJournal(fixture.db.d1, external.id))!.state).toBe('pending');
  });

  it('refuses to delete an unresolved journal but allows a terminal one', async () => {
    const fixture = createFixture();
    const pending = await createJournal(fixture);
    const failed = await createJournal(fixture);
    await dispatch(fixture, failed.id, 'attempt-1', { success: false, provider: 'postmark', permanentFailure: true });

    expect(() => fixture.db.sqlite.prepare('DELETE FROM outbound_send_journal WHERE id = ?').run(pending.id))
      .toThrow(/unresolved outbound journal/);
    expect(() => fixture.db.sqlite.prepare('DELETE FROM outbound_send_journal WHERE id = ?').run(failed.id)).not.toThrow();
  });
});

describe('traceEmail persists each mail-trace status', () => {
  it('stores sent, deferred, bounced and rejected rows with provider ids and failed recipients', async () => {
    const fixture = createFixture();
    const base = {
      direction: 'outbound' as const,
      envelope_from: 'alice@example.test',
      envelope_to: 'one@example.net',
      header_from: 'alice@example.test',
      subject: 'Lifecycle',
      size_bytes: 100,
    };
    await traceEmail(fixture.db.d1, { ...base, status: 'sent', status_detail: 'via postmark', provider_message_ids: ['p-1'], message_id_header: '<a@example.test>' });
    await traceEmail(fixture.db.d1, { ...base, status: 'deferred', status_detail: 'Postmark rejected the request (503)' });
    await traceEmail(fixture.db.d1, { ...base, status: 'bounced', status_detail: 'permanently rejected', failed_recipients: ['one@example.net'] });
    await traceEmail(fixture.db.d1, { ...base, status: 'rejected', status_detail: 'Postmark rejected the request (429)' });

    const rows = fixture.db.sqlite.prepare(
      'SELECT status, status_detail, provider_message_ids, failed_recipients, message_id_header FROM mail_trace ORDER BY rowid',
    ).all() as Array<Record<string, string>>;
    expect(rows.map((row) => row.status)).toEqual(['sent', 'deferred', 'bounced', 'rejected']);
    expect(JSON.parse(rows[0].provider_message_ids)).toEqual(['p-1']);
    expect(rows[0].message_id_header).toBe('<a@example.test>');
    expect(JSON.parse(rows[1].provider_message_ids)).toEqual([]);
    expect(JSON.parse(rows[2].failed_recipients)).toEqual(['one@example.net']);
    expect(rows[3].status_detail).toBe('Postmark rejected the request (429)');
  });

  it('only accepts the documented statuses', async () => {
    const fixture = createFixture();
    await expect(traceEmail(fixture.db.d1, {
      direction: 'outbound',
      status: 'lost' as unknown as 'sent',
    })).rejects.toThrow(/CHECK constraint failed/);
  });
});
