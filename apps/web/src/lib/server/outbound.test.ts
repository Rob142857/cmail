import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectProvider,
  getProviderInfo,
  preflightEmail,
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
        message_id: '<provider-message@example.com>',
        delivered: ['one@example.net'],
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
      messageId: '<provider-message@example.com>',
      messageIdHeader: '<provider-message@example.com>',
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

  it('does not expose response bodies or accept malformed provider Message-IDs', async () => {
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
      headers: { 'In-Reply-To': '<original@example.net>', References: '<root@example.net> <original@example.net>' },
    }, env)).resolves.toMatchObject({ success: true, provider: 'postmark' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.From).toBe('"Example Desk" <sender@example.com>');
    expect(body.Headers).toEqual([
      { Name: 'In-Reply-To', Value: '<original@example.net>' },
      { Name: 'References', Value: '<root@example.net> <original@example.net>' },
    ]);
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
});
