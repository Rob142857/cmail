import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectProvider,
  buildRawMimeMessage,
  getProviderInfo,
  preflightEmail,
  sanitizeSenderDisplayName,
  sendEmail,
  type OutboundEmail,
} from './outbound';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const API_TOKEN = 'cloudflare-email-api-token-for-tests';
const baseEmail: OutboundEmail = {
  from: 'sender@example.com',
  to: ['one@example.net'],
  subject: 'Test message',
  html: '<p>Hello</p>',
  text: 'Hello',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('outbound provider selection', () => {
  it('prefers a complete Cloudflare configuration in auto mode', () => {
    const env = {
      OUTBOUND_PROVIDER: 'auto',
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_EMAIL_API_TOKEN: API_TOKEN,
      POSTMARK_API_KEY: 'postmark-api-key-for-tests',
    };
    expect(detectProvider(env)).toBe('cloudflare');
    expect(getProviderInfo(env)).toEqual({ name: 'cloudflare', label: 'Cloudflare Email Service' });
  });

  it('selects the private Cloudflare service binding without an API token', () => {
    expect(detectProvider({ EMAIL_SERVICE: { fetch: vi.fn() } })).toBe('cloudflare');
  });

  it('retains Postmark as the portable fallback when Cloudflare is incomplete', () => {
    expect(detectProvider({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      POSTMARK_API_KEY: 'postmark-api-key-for-tests',
    })).toBe('postmark');
  });

  it('fails closed for an unavailable or unrecognised explicit provider', () => {
    expect(detectProvider({ OUTBOUND_PROVIDER: 'cloudflare', POSTMARK_API_KEY: 'postmark-api-key-for-tests' })).toBe('none');
    expect(detectProvider({ OUTBOUND_PROVIDER: 'typo', POSTMARK_API_KEY: 'postmark-api-key-for-tests' })).toBe('none');
    expect(detectProvider({
      OUTBOUND_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: '../unsafe',
      CLOUDFLARE_EMAIL_API_TOKEN: API_TOKEN,
    })).toBe('none');
  });
});

describe('outbound sender identity', () => {
  it('removes control, bidi, quote, and backslash ambiguity before transport', () => {
    expect(sanitizeSenderDisplayName('  Safe\u0085\u202Ename\u2066 "Desk"\\  ')).toBe('Safe name Desk');
    expect(Array.from(sanitizeSenderDisplayName('😀'.repeat(140)))).toHaveLength(120);
    const raw = buildRawMimeMessage({
      ...baseEmail,
      fromName: 'Safe\u202Ename\u2066 "Desk"\\',
    });
    expect(raw).toMatch(/^From: =\?utf-8\?B\?U2FmZSBuYW1lIERlc2s=\?= <sender@example\.com>$/im);
    expect(raw).not.toMatch(/[\u0085\u202e\u2066]/u);
  });
});

describe('Cloudflare Email Service REST provider', () => {
  const env = {
    OUTBOUND_PROVIDER: 'cloudflare',
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: API_TOKEN,
  };

  it('maps addresses, attachments, reply-to, and only safe threading headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: {
        delivered: ['one@example.net', 'two@example.net', 'copy@example.net'],
        queued: [],
        permanent_bounces: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      ...baseEmail,
      fromName: 'Example Desk',
      to: ['one@example.net', 'two@example.net'],
      cc: ['copy@example.net'],
      replyTo: 'replies@example.com',
      importance: 'high',
      headers: {
        'in-reply-to': '<original@example.net>',
        'References': '<root@example.net> <original@example.net>',
        'Date': 'must-not-be-forwarded',
        'X-Internal': 'must-not-be-forwarded',
      },
      attachments: [{
        filename: 'hello.txt',
        contentType: 'text/plain',
        content: new Uint8Array([0, 1, 2]),
      }],
    }, env);

    expect(result).toEqual({
      success: true,
      provider: 'cloudflare',
      messageIdUnavailable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: { address: 'sender@example.com', name: 'Example Desk' },
      to: ['one@example.net', 'two@example.net'],
      cc: ['copy@example.net'],
      subject: 'Test message',
      html: '<p>Hello</p>',
      text: 'Hello',
      reply_to: 'replies@example.com',
      headers: {
        'In-Reply-To': '<original@example.net>',
        'References': '<root@example.net> <original@example.net>',
        'Importance': 'high',
        'X-Priority': '1 (Highest)',
        'X-MSMail-Priority': 'High',
      },
      attachments: [{
        content: 'AAEC',
        filename: 'hello.txt',
        type: 'text/plain',
        disposition: 'attachment',
      }],
    });
  });

  it('rejects over-limit messages and recipient counts before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const oversizedEmail = { ...baseEmail, html: 'x'.repeat(5 * 1024 * 1024) };
    expect(preflightEmail(oversizedEmail, env)).toMatchObject({ ok: false, status: 413 });
    await expect(sendEmail(oversizedEmail, env)).resolves.toMatchObject({ success: false, provider: 'cloudflare' });

    const tooManyRecipients = {
      ...baseEmail,
      to: Array.from({ length: 51 }, (_, index) => `person${index}@example.net`),
    };
    expect(preflightEmail(tooManyRecipients, env)).toMatchObject({ ok: false, status: 400 });
    await expect(sendEmail(tooManyRecipients, env)).resolves.toMatchObject({ success: false, provider: 'cloudflare' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose response bodies or accept malformed REST success payloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10101, message: 'sensitive provider detail' }],
      }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { message_id: 'not-an-rfc-message-id' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const rejected = await sendEmail(baseEmail, env);
    expect(rejected).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Cloudflare Email Service rejected the request (401)',
    });
    expect(rejected.error).not.toContain('sensitive');

    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
      error: 'Cloudflare Email Service returned an invalid response',
    });
  });

  it('marks transport failures as ambiguous so callers do not create duplicates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('token=must-not-leak')));
    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
      error: 'Cloudflare Email Service could not be reached',
    });
  });

  it('reports partial permanent bounces and fails closed when every recipient bounced', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          delivered: ['one@example.net'],
          queued: [],
          permanent_bounces: ['two@example.net'],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          delivered: [],
          queued: [],
          permanent_bounces: ['one@example.net'],
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({ ...baseEmail, to: ['one@example.net', 'two@example.net'] }, env)).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageIdUnavailable: true,
      partial: true,
      permanentBounces: ['two@example.net'],
    });
    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      messageIdUnavailable: true,
      permanentFailure: true,
      permanentBounces: ['one@example.net'],
      error: 'Cloudflare Email Service permanently rejected every recipient',
    });
  });

  it('accepts an optional REST wire Message-ID without requiring it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        message_id: '<wire-message@example.com>',
        delivered: ['one@example.net'],
        queued: [],
        permanent_bounces: [],
      },
    }), { status: 200 })));
    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '<wire-message@example.com>',
      providerMessageIds: ['<wire-message@example.com>'],
      messageIdHeader: '<wire-message@example.com>',
    });
  });

  it('treats missing, duplicate, or unrelated recipient status as ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: ['one@example.net'],
        queued: ['one@example.net'],
        permanent_bounces: [],
      },
    }), { status: 200 })));
    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
      error: 'Cloudflare Email Service returned incomplete recipient status',
    });
  });

  it('distinguishes definite client rejections and throttling from ambiguous server failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail(baseEmail, env)).resolves.toMatchObject({ success: false, provider: 'cloudflare' });
    expect(await sendEmail(baseEmail, env)).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Cloudflare Email Service rejected the request (429)',
    });
    expect(await sendEmail(baseEmail, env)).toMatchObject({ success: false, provider: 'cloudflare', ambiguous: true });
  });

  it('prefers the private Worker binding and keeps its opaque provider ID separate', async () => {
    const serviceFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      messageId: '0101018f7d0c4d9a-msg-deadbeef',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);

    await expect(sendEmail({ ...baseEmail, importance: 'high' }, {
      OUTBOUND_PROVIDER: 'cloudflare',
      EMAIL_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
    })).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '0101018f7d0c4d9a-msg-deadbeef',
      providerMessageIds: ['0101018f7d0c4d9a-msg-deadbeef'],
      messageIdUnavailable: true,
    });

    expect(globalFetch).not.toHaveBeenCalled();
    expect(serviceFetch).toHaveBeenCalledOnce();
    const [url, init] = serviceFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cmail-email-worker.internal/internal/send');
    const body = JSON.parse(init.body as string);
    expect(body.headers).toMatchObject({
      Importance: 'high',
      'X-Priority': '1 (Highest)',
      'X-MSMail-Priority': 'High',
    });
  });

  it('never treats a native binding tracking ID as the wire Message-ID based on shape', async () => {
    const serviceFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      messageId: '<tracking-shaped-like-a-message-id@example.com>',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(sendEmail(baseEmail, {
      OUTBOUND_PROVIDER: 'cloudflare',
      EMAIL_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
    })).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '<tracking-shaped-like-a-message-id@example.com>',
      providerMessageIds: ['<tracking-shaped-like-a-message-id@example.com>'],
      messageIdUnavailable: true,
    });
  });

  it('uses raw MIME to keep mixed visible To/Cc separate from the external envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: ['outside@example.net'],
        queued: [],
        permanent_bounces: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({
      ...baseEmail,
      to: ['inside@example.com'],
      cc: ['outside@example.net'],
      envelopeRecipients: ['outside@example.net'],
      messageIdHeader: '<cmail-message@example.com>',
      importance: 'high',
      headers: { 'In-Reply-To': '<original@example.net>' },
    }, env)).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageIdUnavailable: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send_raw`);
    const payload = JSON.parse(init.body as string);
    expect(payload.from).toBe('sender@example.com');
    expect(payload.recipients).toEqual(['outside@example.net']);
    expect(payload.mime_message).toContain('To: <inside@example.com>');
    expect(payload.mime_message).toContain('Cc: <outside@example.net>');
    expect(payload.mime_message).not.toMatch(/^Message-ID:/im);
    expect(payload.mime_message).toContain('In-Reply-To: <original@example.net>');
    expect(payload.mime_message).toContain('Importance: high');
    expect(payload.mime_message).not.toMatch(/\r\nBcc:/i);
  });

  it('routes an all-external Bcc through the raw-MIME envelope, absent from every header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: ['one@example.net', 'hidden@example.net'],
        queued: [],
        permanent_bounces: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({
      ...baseEmail,
      to: ['one@example.net'],
      envelopeRecipients: ['one@example.net', 'hidden@example.net'],
    }, env)).resolves.toMatchObject({ success: true, provider: 'cloudflare' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send_raw`);
    const payload = JSON.parse(init.body as string);
    expect(payload.recipients).toEqual(['one@example.net', 'hidden@example.net']);
    expect(payload.mime_message).toContain('To: <one@example.net>');
    expect(payload.mime_message).not.toContain('hidden@example.net');
    expect(payload.mime_message).not.toMatch(/^Cc:/im);
    expect(payload.mime_message).not.toMatch(/\r\nBcc:/i);
  });

  it('folds raw MIME base64 and all generated lines within Internet message limits', () => {
    const raw = buildRawMimeMessage({
      ...baseEmail,
      subject: 'Quarterly π '.repeat(50),
      to: ['inside@example.com'],
      cc: ['outside@example.net'],
      envelopeRecipients: ['outside@example.net'],
      text: 'Text π '.repeat(1_000),
      html: `<p>${'Rich π '.repeat(1_000)}</p>`,
      attachments: [{
        filename: 'report";\r\nBcc: victim@example.net.bin',
        contentType: 'application/octet-stream\r\nX-Evil: yes',
        content: new Uint8Array(5_000).fill(255),
      }],
    });
    expect(raw).not.toBeNull();
    const lines = (raw || '').split('\r\n');
    const encoder = new TextEncoder();
    expect(Math.max(...lines.map((line) => encoder.encode(line).byteLength))).toBeLessThanOrEqual(998);
    const encodedLines = lines.filter((line) => /^[A-Za-z0-9+/]+={0,2}$/.test(line));
    expect(encodedLines.length).toBeGreaterThan(3);
    expect(Math.max(...encodedLines.map((line) => line.length))).toBeLessThanOrEqual(76);
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).not.toContain('X-Evil');
  });

  it('prefers one REST raw-MIME call over native fan-out when both paths exist', async () => {
    const serviceFetch = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: ['one@example.net', 'two@example.net'],
        queued: [],
        permanent_bounces: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({
      ...baseEmail,
      to: ['inside@example.com', 'one@example.net'],
      cc: ['two@example.net'],
      envelopeRecipients: ['one@example.net', 'two@example.net'],
    }, {
      OUTBOUND_PROVIDER: 'cloudflare',
      EMAIL_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_EMAIL_API_TOKEN: API_TOKEN,
    })).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageIdUnavailable: true,
    });

    expect(serviceFetch).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send_raw`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: 'sender@example.com',
      recipients: ['one@example.net', 'two@example.net'],
    });
    expect(body.mime_message).toContain('To: <inside@example.com>,');
    expect(body.mime_message).toContain('<one@example.net>');
    expect(body.mime_message).toContain('Cc: <two@example.net>');
  });
});

describe('Postmark compatibility', () => {
  const env = {
    OUTBOUND_PROVIDER: 'postmark',
    POSTMARK_API_KEY: 'postmark-api-key-for-tests',
  };

  it('keeps formatted display names for Postmark', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageID: 'postmark-message-id' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendEmail({
      ...baseEmail,
      fromName: 'Example Desk',
      importance: 'low',
      messageIdHeader: '<cmail-message@example.com>',
      headers: { 'In-Reply-To': '<original@example.net>', References: '<root@example.net> <original@example.net>' },
    }, env)).resolves.toMatchObject({ success: true, provider: 'postmark', messageIdHeader: '<cmail-message@example.com>' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.From).toBe('"Example Desk" <sender@example.com>');
    expect(body.Headers).toEqual([
      { Name: 'In-Reply-To', Value: '<original@example.net>' },
      { Name: 'References', Value: '<root@example.net> <original@example.net>' },
      { Name: 'Importance', Value: 'low' },
      { Name: 'X-Priority', Value: '5 (Lowest)' },
      { Name: 'X-MSMail-Priority', Value: 'Low' },
      { Name: 'Message-ID', Value: '<cmail-message@example.com>' },
    ]);
  });

  it('omits unsafe requested Message-IDs and all importance headers for normal mail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageID: 'postmark-message-id' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendEmail({
      ...baseEmail,
      importance: 'normal',
      messageIdHeader: '<safe@example.com>\r\nBcc: victim@example.com',
    }, env)).resolves.toEqual({
      success: true,
      provider: 'postmark',
      messageId: 'postmark-message-id',
      providerMessageIds: ['postmark-message-id'],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.Headers).toBeUndefined();
  });

  it('treats a malformed success response as ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(sendEmail(baseEmail, env)).resolves.toEqual({
      success: false,
      provider: 'postmark',
      ambiguous: true,
      error: 'Postmark returned an invalid response',
    });
  });

  it('rejects more than 50 recipients before contacting Postmark', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const email = {
      ...baseEmail,
      to: Array.from({ length: 51 }, (_, index) => `person${index}@example.net`),
    };
    expect(preflightEmail(email, env)).toMatchObject({ ok: false, provider: 'postmark', status: 400 });
    await expect(sendEmail(email, env)).resolves.toMatchObject({ success: false, provider: 'postmark' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed instead of changing mixed local/external visible headers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const email = {
      ...baseEmail,
      to: ['inside@example.com'],
      cc: ['outside@example.net'],
      envelopeRecipients: ['outside@example.net'],
    };
    expect(preflightEmail(email, env)).toMatchObject({ ok: false, provider: 'postmark', status: 400 });
    await expect(sendEmail(email, env)).resolves.toMatchObject({ success: false, provider: 'postmark' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an envelope-only Bcc to Postmark\'s native Bcc field, never a header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageID: 'postmark-message-id' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const email = {
      ...baseEmail,
      to: ['one@example.net'],
      cc: ['two@example.net'],
      envelopeRecipients: ['one@example.net', 'two@example.net', 'hidden@example.net'],
    };
    expect(preflightEmail(email, env)).toMatchObject({ ok: true, provider: 'postmark' });
    await expect(sendEmail(email, env)).resolves.toMatchObject({ success: true, provider: 'postmark' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.To).toBe('one@example.net');
    expect(body.Cc).toBe('two@example.net');
    expect(body.Bcc).toBe('hidden@example.net');
  });

  it('still fails closed for Bcc mixed with an excluded local recipient', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const email = {
      ...baseEmail,
      to: ['inside@example.com'],
      cc: ['outside@example.net'],
      envelopeRecipients: ['outside@example.net', 'hidden@example.net'],
    };
    expect(preflightEmail(email, env)).toMatchObject({ ok: false, provider: 'postmark', status: 400 });
    await expect(sendEmail(email, env)).resolves.toMatchObject({ success: false, provider: 'postmark' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Cloudflare private Worker binding Bcc', () => {
  it('maps an envelope-only Bcc to the EmailMessageBuilder\'s native bcc field', async () => {
    const serviceFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      messageId: 'binding-tracking-id',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(sendEmail({
      ...baseEmail,
      to: ['one@example.net'],
      envelopeRecipients: ['one@example.net', 'hidden@example.net'],
    }, {
      OUTBOUND_PROVIDER: 'cloudflare',
      EMAIL_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
    })).resolves.toMatchObject({ success: true, provider: 'cloudflare' });

    expect(serviceFetch).toHaveBeenCalledOnce();
    const [, init] = serviceFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['one@example.net']);
    expect(body.cc).toBeUndefined();
    expect(body.bcc).toEqual(['hidden@example.net']);
  });

  it('still fails closed on this transport for Bcc mixed with an excluded local recipient', async () => {
    const serviceFetch = vi.fn();

    await expect(sendEmail({
      ...baseEmail,
      to: ['inside@example.com'],
      cc: ['outside@example.net'],
      envelopeRecipients: ['outside@example.net', 'hidden@example.net'],
    }, {
      OUTBOUND_PROVIDER: 'cloudflare',
      EMAIL_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
    })).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Separated SMTP-envelope delivery requires the Cloudflare REST raw-MIME transport',
    });
    expect(serviceFetch).not.toHaveBeenCalled();
  });
});
