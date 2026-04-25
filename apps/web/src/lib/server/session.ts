// Session management: JWT-like tokens stored in D1
// Uses Web Crypto for HMAC-SHA256 signing (available in Workers)

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour access token
const ENCODER = new TextEncoder();

export async function createSessionToken(userId: string, secret: string): Promise<{ token: string; hash: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
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

  return { token, hash, expiresAt };
}

export async function verifySessionToken(token: string, secret: string): Promise<{ sessionId: string; userId: string; expiresAt: Date } | null> {
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [sessionId, userId, expiresStr, sigHex] = parts;
  const expiresAt = new Date(Number(expiresStr));

  if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return null;

  const payload = `${sessionId}.${userId}.${expiresStr}`;
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(payload));

  if (!valid) return null;
  return { sessionId, userId, expiresAt };
}

export async function hashToken(token: string): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function buildSessionCookie(token: string, domain: string, secure: boolean = true): string {
  const parts = [
    `cmail_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_DURATION_MS / 1000}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return 'cmail_session=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0';
}

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/cmail_session=([^;]+)/);
  return match ? match[1] : null;
}
