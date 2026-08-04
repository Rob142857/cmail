import { describe, expect, it } from 'vitest';
import {
  claimOutboundDispatch,
  findDraftOutboundJournal,
  fingerprintJournalPayload,
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
