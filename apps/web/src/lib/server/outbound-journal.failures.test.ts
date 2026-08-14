import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboundResult } from './outbound';
import {
  applyProviderResult,
  claimOutboundDispatch,
  fingerprintJournalPayload,
  journalProviderResultKey,
  loadJournalOutboundEmail,
  loadProviderResultSnapshot,
  materializeOutboundJournal,
  persistProviderResultSnapshot,
  stageJournalPayload,
  targetAttachmentKey,
  targetBodyKey,
  type OutboundJournalAttachmentRow,
  type OutboundJournalRow,
  type OutboundJournalTargetRow,
} from './outbound-journal';

interface FakeStatement {
  query: string;
  values: unknown[];
  bind: (...values: unknown[]) => FakeStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
}

interface StoredObject {
  bytes: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

function storedBody(entry: StoredObject) {
  return {
    body: entry.bytes,
    size: entry.bytes.byteLength,
    httpMetadata: entry.httpMetadata,
    customMetadata: entry.customMetadata,
    async text() {
      return new TextDecoder().decode(entry.bytes);
    },
    async arrayBuffer() {
      return entry.bytes.buffer.slice(
        entry.bytes.byteOffset,
        entry.bytes.byteOffset + entry.bytes.byteLength,
      );
    },
  };
}

function fakeBucket() {
  const objects = new Map<string, StoredObject>();
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  const encoder = new TextEncoder();
  const seed = (key: string, value: string | Uint8Array, metadata: Partial<StoredObject> = {}) => {
    objects.set(key, {
      bytes: typeof value === 'string' ? encoder.encode(value) : value,
      ...metadata,
    });
  };
  const bucket = {
    async put(
      key: string,
      value: string | Uint8Array,
      options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> },
    ) {
      putKeys.push(key);
      seed(key, value, options);
      return { key };
    },
    async get(key: string) {
      const entry = objects.get(key);
      return entry ? storedBody(entry) : null;
    },
    async delete(key: string) {
      deleteKeys.push(key);
      objects.delete(key);
    },
    async list(options: { prefix?: string }) {
      const prefix = options.prefix || '';
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      };
    },
  } as unknown as R2Bucket;
  return { bucket, deleteKeys, objects, putKeys, seed };
}

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function acceptedJournal(overrides: Partial<OutboundJournalRow> = {}): OutboundJournalRow {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    mailbox_id: 'mailbox-1',
    idempotency_key: 'send-key-1',
    payload_hash: 'a'.repeat(64),
    html_sha256: 'b'.repeat(64),
    text_sha256: 'c'.repeat(64),
    state: 'accepted',
    provider: 'cloudflare',
    from_address: 'sender@example.com',
    from_name: 'Sender Example',
    to_addresses: JSON.stringify(['person@example.net']),
    cc_addresses: '[]',
    envelope_recipients: JSON.stringify(['person@example.net']),
    subject: 'Durable delivery',
    snippet: 'The body',
    importance: 'normal',
    in_reply_to: null,
    references_header: null,
    thread_id: '<thread@example.com>',
    proposed_message_id_header: '<message@example.com>',
    message_id_header: '<message@example.com>',
    html_r2_key: 'outbound-journal/journal-1/body.html',
    text_r2_key: 'outbound-journal/journal-1/body.txt',
    persisted_bytes: 42,
    provider_payload_bytes: 42,
    draft_id: null,
    claimed_draft_version: null,
    draft_body_r2_key: null,
    dispatch_token: 'attempt-1',
    attempt_count: 1,
    provider_message_ids: JSON.stringify(['provider-1']),
    failed_recipients: '[]',
    partial_delivery: 0,
    last_error: null,
    created_at: '2026-08-04 00:00:00',
    updated_at: '2026-08-04 00:00:00',
    dispatched_at: '2026-08-04 00:00:01',
    accepted_at: '2026-08-04 00:00:02',
    materialized_at: null,
    ...overrides,
  };
}

function journalTarget(overrides: Partial<OutboundJournalTargetRow> = {}): OutboundJournalTargetRow {
  return {
    id: 'target-1',
    journal_id: 'journal-1',
    ordinal: 0,
    message_id: 'message-1',
    mailbox_id: 'mailbox-1',
    direction: 'outbound',
    folder: 'sent',
    body_r2_key: targetBodyKey('mailbox-1', 'message-1'),
    attachment_ids: JSON.stringify(['attachment-1']),
    reservation_id: 'reservation-1',
    materialized_at: null,
    ...overrides,
  };
}

function journalAttachment(): OutboundJournalAttachmentRow {
  return {
    id: 'manifest-attachment-1',
    journal_id: 'journal-1',
    ordinal: 0,
    filename: 'report.txt',
    content_type: 'text/plain',
    size_bytes: 6,
    content_sha256: 'b'.repeat(64),
    staging_r2_key: 'outbound-journal/journal-1/attachments/0',
  };
}

function materializationDb(
  initialJournal: OutboundJournalRow,
  targets: OutboundJournalTargetRow[],
  attachments: OutboundJournalAttachmentRow[],
) {
  let journal = { ...initialJournal };
  const messageWrites: unknown[][] = [];
  const attachmentWrites: unknown[][] = [];

  const prepare = (query: string): FakeStatement => {
    const statement: FakeStatement = {
      query,
      values: [],
      bind(...values: unknown[]) {
        statement.values = values;
        return statement;
      },
      async first<T>() {
        if (query.includes('SELECT * FROM outbound_send_journal')) return journal as T;
        if (query.includes('SELECT materialized_at FROM outbound_send_targets')) {
          const target = targets.find((item) => item.id === statement.values[0]);
          return (target ? { materialized_at: target.materialized_at } : null) as T | null;
        }
        throw new Error(`Unexpected first query: ${query}`);
      },
      async all<T>() {
        if (query.includes('FROM outbound_send_targets')) return { results: targets as T[] };
        if (query.includes('FROM outbound_send_attachments')) return { results: attachments as T[] };
        throw new Error(`Unexpected all query: ${query}`);
      },
      async run() {
        if (query.includes("SET state = 'materialized'")) {
          if (journal.state !== 'accepted') return { meta: { changes: 0 } };
          journal = {
            ...journal,
            state: 'materialized',
            materialized_at: '2026-08-04 00:00:03',
            updated_at: '2026-08-04 00:00:03',
          };
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected run query: ${query}`);
      },
    };
    return statement;
  };

  const db = {
    prepare,
    async batch(rawStatements: D1PreparedStatement[]) {
      const statements = rawStatements as unknown as FakeStatement[];
      return statements.map((statement) => {
        if (statement.query.includes('INSERT INTO messages')) {
          messageWrites.push(statement.values);
          return { meta: { changes: 1 } };
        }
        if (statement.query.includes('INSERT INTO attachments')) {
          attachmentWrites.push(statement.values);
          return { meta: { changes: 1 } };
        }
        if (statement.query.includes('UPDATE outbound_send_targets')) {
          const target = targets.find((item) => item.id === statement.values[0]);
          if (!target || target.materialized_at) return { meta: { changes: 0 } };
          target.materialized_at = '2026-08-04 00:00:03';
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected batch query: ${statement.query}`);
      });
    },
  } as unknown as D1Database;

  return { attachmentWrites, db, getJournal: () => journal, messageWrites };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outbound journal failure and recovery boundaries', () => {
  it('returns false when the dispatch compare-and-swap changes no row', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 0 } }; },
        };
      },
    } as unknown as D1Database;

    await expect(claimOutboundDispatch(db, 'journal-1', 'attempt-2')).resolves.toBe(false);
  });

  it.each<[string, OutboundResult, string]>([
    ['accepted', { success: true, provider: 'cloudflare', messageId: 'provider-1' }, 'accepted'],
    ['ambiguous', { success: false, provider: 'cloudflare', ambiguous: true }, 'ambiguous'],
    ['permanent', { success: false, provider: 'postmark', permanentFailure: true }, 'permanent_failure'],
    ['retryable', { success: false, provider: 'postmark', error: 'try later' }, 'retryable_failure'],
  ])('classifies a %s provider result', async (_label, providerResult, expectedState) => {
    let values: unknown[] = [];
    const db = {
      prepare() {
        return {
          bind(...bindings: unknown[]) {
            values = bindings;
            return this;
          },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    } as unknown as D1Database;

    await expect(applyProviderResult(db, 'journal-1', 'attempt-1', providerResult))
      .resolves.toBe(expectedState);
    expect(values[0]).toBe(expectedState);
    expect(values.at(-2)).toBe('journal-1');
    expect(values.at(-1)).toBe('attempt-1');
  });

  it('round-trips only bounded, sanitized provider-result fields', async () => {
    const { bucket } = fakeBucket();
    await persistProviderResultSnapshot(bucket, 'journal-1', 'attempt-1', {
      success: true,
      provider: 'cloudflare',
      messageId: 'provider-1',
      providerMessageIds: ['provider-1', 'bad\r\nid'],
      messageIdHeader: 'not-an-rfc-message-id',
      messageIdUnavailable: true,
      permanentBounces: ['bad@example.net', 'evil\n@example.net'],
      error: 'line one\r\nline two',
    });

    await expect(loadProviderResultSnapshot(bucket, 'journal-1', 'attempt-1')).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: 'provider-1',
      providerMessageIds: ['provider-1'],
      messageIdUnavailable: true,
      permanentBounces: ['bad@example.net'],
      error: 'line one  line two',
    });
  });

  it.each([
    ['invalid JSON', 'not-json'],
    ['unknown version', JSON.stringify({ version: 2, result: { success: true, provider: 'cloudflare' } })],
    ['non-boolean success', JSON.stringify({ version: 1, result: { success: 'yes', provider: 'cloudflare' } })],
    ['unknown provider', JSON.stringify({ version: 1, result: { success: true, provider: 'smtp' } })],
  ])('rejects an %s provider-result snapshot', async (_label, body) => {
    const { bucket, seed } = fakeBucket();
    seed(journalProviderResultKey('journal-1', 'attempt-1'), body);
    await expect(loadProviderResultSnapshot(bucket, 'journal-1', 'attempt-1')).resolves.toBeNull();
  });

  it('rejects an oversized provider-result snapshot before parsing it', async () => {
    const { bucket, seed } = fakeBucket();
    seed(journalProviderResultKey('journal-1', 'attempt-1'), 'x'.repeat(64 * 1024 + 1));
    await expect(loadProviderResultSnapshot(bucket, 'journal-1', 'attempt-1')).resolves.toBeNull();
  });

  it('removes confirmed staging writes when a later write is not confirmed', async () => {
    const deleted: string[] = [];
    let writes = 0;
    const bucket = {
      async put() {
        writes += 1;
        return writes === 2 ? null : { key: 'stored' };
      },
      async delete(key: string) {
        deleted.push(key);
      },
    } as unknown as R2Bucket;
    const fingerprint = await fingerprintJournalPayload({
      provider: 'cloudflare',
      from: 'sender@example.com',
      to: ['person@example.net'],
      cc: [],
      envelopeRecipients: ['person@example.net'],
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      snippet: 'Body',
      importance: 'normal',
      inReplyTo: null,
      referencesHeader: null,
      threadId: '<message@example.com>',
      deliveryTargets: [{ mailboxId: 'mailbox-1', direction: 'outbound', folder: 'sent' }],
      attachments: [],
    });

    await expect(stageJournalPayload(
      bucket,
      'journal-1',
      '<p>Body</p>',
      'Body',
      [],
      fingerprint,
    )).rejects.toThrow('Outbound staging write was not confirmed');
    expect(deleted).toEqual(['outbound-journal/journal-1/body.html']);
  });

  it('materializes an accepted provider result without dispatch and uses deterministic object writes', async () => {
    const journal = acceptedJournal({
      html_sha256: await digest('<p>The body</p>'),
      text_sha256: await digest('The body'),
    });
    const target = journalTarget();
    const attachment = { ...journalAttachment(), content_sha256: await digest('report') };
    const { bucket, objects, putKeys, seed } = fakeBucket();
    seed(journal.html_r2_key, '<p>The body</p>', { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    seed(journal.text_r2_key, 'The body');
    seed(attachment.staging_r2_key, 'report');
    const { attachmentWrites, db, getJournal, messageWrites } = materializationDb(
      journal,
      [target],
      [attachment],
    );
    const providerCall = vi.fn();
    vi.stubGlobal('fetch', providerCall);

    await expect(materializeOutboundJournal(db, bucket, journal.id)).resolves.toMatchObject({
      journal: { state: 'materialized' },
      newInternalDeliveries: [],
    });

    expect(providerCall).not.toHaveBeenCalled();
    expect(putKeys).toEqual([
      targetBodyKey(target.mailbox_id, target.message_id),
      targetAttachmentKey(target.message_id, 'attachment-1'),
    ]);
    expect(messageWrites).toHaveLength(1);
    expect(attachmentWrites).toHaveLength(1);
    expect(objects.has(targetBodyKey(target.mailbox_id, target.message_id))).toBe(true);
    expect(objects.has(targetAttachmentKey(target.message_id, 'attachment-1'))).toBe(true);
    expect(getJournal().state).toBe('materialized');
  });

  it('rejects altered staged bytes before provider dispatch', async () => {
    const journal = acceptedJournal({
      state: 'dispatching',
      html_sha256: await digest('<p>Expected</p>'),
      text_sha256: await digest('Expected'),
    });
    const { bucket, seed } = fakeBucket();
    seed(journal.html_r2_key, '<p>Altered</p>');
    seed(journal.text_r2_key, 'Expected');

    await expect(loadJournalOutboundEmail(bucket, journal, []))
      .rejects.toThrow('integrity verification');
  });

  it('restores the journaled sender display name for a provider retry', async () => {
    const journal = acceptedJournal({
      html_sha256: await digest('<p>Expected</p>'),
      text_sha256: await digest('Expected'),
    });
    const { bucket, seed } = fakeBucket();
    seed(journal.html_r2_key, '<p>Expected</p>');
    seed(journal.text_r2_key, 'Expected');

    await expect(loadJournalOutboundEmail(bucket, journal, [])).resolves.toMatchObject({
      from: 'sender@example.com',
      fromName: 'Sender Example',
    });
  });

  it('rejects altered staged bytes before writing a materialized copy', async () => {
    const journal = acceptedJournal({
      html_sha256: await digest('<p>Expected</p>'),
      text_sha256: await digest('Expected'),
    });
    const target = journalTarget({ attachment_ids: '[]' });
    const { bucket, putKeys, seed } = fakeBucket();
    seed(journal.html_r2_key, '<p>Altered</p>');
    seed(journal.text_r2_key, 'Expected');
    const { db, messageWrites } = materializationDb(journal, [target], []);

    await expect(materializeOutboundJournal(db, bucket, journal.id))
      .rejects.toThrow('integrity verification');
    expect(putKeys).toEqual([]);
    expect(messageWrites).toEqual([]);
  });

  it('completes an accepted journal with an already-materialized target without rewriting it', async () => {
    const journal = acceptedJournal();
    const target = journalTarget({ materialized_at: '2026-08-04 00:00:03' });
    const attachment = journalAttachment();
    const { bucket, putKeys } = fakeBucket();
    const { db, getJournal, messageWrites } = materializationDb(journal, [target], [attachment]);

    await expect(materializeOutboundJournal(db, bucket, journal.id)).resolves.toMatchObject({
      journal: { state: 'materialized' },
      newInternalDeliveries: [],
    });
    expect(putKeys).toEqual([]);
    expect(messageWrites).toEqual([]);
    expect(getJournal().state).toBe('materialized');
  });

  it('replays cleanup for an already-materialized journal without rewriting message objects', async () => {
    const journal = acceptedJournal({
      state: 'materialized',
      materialized_at: '2026-08-04 00:00:03',
    });
    const target = journalTarget({ materialized_at: '2026-08-04 00:00:03' });
    const attachment = journalAttachment();
    const { bucket, deleteKeys, putKeys, seed } = fakeBucket();
    seed(journal.html_r2_key, '<p>The body</p>');
    seed(journal.text_r2_key, 'The body');
    seed(attachment.staging_r2_key, 'report');
    const { db, messageWrites } = materializationDb(journal, [target], [attachment]);

    await expect(materializeOutboundJournal(db, bucket, journal.id)).resolves.toEqual({
      journal,
      newInternalDeliveries: [],
    });
    expect(putKeys).toEqual([]);
    expect(messageWrites).toEqual([]);
    expect(deleteKeys).toEqual(expect.arrayContaining([
      journal.html_r2_key,
      journal.text_r2_key,
      attachment.staging_r2_key,
    ]));
  });
});
