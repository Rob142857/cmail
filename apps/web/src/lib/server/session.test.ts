import { describe, expect, it } from 'vitest';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getSessionTokenFromCookie,
  hashToken,
  shouldRenewSession,
  verifySessionToken,
} from './session';

const SECRET = '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749';
const ENCODER = new TextEncoder();

async function signPayload(payload: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('session tokens', () => {
  it('round-trips an authenticated session and its stored hash', async () => {
    const session = await createSessionToken('user-123', SECRET, 60_000);
    const verified = await verifySessionToken(session.token, SECRET);

    expect(verified?.sessionId).toBe(session.sessionId);
    expect(verified?.userId).toBe('user-123');
    expect(await hashToken(session.token)).toBe(session.hash);
  });

  it('carries no embedded expiry: a token minted with a negative or tiny duration still verifies', async () => {
    // durationMs only shapes the returned expiresAt (used to seed the DB
    // row) — the token itself has no expiry, so the DB row is the only
    // authority and verification succeeds regardless of durationMs.
    const longExpired = await createSessionToken('user-123', SECRET, -1_000_000_000);
    const verified = await verifySessionToken(longExpired.token, SECRET);

    expect(verified?.sessionId).toBe(longExpired.sessionId);
    expect(longExpired.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it('rejects tampered, malformed, or wrongly signed tokens', async () => {
    const session = await createSessionToken('user-123', SECRET, 60_000);
    const replacement = session.token.endsWith('a') ? 'b' : 'a';
    const tampered = `${session.token.slice(0, -1)}${replacement}`;

    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
    expect(await verifySessionToken(session.token, `${SECRET}x`)).toBeNull();
    expect(await verifySessionToken('not-a-token', SECRET)).toBeNull();
    expect(await verifySessionToken('', SECRET)).toBeNull();
  });

  it('rejects a token whose issuedAt is older than the 400-day sanity cutoff', async () => {
    const staleIssuedAt = Date.now() - (401 * 24 * 60 * 60 * 1000);
    const payload = `session-1.user-123.${staleIssuedAt}`;
    const staleToken = `${payload}.${await signPayload(payload)}`;

    expect(await verifySessionToken(staleToken, SECRET)).toBeNull();
  });

  it('accepts a token issued just inside the 400-day sanity cutoff', async () => {
    const recentIssuedAt = Date.now() - (399 * 24 * 60 * 60 * 1000);
    const payload = `session-1.user-123.${recentIssuedAt}`;
    const freshEnoughToken = `${payload}.${await signPayload(payload)}`;

    const verified = await verifySessionToken(freshEnoughToken, SECRET);
    expect(verified?.sessionId).toBe('session-1');
  });
});

describe('shouldRenewSession', () => {
  const ttlMs = 8 * 60 * 60 * 1000; // matches the default SESSION_TTL_HOURS

  it('does not renew a session that still has a full TTL of life left', () => {
    const now = Date.now();
    expect(shouldRenewSession(now + ttlMs, now, ttlMs)).toBe(false);
  });

  it('renews once remaining lifetime drops within the 6-hour threshold', () => {
    const now = Date.now();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    expect(shouldRenewSession(now + (ttlMs - sixHoursMs) - 1, now, ttlMs)).toBe(true);
    expect(shouldRenewSession(now + (ttlMs - sixHoursMs) + 1, now, ttlMs)).toBe(false);
  });

  it('treats non-finite input as "do not renew" instead of throwing', () => {
    expect(shouldRenewSession(Number.NaN, Date.now(), ttlMs)).toBe(false);
    expect(shouldRenewSession(Date.now(), Number.NaN, ttlMs)).toBe(false);
    expect(shouldRenewSession(Date.now(), Date.now(), Number.NaN)).toBe(false);
  });
});

describe('session cookies', () => {
  it('uses secure browser protections and a fixed 400-day Max-Age in production', () => {
    const cookie = buildSessionCookie('token-value', true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Priority=High');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=34560000');
    expect(getSessionTokenFromCookie(`theme=dark; ${cookie}`)).toBe('token-value');
  });

  it('supports local HTTP and clears the same cookie safely', () => {
    expect(buildSessionCookie('token-value', false)).not.toContain('Secure');
    expect(buildSessionCookie('token-value', false)).toContain('Max-Age=34560000');
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
    expect(getSessionTokenFromCookie(null)).toBeNull();
  });
});
