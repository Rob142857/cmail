import { describe, expect, it, vi } from 'vitest';

import worker, {
  attachmentR2Key,
  getAttachmentLimit,
  getDecodedBodyLimit,
  getInboundLimit,
  inboundTransportFacts,
  isInboundSizeAllowed,
  isValidEnvelopeAddress,
  messageBodyR2Key,
  normalizeEnvelopeAddress,
  prepareInboundBody,
  retentionDays,
  retentionEnabled,
  stableInboundId,
} from './index';

function routedMessage(overrides: Partial<{
  from: string;
  to: string;
  rawSize: number;
  messageId: string;
}> = {}) {
  const setReject = vi.fn();
  const headers = new Headers();
  if (overrides.messageId) headers.set('message-id', overrides.messageId);
  return {
    value: {
      from: overrides.from ?? 'sender@example.test',
      to: overrides.to ?? 'mailbox@example.test',
      rawSize: overrides.rawSize ?? 100,
      headers,
      raw: new Blob(['synthetic message']).stream(),
      setReject,
      forward: vi.fn(),
      reply: vi.fn(),
    },
    setReject,
  };
}

function entryDatabase(options: {
  mailbox?: { id: string; status: string } | null;
  existing?: { id: string; body_r2_key: string | null } | null;
} = {}) {
  const queries: string[] = [];
  const database = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind: (..._values: unknown[]) => ({
          first: async () => {
            if (query.includes('FROM mailboxes')) return options.mailbox ?? null;
            if (query.includes('FROM messages')) return options.existing ?? null;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    },
  };
  return { database, queries };
}

async function invokeEmail(message: unknown, env: Record<string, unknown>): Promise<void> {
  const handler = worker as unknown as {
    email(value: unknown, environment: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
  };
  await handler.email(message, env, { waitUntil: vi.fn() });
}

describe('inbound size limits', () => {
  it('uses a safe default for absent or invalid configuration', () => {
    const expected = 10 * 1024 * 1024;

    expect(getInboundLimit({})).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: '' })).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: 'not-a-number' })).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: 0 })).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: -1 })).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: 0.5 })).toBe(expected);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: Number.POSITIVE_INFINITY })).toBe(expected);
  });

  it('floors configured byte limits and clamps them to the hard ceiling', () => {
    expect(getInboundLimit({ MAX_INBOUND_BYTES: '4096.9' })).toBe(4096);
    expect(getInboundLimit({ MAX_INBOUND_BYTES: 100 * 1024 * 1024 })).toBe(25 * 1024 * 1024);
  });

  it('accepts only non-negative safe integer sizes at or below the limit', () => {
    expect(isInboundSizeAllowed(0, 10)).toBe(true);
    expect(isInboundSizeAllowed(10, 10)).toBe(true);
    expect(isInboundSizeAllowed(11, 10)).toBe(false);
    expect(isInboundSizeAllowed(-1, 10)).toBe(false);
    expect(isInboundSizeAllowed(1.5, 10)).toBe(false);
    expect(isInboundSizeAllowed(Number.NaN, 10)).toBe(false);
    expect(isInboundSizeAllowed(Number.POSITIVE_INFINITY, 10)).toBe(false);
    expect(isInboundSizeAllowed(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe('attachment count limits', () => {
  it('uses a safe default for absent or invalid configuration', () => {
    expect(getAttachmentLimit({})).toBe(25);
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: '' })).toBe(25);
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: 'invalid' })).toBe(25);
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: 0 })).toBe(25);
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: 0.9 })).toBe(25);
  });

  it('floors configured limits and clamps them to the hard ceiling', () => {
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: '12.8' })).toBe(12);
    expect(getAttachmentLimit({ MAX_ATTACHMENTS_PER_MESSAGE: 999 })).toBe(50);
  });
});

describe('decoded body safety', () => {
  it('uses a bounded default and clamps operator configuration', () => {
    expect(getDecodedBodyLimit({})).toBe(512 * 1024);
    expect(getDecodedBodyLimit({ MAX_INBOUND_DECODED_BODY_BYTES: '' })).toBe(512 * 1024);
    expect(getDecodedBodyLimit({ MAX_INBOUND_DECODED_BODY_BYTES: 0 })).toBe(512 * 1024);
    expect(getDecodedBodyLimit({ MAX_INBOUND_DECODED_BODY_BYTES: '4096.9' })).toBe(4096);
    expect(getDecodedBodyLimit({ MAX_INBOUND_DECODED_BODY_BYTES: 50 * 1024 * 1024 })).toBe(2 * 1024 * 1024);
  });

  it('sanitizes active HTML once at ingest', () => {
    const result = prepareInboundBody(
      '<script>alert(1)</script><p onclick="alert(2)">Safe</p>',
      undefined,
      64 * 1024,
    );
    expect(result).toEqual({ ok: true, html: '<p>Safe</p>' });
  });

  it('rejects oversized, deeply nested, and expansion-heavy plain bodies', () => {
    expect(prepareInboundBody('<p>12345</p>', undefined, 8)).toEqual({ ok: false, reason: 'input_bytes' });

    const deep = `${'<div>'.repeat(129)}content${'</div>'.repeat(129)}`;
    expect(prepareInboundBody(deep, undefined, 64 * 1024)).toEqual({ ok: false, reason: 'depth' });

    // Escaping must also fit the persisted-output ceiling.
    expect(prepareInboundBody(undefined, '&'.repeat(1_000), 1_100)).toEqual({ ok: false, reason: 'output_bytes' });
  });
});

describe('inbound transport facts', () => {
  it('ignores sender-controlled authentication and source-IP headers', () => {
    const headers = new Headers({
      'Authentication-Results': 'attacker.invalid; spf=pass; dkim=pass; dmarc=fail',
      'X-Real-IP': '203.0.113.9',
    });
    expect(inboundTransportFacts(headers)).toEqual({
      sourceIp: null,
      spf: null,
      dkim: null,
      dmarc: null,
    });
  });
});

describe('envelope addresses', () => {
  it('normalizes casing and surrounding whitespace', () => {
    expect(normalizeEnvelopeAddress('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('accepts bounded mailbox addresses', () => {
    expect(isValidEnvelopeAddress('user@example.com')).toBe(true);
    expect(isValidEnvelopeAddress(`${'a'.repeat(64)}@example.com`)).toBe(true);
    expect(isValidEnvelopeAddress('üser@example.com')).toBe(true);
  });

  it('rejects malformed, control-bearing, or overlong addresses', () => {
    expect(isValidEnvelopeAddress('')).toBe(false);
    expect(isValidEnvelopeAddress('not-an-address')).toBe(false);
    expect(isValidEnvelopeAddress('@example.com')).toBe(false);
    expect(isValidEnvelopeAddress('user@')).toBe(false);
    expect(isValidEnvelopeAddress('one@two@example.com')).toBe(false);
    expect(isValidEnvelopeAddress('user @example.com')).toBe(false);
    expect(isValidEnvelopeAddress('user@example.com\r\nBcc: victim@example.com')).toBe(false);
    expect(isValidEnvelopeAddress(`${'a'.repeat(65)}@example.com`)).toBe(false);
    expect(isValidEnvelopeAddress('user@.example.com')).toBe(false);
    expect(isValidEnvelopeAddress('user@example.com.')).toBe(false);
  });
});

describe('delivery identity and storage keys', () => {
  it('derives stable, mailbox-scoped IDs from Message-ID headers', async () => {
    const first = await stableInboundId('mailbox-a', '<message@example.com>');
    const repeated = await stableInboundId('mailbox-a', '<message@example.com>');
    const anotherMailbox = await stableInboundId('mailbox-b', '<message@example.com>');
    const anotherMessage = await stableInboundId('mailbox-a', '<other@example.com>');

    expect(first).toBe(repeated);
    expect(first).toMatch(/^inbound-[0-9a-f]{64}$/);
    expect(anotherMailbox).not.toBe(first);
    expect(anotherMessage).not.toBe(first);
  });

  it('builds opaque R2 keys and refuses path-like input', () => {
    const namespace = '11111111-1111-4111-8111-111111111111';
    const objectId = '22222222-2222-4222-8222-222222222222';

    expect(messageBodyR2Key(namespace, objectId)).toBe(`messages/${namespace}/${objectId}`);
    expect(attachmentR2Key(namespace, objectId)).toBe(`attachments/${namespace}/${objectId}`);
    expect(() => attachmentR2Key(namespace, '../../payload.exe')).toThrow(TypeError);
    expect(() => messageBodyR2Key('filename-controlled', objectId)).toThrow(TypeError);
  });
});

describe('retention configuration', () => {
  it('requires an explicit affirmative opt-in', () => {
    for (const enabled of ['1', 'true', 'TRUE', 'yes', 'on', 1, true]) {
      expect(retentionEnabled({ RETENTION_JOBS_ENABLED: enabled })).toBe(true);
    }

    for (const disabled of [undefined, '', '0', 'false', 'off', 0, false]) {
      expect(retentionEnabled({ RETENTION_JOBS_ENABLED: disabled })).toBe(false);
    }
  });

  it('rejects invalid retention periods and caps excessively long ones', () => {
    expect(retentionDays(new Map(), 'trace')).toBeNull();
    expect(retentionDays(new Map([['trace', 0]]), 'trace')).toBeNull();
    expect(retentionDays(new Map([['trace', -1]]), 'trace')).toBeNull();
    expect(retentionDays(new Map([['trace', 1.5]]), 'trace')).toBeNull();
    expect(retentionDays(new Map([['trace', Number.NaN]]), 'trace')).toBeNull();
    expect(retentionDays(new Map([['trace', 90]]), 'trace')).toBe(90);
    expect(retentionDays(new Map([['trace', 100_000]]), 'trace')).toBe(3650);
  });
});

describe('pre-reservation write amplification', () => {
  it('does not persist invalid-envelope or oversized attempts', async () => {
    const invalidDb = entryDatabase();
    const invalid = routedMessage({ from: 'not-an-address' });
    await invokeEmail(invalid.value, {
      DB: invalidDb.database,
      STORAGE: { put: vi.fn(), delete: vi.fn() },
    });
    expect(invalid.setReject).toHaveBeenCalledOnce();
    expect(invalidDb.queries).toEqual([]);

    const oversizedDb = entryDatabase();
    const oversized = routedMessage({ rawSize: 101 });
    await invokeEmail(oversized.value, {
      DB: oversizedDb.database,
      STORAGE: { put: vi.fn(), delete: vi.fn() },
      MAX_INBOUND_BYTES: 100,
    });
    expect(oversized.setReject).toHaveBeenCalledOnce();
    expect(oversizedDb.queries).toEqual([]);
  });

  it('performs only the mailbox lookup for repeated unknown recipients', async () => {
    const db = entryDatabase({ mailbox: null });
    for (let index = 0; index < 20; index += 1) {
      const attempt = routedMessage({ to: `unknown-${index}@example.test` });
      await invokeEmail(attempt.value, {
        DB: db.database,
        STORAGE: { put: vi.fn(), delete: vi.fn() },
      });
      expect(attempt.setReject).toHaveBeenCalledOnce();
    }

    expect(db.queries).toHaveLength(20);
    expect(db.queries.every((query) => query.includes('FROM mailboxes'))).toBe(true);
    expect(db.queries.some((query) => /INSERT|UPDATE|DELETE/i.test(query))).toBe(false);
  });

  it('suppresses repeated established Message-IDs without trace, quota, message, or R2 writes', async () => {
    const db = entryDatabase({
      mailbox: { id: 'mailbox-test', status: 'active' },
      existing: { id: 'inbound-existing', body_r2_key: 'messages/opaque/body' },
    });
    const storage = { put: vi.fn(), delete: vi.fn() };

    for (let index = 0; index < 20; index += 1) {
      const replay = routedMessage({ messageId: '<known-replay@example.test>' });
      await invokeEmail(replay.value, { DB: db.database, STORAGE: storage });
      expect(replay.setReject).not.toHaveBeenCalled();
    }

    expect(db.queries.filter((query) => query.includes('FROM mailboxes'))).toHaveLength(20);
    expect(db.queries.filter((query) => query.includes('FROM messages'))).toHaveLength(20);
    expect(db.queries.some((query) => /INSERT|UPDATE|DELETE/i.test(query))).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
