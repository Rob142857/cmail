// Session management: JWT-like tokens stored in D1
// Uses Web Crypto for HMAC-SHA256 signing (available in Workers)

const DEFAULT_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const ENCODER = new TextEncoder();
const SESSION_COOKIE = 'cmail_session';

export async function createSessionToken(
  userId: string,
  secret: string,
  durationMs = DEFAULT_SESSION_DURATION_MS,
): Promise<{ token: string; hash: string; expiresAt: Date; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + durationMs);
  const payload = `${sessionId}.${userId}.${expiresAt.getTime()}`;

  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const token = `${payload}.${sigHex}`;

  // Hash for DB storage (don't store the raw token)
  const hashBuf = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  return { token, hash, expiresAt, sessionId };
}

export async function verifySessionToken(token: string, secret: string): Promise<{ sessionId: string; userId: string; expiresAt: Date } | null> {
  if (!token || token.length > 1024 || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [sessionId, userId, expiresStr, sigHex] = parts;
  if (!sessionId || !userId || !/^\d{10,16}$/.test(expiresStr) || !/^[\da-f]{64}$/i.test(sigHex)) return null;
  const expiresAt = new Date(Number(expiresStr));

  if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return null;

  const payload = `${sessionId}.${userId}.${expiresStr}`;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      ENCODER.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const pairs = sigHex.match(/.{2}/g);
    if (!pairs) return null;
    const sigBytes = new Uint8Array(pairs.map((hex) => Number.parseInt(hex, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(payload));
    if (!valid) return null;
  } catch {
    return null;
  }

  return { sessionId, userId, expiresAt };
}

export async function hashToken(token: string): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function buildSessionCookie(token: string, maxAgeSeconds: number, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`,
    'Priority=High',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=0`;
}

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}
