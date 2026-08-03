import { describe, expect, it } from 'vitest';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getSessionTokenFromCookie,
  hashToken,
  verifySessionToken,
} from './session';

const SECRET = '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749';

describe('session tokens', () => {
  it('round-trips an authenticated session and its stored hash', async () => {
    const session = await createSessionToken('user-123', SECRET, 60_000);
    const verified = await verifySessionToken(session.token, SECRET);

    expect(verified?.sessionId).toBe(session.sessionId);
    expect(verified?.userId).toBe('user-123');
    expect(await hashToken(session.token)).toBe(session.hash);
  });

  it('rejects tampered, malformed, expired, or wrongly signed tokens', async () => {
    const session = await createSessionToken('user-123', SECRET, 60_000);
    const replacement = session.token.endsWith('a') ? 'b' : 'a';
    const tampered = `${session.token.slice(0, -1)}${replacement}`;
    const expired = await createSessionToken('user-123', SECRET, -1);

    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
    expect(await verifySessionToken(session.token, `${SECRET}x`)).toBeNull();
    expect(await verifySessionToken(expired.token, SECRET)).toBeNull();
    expect(await verifySessionToken('not-a-token', SECRET)).toBeNull();
  });
});

describe('session cookies', () => {
  it('uses secure browser protections in production', () => {
    const cookie = buildSessionCookie('token-value', 3600, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Priority=High');
    expect(cookie).toContain('Secure');
    expect(getSessionTokenFromCookie(`theme=dark; ${cookie}`)).toBe('token-value');
  });

  it('supports local HTTP and clears the same cookie safely', () => {
    expect(buildSessionCookie('token-value', 0, false)).not.toContain('Secure');
    expect(buildSessionCookie('token-value', 0, false)).toContain('Max-Age=1');
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
    expect(getSessionTokenFromCookie(null)).toBeNull();
  });
});
