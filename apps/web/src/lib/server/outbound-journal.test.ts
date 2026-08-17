import { describe, expect, it } from 'vitest';
import {
  claimOutboundDispatch,
  findDraftOutboundJournal,
  fingerprintJournalPayload,
  insertOutboundJournal,
  journalProviderResultKey,
  journalStateResponse,
  stageJournalPayload,
  targetAttachmentKey,
  targetBodyKey,
} from './outbound-journal';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'cloudflare' as const,
    from: 'sender@example.com',
    fromName: 'Sender Example',
    to: ['person@example.net'],
    cc: ['copy@example.net'],
    envelopeRecipients: ['person@example.net', 'copy@example.net'],
    subject: 'Standards check',
    html: '<p>Hello</p>',
    text: 'Hello',
    snippet: 'Hello',
    importance: 'normal' as const,
    inReplyTo: '<parent@example.net>',
    referencesHeader: '<root@example.net> <parent@example.net>',
    threadId: '<root@example.net>',
    deliveryTargets: [
      { mailboxId: 'sender-mailbox', direction: 'outbound' as const, folder: 'sent' as const },
    ],
    attachments: [
      {
        filename: 'report.txt',
        contentType: 'text/plain',
        bytes: new TextEncoder().encode('report'),
      },
    ],
    ...overrides,
  };
}

describe('durable outbound journal', () => {
  it('inserts the sender display name with one D1 placeholder per bound value', async () => {
    interface CapturedStatement {
      query: string;
      values: unknown[];
      bind: (...values: unknown[]) => CapturedStatement;
    }
    const statements: CapturedStatement[] = [];
    const db = {
      prepare(query: string) {
        const statement: CapturedStatement = {
          query,
          values: [],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
        };
        statements.push(statement);
        return statement;
      },
      async batch(rawStatements: D1PreparedStatement[]) {
        const batch = rawStatements as unknown as CapturedStatement[];
        for (const statement of batch) {
          const placeholderCount = (statement.query.match(/\?/g) || []).length;
          if (placeholderCount !== statement.values.length) {
            throw new Error(`D1 bind arity mismatch: ${placeholderCount} placeholders for ${statement.values.length} values`);
          }
        }
        return batch.map(() => ({ success: true, meta: { changes: 1 } }));
      },
    } as unknown as D1Database;

    await insertOutboundJournal(db, {
      id: 'journal-1',
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      idempotencyKey: 'send-claim-1',
      fingerprint: {
        payloadHash: 'a'.repeat(64),
        htmlHash: 'b'.repeat(64),
        textHash: 'c'.repeat(64),
        attachmentHashes: [],
      },
      staged: {
        htmlKey: 'outbound-journal/journal-1/body.html',
        textKey: 'outbound-journal/journal-1/body.txt',
        attachmentKeys: [],
        stagedKeys: [
          'outbound-journal/journal-1/body.html',
          'outbound-journal/journal-1/body.txt',
        ],
      },
      provider: 'cloudflare',
      from: 'sender@example.com',
      fromName: 'Sender Example',
      to: ['person@example.net'],
      cc: [],
      envelopeRecipients: ['person@example.net'],
      subject: 'Journal insertion regression',
      snippet: 'Hello',
      importance: 'normal',
      inReplyTo: null,
      referencesHeader: null,
      threadId: '<journal-1@example.com>',
      proposedMessageIdHeader: '<journal-1@example.com>',
      persistedBytes: 12,
      providerPayloadBytes: 18,
      draftId: 'draft-1',
      claimedDraftVersion: 2,
      draftBodyR2Key: 'messages/mailbox-1/draft-1/body.html',
      targets: [{
        id: 'target-1',
        messageId: 'message-1',
        mailboxId: 'mailbox-1',
        direction: 'outbound',
        folder: 'sent',
        attachmentIds: [],
      }],
      attachments: [],
      reservations: [{ reservationId: 'reservation-1', deliveryKey: 'message-1' }],
    });

    const journalInsert = statements.find(({ query }) => query.includes('INSERT INTO outbound_send_journal'));
    expect(journalInsert).toBeDefined();
    expect((journalInsert!.query.match(/\?/g) || [])).toHaveLength(28);
    expect(journalInsert!.values).toHaveLength(28);
    expect(journalInsert!.values[9]).toBe('Sender Example');
    expect(journalInsert!.query).toMatch(/'pending',\s*\?,\s*\?,\s*\?,\s*\?/);
  });

  it('fingerprints the complete immutable delivery plan deterministically', async () => {
    const first = await fingerprintJournalPayload(payload());
    const second = await fingerprintJournalPayload(payload());
    expect(second).toEqual(first);
    expect(first.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.attachmentHashes).toHaveLength(1);
  });

  it.each([
    ['body', { html: '<p>Changed</p>' }],
    ['recipient', { envelopeRecipients: ['other@example.net'] }],
    ['sender display name', { fromName: 'Changed Sender' }],
    ['importance', { importance: 'high' as const }],
    ['target plan', { deliveryTargets: [{ mailboxId: 'other-mailbox', direction: 'internal' as const, folder: 'inbox' as const }] }],
    ['attachment bytes', { attachments: [{ filename: 'report.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('changed') }] }],
  ])('detects a changed %s under the same idempotency key', async (_label, change) => {
    const original = await fingerprintJournalPayload(payload());
    const changed = await fingerprintJournalPayload(payload(change));
    expect(changed.payloadHash).not.toBe(original.payloadHash);
  });

  it('uses deterministic private staging and destination keys', () => {
    expect(journalProviderResultKey('job-1', 'attempt-1'))
      .toBe('outbound-journal/job-1/provider-results/attempt-1.json');
    expect(targetBodyKey('mailbox-1', 'message-1'))
      .toBe('messages/mailbox-1/message-1/body.html');
    expect(targetAttachmentKey('message-1', 'attachment-1'))
      .toBe('attachments/message-1/attachment-1');
  });

  it('removes already-written staging objects when a later R2 write fails', async () => {
    const stored = new Set<string>();
    const deleted: string[] = [];
    let writes = 0;
    const storage = {
      async put(key: string) {
        writes += 1;
        if (writes === 3) throw new Error('injected failure');
        stored.add(key);
        return { key };
      },
      async delete(key: string) {
        deleted.push(key);
        stored.delete(key);
      },
    } as unknown as R2Bucket;
    const input = payload();
    const fingerprint = await fingerprintJournalPayload(input);

    await expect(stageJournalPayload(
      storage,
      'job-failure',
      input.html,
      input.text,
      input.attachments,
      fingerprint,
    )).rejects.toThrow('injected failure');
    expect(stored.size).toBe(0);
    expect(deleted).toEqual([
      'outbound-journal/job-failure/body.html',
      'outbound-journal/job-failure/body.txt',
    ]);
  });

  it('classifies ambiguous and dispatching jobs as never-auto-retry', () => {
    expect(journalStateResponse('pending')).toBe('dispatch');
    expect(journalStateResponse('retryable_failure')).toBe('retryable');
    expect(journalStateResponse('dispatching')).toBe('unknown');
    expect(journalStateResponse('ambiguous')).toBe('unknown');
    expect(journalStateResponse('accepted')).toBe('materialize');
    expect(journalStateResponse('materialized')).toBe('complete');
  });

  it('claims dispatch only through the guarded compare-and-swap statement', async () => {
    let sql = '';
    let bindings: unknown[] = [];
    const db = {
      prepare(value: string) {
        sql = value;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await expect(claimOutboundDispatch(db, 'job-1', 'attempt-1')).resolves.toBe(true);
    expect(sql).toContain("WHERE id = ? AND state IN ('pending', 'retryable_failure')");
    expect(sql).toContain("state = 'dispatching'");
    expect(bindings).toEqual(['attempt-1', 'job-1']);
  });

  it('recovers a draft journal from either side of the claim increment', async () => {
    let sql = '';
    let bindings: unknown[] = [];
    const db = {
      prepare(value: string) {
        sql = value;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async first() {
            return null;
          },
        };
      },
    } as unknown as D1Database;

    await expect(findDraftOutboundJournal(db, 'user-1', 'draft-1', 7)).resolves.toBeNull();
    expect(sql).toContain('claimed_draft_version IN (?, ?)');
    expect(sql).toContain("'materialized'");
    expect(bindings).toEqual(['user-1', 'draft-1', 7, 8]);
  });
});
