import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail, type OutboundEmail } from './outbound';

// Failure mapping for each outbound transport. The caller (the compose action
// and the journal) relies on exactly one distinction: a definite rejection can
// be retried or edited, an ambiguous result must never be resent blindly.

const email: OutboundEmail = {
  from: 'sender@example.com',
  to: ['one@example.net'],
  subject: 'Failure mapping',
  html: '<p>Hello</p>',
  text: 'Hello',
};

const POSTMARK_KEY = 'postmark-api-key-for-tests';
const postmarkEnv = { OUTBOUND_PROVIDER: 'postmark', POSTMARK_API_KEY: POSTMARK_KEY };
const restEnv = {
  OUTBOUND_PROVIDER: 'cloudflare',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_EMAIL_API_TOKEN: 'cloudflare-email-api-token-for-tests',
};

function serviceEnv(fetchImpl: ReturnType<typeof vi.fn>) {
  return { OUTBOUND_PROVIDER: 'cloudflare', EMAIL_SERVICE: { fetch: fetchImpl } as unknown as Fetcher };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Postmark failure mapping', () => {
  it.each([400, 401, 422, 429])('treats HTTP %i as a definite rejection that is safe to retry', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"Message":"detail"}', { status })));
    const result = await sendEmail(email, postmarkEnv);
    expect(result).toEqual({
      success: false,
      provider: 'postmark',
      error: `Postmark rejected the request (${status})`,
    });
    expect(result.ambiguous).toBeUndefined();
  });

  it.each([500, 502, 503])('treats HTTP %i as ambiguous so the message is not resent blindly', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream detail', { status })));
    const result = await sendEmail(email, postmarkEnv);
    expect(result).toEqual({
      success: false,
      provider: 'postmark',
      ambiguous: true,
      error: `Postmark rejected the request (${status})`,
    });
  });

  it('treats a network failure as ambiguous and never echoes the thrown message or token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`socket reset ${POSTMARK_KEY}`)));
    const result = await sendEmail(email, postmarkEnv);
    expect(result).toEqual({
      success: false,
      provider: 'postmark',
      ambiguous: true,
      error: 'Postmark could not be reached',
    });
    expect(JSON.stringify(result)).not.toContain(POSTMARK_KEY);
  });

  it('treats a 200 response whose body is not JSON as ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 })));
    await expect(sendEmail(email, postmarkEnv)).resolves.toMatchObject({
      success: false,
      provider: 'postmark',
      ambiguous: true,
    });
  });

  it('does not put provider response text into the error shown to the sender', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"Message":"secret-detail"}', { status: 422 })));
    const result = await sendEmail(email, postmarkEnv);
    expect(JSON.stringify(result)).not.toContain('secret-detail');
  });
});

describe('Cloudflare private Worker binding failure mapping', () => {
  it.each([400, 403, 429])('treats HTTP %i as a definite rejection', async (status) => {
    const service = vi.fn().mockResolvedValue(new Response('{}', { status }));
    const result = await sendEmail(email, serviceEnv(service));
    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      error: `Cloudflare Email Service rejected the request (${status})`,
    });
  });

  it('marks a suppressed recipient so the sender can be told why', async () => {
    const service = vi.fn().mockResolvedValue(Response.json({ success: false, code: 'E_RECIPIENT_SUPPRESSED' }, { status: 422 }));
    await expect(sendEmail(email, serviceEnv(service))).resolves.toEqual({
      success: false,
      provider: 'cloudflare',
      suppressed: true,
      error: 'Cloudflare Email Service refused a recipient on its suppression list',
    });
  });

  it.each([500, 503])('treats HTTP %i as ambiguous', async (status) => {
    const service = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(sendEmail(email, serviceEnv(service))).resolves.toMatchObject({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
    });
  });

  it('treats a thrown binding call as ambiguous without leaking the cause', async () => {
    const service = vi.fn().mockRejectedValue(new Error('internal routing detail'));
    const result = await sendEmail(email, serviceEnv(service));
    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
      error: 'Cloudflare Email Service could not be reached',
    });
  });

  it('treats success:false, a missing id or a non-JSON body from the binding as ambiguous', async () => {
    const bodies = [
      new Response(JSON.stringify({ success: false }), { status: 200 }),
      new Response(JSON.stringify({ success: true }), { status: 200 }),
      new Response('not json', { status: 200 }),
    ];
    for (const response of bodies) {
      const service = vi.fn().mockResolvedValue(response);
      await expect(sendEmail(email, serviceEnv(service))).resolves.toMatchObject({
        success: false,
        provider: 'cloudflare',
        ambiguous: true,
      });
    }
  });

  it('does not fall back to the public REST API when the binding fails', async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const service = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await sendEmail(email, serviceEnv(service));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(service).toHaveBeenCalledOnce();
  });
});

describe('Cloudflare REST failure mapping', () => {
  it('treats an authentication failure as definite and hides the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"errors":[{"message":"token-detail"}]}', { status: 401 })));
    const result = await sendEmail(email, restEnv);
    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Cloudflare Email Service rejected the request (401)',
    });
    expect(JSON.stringify(result)).not.toContain('token-detail');
  });

  it('treats a 200 response with a non-JSON body as ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>edge error</html>', { status: 200 })));
    await expect(sendEmail(email, restEnv)).resolves.toMatchObject({
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
    });
  });
});

describe('no provider configured', () => {
  it('fails with a clear, non-ambiguous error and makes no network call', async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    await expect(sendEmail(email, { OUTBOUND_PROVIDER: 'none' })).resolves.toEqual({
      success: false,
      provider: 'none',
      error: 'No outbound provider configured',
    });
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
