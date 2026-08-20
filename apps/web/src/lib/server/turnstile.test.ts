import { describe, expect, it, vi } from 'vitest';
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from './turnstile';

const CONFIGURED = { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key' };

describe('turnstile configuration', () => {
  it('is enabled only when both the site key and secret key are present', () => {
    expect(turnstileEnabled({})).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SITE_KEY: 'site-key' })).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SECRET_KEY: 'secret-key' })).toBe(false);
    expect(turnstileEnabled(CONFIGURED)).toBe(true);
  });

  it('exposes only the public site key, trimmed', () => {
    expect(turnstileSiteKey({ TURNSTILE_SITE_KEY: '  site-key  ' })).toBe('site-key');
    expect(turnstileSiteKey({})).toBe('');
  });
});

describe('verifyTurnstile', () => {
  it('posts the token and remote IP, and accepts a success:true response', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    await expect(verifyTurnstile(CONFIGURED, 'token-value', '192.0.2.10', fetcher)).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe('token-value');
    expect(body.get('remoteip')).toBe('192.0.2.10');
  });

  it('rejects a success:false response', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    await expect(verifyTurnstile(CONFIGURED, 'token-value', '192.0.2.10', fetcher)).resolves.toBe(false);
  });

  it('fails closed on a non-OK HTTP status, a thrown network error, or a timeout', async () => {
    const notOk = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(verifyTurnstile(CONFIGURED, 'token-value', '192.0.2.10', notOk)).resolves.toBe(false);

    const throws = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(verifyTurnstile(CONFIGURED, 'token-value', '192.0.2.10', throws)).resolves.toBe(false);

    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const timesOut = vi.fn().mockRejectedValue(abortError);
    await expect(verifyTurnstile(CONFIGURED, 'token-value', '192.0.2.10', timesOut)).resolves.toBe(false);
  });

  it('refuses without calling the network when not configured or the token is missing', async () => {
    const fetcher = vi.fn();
    await expect(verifyTurnstile({}, 'token-value', '192.0.2.10', fetcher)).resolves.toBe(false);
    await expect(verifyTurnstile(CONFIGURED, '', '192.0.2.10', fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('omits remoteip when no client IP is available', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    await verifyTurnstile(CONFIGURED, 'token-value', '', fetcher);
    const body = new URLSearchParams(fetcher.mock.calls[0][1].body as string);
    expect(body.has('remoteip')).toBe(false);
  });
});
