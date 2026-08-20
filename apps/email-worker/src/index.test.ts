import { describe, expect, it, vi } from 'vitest';

import worker, {
  attachmentR2Key,
  getAttachmentLimit,
  getDecodedBodyLimit,
  getInboundLimit,
  inboundTransportFacts,
  isInboundSizeAllowed,
  isValidEnvelopeAddress,
  lookupSenderRule,
  messageBodyR2Key,
  extractInboundSnippet,
  inboundRateLimitActorKey,
  inboundFromParticipant,
  flattenParsedParticipants,
  normalizeMessageIdHeader,
  normalizeReferencesHeader,
  normalizeEnvelopeAddress,
  prepareInboundBody,
  RECIPIENT_UNAVAILABLE_SMTP_RESPONSE,
  retentionDays,
  retentionEnabled,
  stableInboundId,
} from './index';
import { parseMessageImportance } from '@cmail/shared/message-importance';
import { normalizeParticipants, sanitizeParticipantName } from '@cmail/shared/message-participants';
import PostalMime from 'postal-mime';

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
  mailboxes?: Record<string, { id: string; status: string }>;
  existing?: { id: string; body_r2_key: string | null } | null;
} = {}) {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const database = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind: (...values: unknown[]) => ({
          first: async () => {
            if (query.includes('FROM mailboxes')) {
              bindings.push(values);
              if (options.mailboxes) {
                const candidate = options.mailboxes[String(values[0])];
                return candidate?.status === values[1] ? candidate : null;
              }
              return options.mailbox ?? null;
            }
            if (query.includes('FROM messages')) return options.existing ?? null;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    },
  };
  return { database, queries, bindings };
}

async function invokeEmail(message: unknown, env: Record<string, unknown>): Promise<void> {
  const handler = worker as unknown as {
    email(value: unknown, environment: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
  };
  await handler.email(message, env, { waitUntil: vi.fn() });
}

async function invokeFetch(request: Request, env: Record<string, unknown>): Promise<Response> {
  const handler = worker as unknown as {
    fetch(value: Request, environment: Record<string, unknown>): Promise<Response>;
  };
  return handler.fetch(request, env);
}

describe('private outbound service binding', () => {
  it('maps the bounded internal payload to the native Email Service binding', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<cloudflare-message@example.test>' });
    const response = await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { address: 'desk@example.test', name: 'Example Desk' },
        to: ['recipient@example.net'],
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
        headers: { Importance: 'high', 'X-Priority': '1 (Highest)' },
      }),
    }), { EMAIL: { send } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, messageId: '<cloudflare-message@example.test>' });
    expect(send).toHaveBeenCalledWith({
      from: { email: 'desk@example.test', name: 'Example Desk' },
      to: ['recipient@example.net'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      headers: { Importance: 'high', 'X-Priority': '1 (Highest)' },
    });
  });

  it('maps an optional bcc list straight onto the native binding field', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<cloudflare-message@example.test>' });
    const response = await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'desk@example.test',
        to: ['recipient@example.net'],
        bcc: ['hidden@example.net'],
        subject: 'Hello',
        html: '<p>Hello</p>',
      }),
    }), { EMAIL: { send } });

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith({
      from: 'desk@example.test',
      to: ['recipient@example.net'],
      bcc: ['hidden@example.net'],
      subject: 'Hello',
      html: '<p>Hello</p>',
    });
  });

  it('stays backward compatible with an older payload that has no bcc field', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<cloudflare-message@example.test>' });
    const response = await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'desk@example.test',
        to: ['recipient@example.net'],
        subject: 'Hello',
        html: '<p>Hello</p>',
      }),
    }), { EMAIL: { send } });

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith({
      from: 'desk@example.test',
      to: ['recipient@example.net'],
      subject: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty('bcc');
  });

  it('rejects a bcc list that pushes the combined recipient count over the cap', async () => {
    const send = vi.fn();
    const response = await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'desk@example.test',
        to: ['recipient@example.net'],
        bcc: Array.from({ length: 50 }, (_, index) => `hidden${index}@example.net`),
        subject: 'Hello',
        html: '<p>Hello</p>',
      }),
    }), { EMAIL: { send } });

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed for public-looking routes, invalid payloads, and absent bindings', async () => {
    expect((await invokeFetch(new Request('https://worker.invalid/'), {})).status).toBe(404);
    expect((await invokeFetch(new Request('https://worker.invalid/internal/send', { method: 'POST', body: '{}' }), { EMAIL: { send: vi.fn() } })).status).toBe(404);
    expect((await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', { method: 'POST', body: '{}' }), {})).status).toBe(424);
    const invalid = await invokeFetch(
      new Request('https://cmail-email-worker.internal/internal/send', { method: 'POST', body: JSON.stringify({ to: ['bad'] }) }),
      { EMAIL: { send: vi.fn() } },
    );
    expect(invalid.status).toBe(400);
  });

  it('treats delivery-stage failures as ambiguous after the provider may have accepted recipients', async () => {
    const send = vi.fn().mockRejectedValue({ code: 'E_DELIVERY_FAILED' });
    const response = await invokeFetch(new Request('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'desk@example.test',
        to: ['recipient@example.net'],
        subject: 'Hello',
        html: '<p>Hello</p>',
      }),
    }), { EMAIL: { send } });

    expect(response.status).toBe(503);
  });

});

describe('RFC 5322 participant metadata', () => {
  async function parseHeaders(raw: string) {
    return new PostalMime().parse(new TextEncoder().encode(`${raw}\r\n\r\nBody`));
  }

  it('keeps decoded Unicode and quoted-comma names separate from canonical routing addresses', async () => {
    const parsed = await parseHeaders([
      'From: =?UTF-8?B?Sm9zw6kgTcO8bGxlcg==?= <Jose@example.test>',
      'To: "Evans, Robert" <ROBERT@example.test>',
      'Reply-To: =?UTF-8?Q?Helpdesk_=E2=80=94_Clio?= <HELP@example.test>',
    ].join('\r\n'));

    expect(inboundFromParticipant(parsed.from, 'envelope@example.test')).toEqual({
      address: 'jose@example.test', name: 'José Müller',
    });
    expect(flattenParsedParticipants(parsed.to)).toEqual([
      { address: 'robert@example.test', name: 'Evans, Robert' },
    ]);
    expect(flattenParsedParticipants(parsed.replyTo)).toEqual([
      { address: 'help@example.test', name: 'Helpdesk — Clio' },
    ]);
  });

  it('flattens MIME groups to valid members and drops malformed Reply-To entries', async () => {
    const parsed = await parseHeaders([
      'To: Engineering: "Doe, Jane" <JANE@example.test>, John <JOHN@example.test>;',
      'Reply-To: Not an address, valid@example.test',
    ].join('\r\n'));

    expect(flattenParsedParticipants(parsed.to)).toEqual([
      { address: 'jane@example.test', name: 'Doe, Jane' },
      { address: 'john@example.test', name: 'John' },
    ]);
    expect(flattenParsedParticipants(parsed.replyTo)).toEqual([
      { address: 'valid@example.test', name: '' },
    ]);
  });

  it('retains RFC quoted local-parts and domain literals after MIME parsing', async () => {
    const parsed = await parseHeaders([
      'From: Quoted sender <"john..doe"@example.test>',
      'To: Local service <user@[192.0.2.1]>',
      'Reply-To: Special <"team@desk"@example.test>',
    ].join('\r\n'));

    expect(inboundFromParticipant(parsed.from, 'envelope@example.test')).toEqual({
      address: '"john..doe"@example.test', name: 'Quoted sender',
    });
    expect(flattenParsedParticipants(parsed.to)).toEqual([
      { address: 'user@[192.0.2.1]', name: 'Local service' },
    ]);
    expect(flattenParsedParticipants(parsed.replyTo)).toEqual([
      { address: '"team@desk"@example.test', name: 'Special' },
    ]);
  });

  it('uses the validated envelope sender when From is malformed and never retains its name', async () => {
    const parsed = await parseHeaders('From: Display Only <not-an-address>');
    expect(inboundFromParticipant(parsed.from, 'envelope@example.test')).toEqual({
      address: 'envelope@example.test', name: '',
    });
  });

  it('removes invisible identity controls, bounds Unicode by code point, and keeps a useful duplicate name', () => {
    expect(sanitizeParticipantName('  Safe\r\n\u202Ename\u2066  ')).toBe('Safe name');
    expect(Array.from(sanitizeParticipantName('😀'.repeat(140)))).toHaveLength(120);
    expect(normalizeParticipants([
      { address: 'person@example.test', name: '' },
      { address: 'PERSON@example.test', name: 'Person Example' },
    ])).toEqual([{ address: 'person@example.test', name: 'Person Example' }]);
  });
});

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

  it('derives readable previews for HTML-only messages', () => {
    expect(extractInboundSnippet(undefined, '<p>Hello &amp; welcome</p><div>Second line</div>'))
      .toBe('Hello & welcome Second line');
  });
});

describe('message interoperability headers', () => {
  it('normalizes importance with deterministic precedence', () => {
    expect(parseMessageImportance([{ key: 'Importance', value: 'High' }])).toBe('high');
    expect(parseMessageImportance([{ key: 'X-Priority', value: '5 (Lowest)' }])).toBe('low');
    expect(parseMessageImportance([{ key: 'Priority', value: 'urgent' }])).toBe('high');
    expect(parseMessageImportance([
      { key: 'Importance', value: 'normal' },
      { key: 'X-MSMail-Priority', value: 'High' },
    ])).toBe('normal');
    expect(parseMessageImportance([{ key: 'Importance', value: 'high\r\nX-Evil: yes' }])).toBe('normal');
  });

  it('stores only bounded RFC-style Message-ID tokens and ancestry', () => {
    expect(normalizeMessageIdHeader('comment <parent@example.test> ignored')).toBe('<parent@example.test>');
    expect(normalizeMessageIdHeader('not-a-message-id')).toBeNull();
    expect(normalizeReferencesHeader('<root@example.test> bad <parent@example.test>'))
      .toBe('<root@example.test> <parent@example.test>');
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

describe('lookupSenderRule', () => {
  function senderRuleDatabase(rows: Array<{ pattern: string; action: string }>, options: { fails?: boolean } = {}) {
    const queries: string[] = [];
    const bindings: unknown[][] = [];
    const database = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind: (...values: unknown[]) => ({
            all: async () => {
              bindings.push(values);
              if (options.fails) throw new Error('D1 unavailable');
              return { results: rows };
            },
          }),
        };
      },
    };
    return { database, queries, bindings };
  }

  it('matches the exact address and its bare domain in one prepared statement', async () => {
    const db = senderRuleDatabase([]);
    const result = await lookupSenderRule(db.database as unknown as D1Database, 'person@example.test');

    expect(result).toBeNull();
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toContain('FROM sender_rules');
    expect(db.queries[0]).toContain('?1');
    expect(db.queries[0]).toContain('?2');
    expect(db.bindings).toEqual([['person@example.test', 'example.test']]);
  });

  it('splits on the final @ so a quoted local-part containing @ still resolves the real domain', async () => {
    // Matches normalizeParticipantAddress: a quoted local-part may itself
    // contain @, so the domain is whatever follows the *last* @.
    const db = senderRuleDatabase([]);
    await lookupSenderRule(db.database as unknown as D1Database, '"team@desk"@example.test');

    expect(db.bindings).toEqual([['"team@desk"@example.test', 'example.test']]);
  });

  it('returns the rule pickSenderRule resolves as the winner', async () => {
    const blocked = senderRuleDatabase([{ pattern: 'person@example.test', action: 'block' }]);
    expect(await lookupSenderRule(blocked.database as unknown as D1Database, 'person@example.test')).toBe('block');

    const allowed = senderRuleDatabase([{ pattern: 'example.test', action: 'allow' }]);
    expect(await lookupSenderRule(allowed.database as unknown as D1Database, 'person@example.test')).toBe('allow');
  });

  it('fails open to no rule when the lookup throws, so a management-table fault never blocks delivery', async () => {
    const db = senderRuleDatabase([], { fails: true });
    expect(await lookupSenderRule(db.database as unknown as D1Database, 'person@example.test')).toBeNull();
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
  it('emits one generic rate-limited abuse alert without turning a threshold into an SMTP rejection', async () => {
    const db = entryDatabase({
      mailbox: { id: 'mailbox-test', status: 'active' },
      existing: { id: 'inbound-existing', body_r2_key: 'messages/opaque/body' },
    });
    const storage = { put: vi.fn(), delete: vi.fn() };
    const email = { send: vi.fn() };
    const actorLimiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const globalLimiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const alertLimiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const observed = routedMessage({ messageId: '<known-rate-limit@example.test>' });
    const warn = vi.spyOn(console, 'warn');

    try {
      await invokeEmail(observed.value, {
        DB: db.database,
        STORAGE: storage,
        EMAIL: email,
        INBOUND_ACTOR_RATE_LIMITER: actorLimiter,
        INBOUND_GLOBAL_RATE_LIMITER: globalLimiter,
        INBOUND_ABUSE_ALERT_RATE_LIMITER: alertLimiter,
      });

      expect(observed.setReject).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledExactlyOnceWith('Inbound native rate-limit threshold observed');
      expect(actorLimiter.limit).toHaveBeenCalledTimes(1);
      expect(actorLimiter.limit.mock.calls[0]?.[0]?.key).toMatch(/^actor:[a-f0-9]{64}$/);
      expect(actorLimiter.limit.mock.calls[0]?.[0]?.key).not.toContain('sender@example.test');
      expect(globalLimiter.limit).toHaveBeenCalledExactlyOnceWith({ key: 'inbound-email' });
      expect(alertLimiter.limit).toHaveBeenCalledExactlyOnceWith({ key: 'inbound-abuse-alert' });
      expect(db.queries).toHaveLength(2);
      expect(db.queries[0]).toContain('FROM mailboxes');
      expect(db.queries[1]).toContain('FROM messages');
      expect(storage.put).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
      expect(observed.value.forward).not.toHaveBeenCalled();
      expect(observed.value.reply).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('suppresses the alert when its dedicated rate-limit binding is absent, denied, or faults', async () => {
    for (const alertLimiter of [undefined, { limit: vi.fn().mockResolvedValue({ success: false }) }, { limit: vi.fn().mockRejectedValue(new Error('edge binding unavailable')) }]) {
      const db = entryDatabase({
        mailbox: { id: 'mailbox-test', status: 'active' },
        existing: { id: 'inbound-existing', body_r2_key: 'messages/opaque/body' },
      });
      const observed = routedMessage({ messageId: '<known-rate-limit@example.test>' });
      const warn = vi.spyOn(console, 'warn');
      try {
        await invokeEmail(observed.value, {
          DB: db.database,
          STORAGE: { put: vi.fn(), delete: vi.fn() },
          INBOUND_ACTOR_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
          INBOUND_ABUSE_ALERT_RATE_LIMITER: alertLimiter,
        });
        expect(observed.setReject).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(db.queries).toHaveLength(2);
      } finally {
        warn.mockRestore();
      }
    }
  });

  it('uses only a trusted boundary source IP for the actor key and observes the aggregate per-colo signal', async () => {
    const db = entryDatabase({
      mailbox: { id: 'mailbox-test', status: 'active' },
      existing: { id: 'inbound-existing', body_r2_key: 'messages/opaque/body' },
    });
    const actorLimiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const globalLimiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const observed = routedMessage({ messageId: '<known-rate-limit@example.test>' });
    observed.value.headers.set('authentication-results', 'edge.example.test; spf=pass smtp.remote-ip=203.0.113.9');

    await invokeEmail(observed.value, {
      DB: db.database,
      STORAGE: { put: vi.fn(), delete: vi.fn() },
      INBOUND_AUTHSERV_ID: 'edge.example.test',
      INBOUND_ACTOR_RATE_LIMITER: actorLimiter,
      INBOUND_GLOBAL_RATE_LIMITER: globalLimiter,
    });

    expect(actorLimiter.limit).toHaveBeenCalledTimes(1);
    expect(actorLimiter.limit.mock.calls[0]?.[0]?.key).toMatch(/^actor:[a-f0-9]{64}$/);
    expect(actorLimiter.limit.mock.calls[0]?.[0]?.key).not.toContain('203.0.113.9');
    expect(globalLimiter.limit).toHaveBeenCalledExactlyOnceWith({ key: 'inbound-email' });
    expect(observed.setReject).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(2);
    const senderKey = await inboundRateLimitActorKey(null, 'sender@example.test');
    const sourceIpKey = await inboundRateLimitActorKey('203.0.113.9', 'sender@example.test');
    expect(senderKey).toMatch(/^actor:[a-f0-9]{64}$/);
    expect(sourceIpKey).toMatch(/^actor:[a-f0-9]{64}$/);
    expect(senderKey).not.toBe(sourceIpKey);
  });

  it('fails open when native limiter bindings are absent or fault, then reaches the normal recipient path', async () => {
    for (const limiter of [undefined, { limit: vi.fn().mockRejectedValue(new Error('edge binding unavailable')) }]) {
      const db = entryDatabase({
        mailbox: { id: 'mailbox-test', status: 'active' },
        existing: { id: 'inbound-existing', body_r2_key: 'messages/opaque/body' },
      });
      const accepted = routedMessage({ messageId: '<known-rate-limit@example.test>' });
      await invokeEmail(accepted.value, {
        DB: db.database,
        STORAGE: { put: vi.fn(), delete: vi.fn() },
        INBOUND_ACTOR_RATE_LIMITER: limiter,
      });

      expect(accepted.setReject).not.toHaveBeenCalled();
      expect(db.queries).toHaveLength(2);
      expect(db.queries[0]).toContain('FROM mailboxes');
      expect(db.queries[1]).toContain('FROM messages');
    }
  });

  it('does not change unknown/offboarded recipient disclosure when a threshold is observed', async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const unknown = routedMessage({ to: 'unknown@example.test' });
    const offboarded = routedMessage({ to: 'offboarded@example.test' });
    const unknownDb = entryDatabase({ mailbox: null });
    const offboardedDb = entryDatabase({ mailbox: null });

    await invokeEmail(unknown.value, { DB: unknownDb.database, INBOUND_ACTOR_RATE_LIMITER: limiter });
    await invokeEmail(offboarded.value, { DB: offboardedDb.database, INBOUND_ACTOR_RATE_LIMITER: limiter });

    expect(unknown.setReject).toHaveBeenCalledExactlyOnceWith(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(offboarded.setReject).toHaveBeenCalledExactlyOnceWith(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(unknown.setReject.mock.calls[0]?.[0]).toBe(offboarded.setReject.mock.calls[0]?.[0]);
    expect(unknownDb.queries).toHaveLength(1);
    expect(offboardedDb.queries).toHaveLength(1);
  });

  it('uses a plain-text recipient-unavailable reason and leaves SMTP status selection to Cloudflare', () => {
    expect(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE).toBe('cmail: recipient unavailable; verify the address or contact the organisation');
    expect(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE).not.toMatch(/\b[45]\d\d(?:[ .]|$)/);
  });

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

  it('returns an identical neutral SMTP diagnostic for unknown and disabled/offboarded recipients without side effects', async () => {
    const unknownDb = entryDatabase({ mailbox: null });
    const unavailableDb = entryDatabase({
      // The test database models a stored, disabled mailbox. The worker's
      // active-only lookup must not return it to the inbound delivery path.
      mailboxes: { 'offboarded@example.test': { id: 'former-mailbox', status: 'disabled' } },
    });
    const unknown = routedMessage({ to: 'unknown@example.test' });
    const unavailable = routedMessage({ to: 'offboarded@example.test' });
    const unknownStorage = { put: vi.fn(), delete: vi.fn() };
    const unavailableStorage = { put: vi.fn(), delete: vi.fn() };
    const unknownEmail = { send: vi.fn() };
    const unavailableEmail = { send: vi.fn() };

    await invokeEmail(unknown.value, {
      DB: unknownDb.database,
      STORAGE: unknownStorage,
      EMAIL: unknownEmail,
    });
    await invokeEmail(unavailable.value, {
      DB: unavailableDb.database,
      STORAGE: unavailableStorage,
      EMAIL: unavailableEmail,
    });

    expect(unknown.setReject).toHaveBeenCalledExactlyOnceWith(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(unavailable.setReject).toHaveBeenCalledExactlyOnceWith(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(unknown.setReject.mock.calls[0]?.[0]).toBe(unavailable.setReject.mock.calls[0]?.[0]);

    for (const attempt of [
      { db: unknownDb, message: unknown, storage: unknownStorage, email: unknownEmail },
      { db: unavailableDb, message: unavailable, storage: unavailableStorage, email: unavailableEmail },
    ]) {
      // The active-mailbox lookup is the sole D1 operation: no reservation,
      // trace, message, or other durable work is reachable from this path.
      expect(attempt.db.queries).toHaveLength(1);
      expect(attempt.db.queries[0]).toContain('FROM mailboxes');
      expect(attempt.db.queries[0]).toContain("status = ?");
      expect(attempt.db.bindings).toEqual([[attempt.message.value.to, 'active']]);
      expect(attempt.db.queries.some((query) => /INSERT|UPDATE|DELETE/i.test(query))).toBe(false);
      expect(attempt.message.value.forward).not.toHaveBeenCalled();
      expect(attempt.message.value.reply).not.toHaveBeenCalled();
      expect(attempt.email.send).not.toHaveBeenCalled();
      expect(attempt.storage.put).not.toHaveBeenCalled();
      expect(attempt.storage.delete).not.toHaveBeenCalled();
    }
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
