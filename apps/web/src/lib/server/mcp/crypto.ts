// Small Web Crypto helpers for the MCP authorization server. Tokens are
// opaque random values; only their SHA-256 digests are ever stored.
const ENCODER = new TextEncoder();

export type TokenPrefix = 'cmat_' | 'cmrt_' | 'cmac_' | 'cmcs_' | 'cmar_';

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 bits of randomness, base64url-encoded, with a type prefix. */
export function randomToken(prefix: TokenPrefix): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64Url(bytes)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(value));
  return base64Url(new Uint8Array(digest));
}

/** Constant-time comparison for equal-length ASCII strings. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** RFC 7636: a verifier is 43-128 characters of [A-Z a-z 0-9 - . _ ~]. */
export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

/** An S256 challenge is the 43-character base64url encoding of a SHA-256 digest. */
export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(value);
}

export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  return timingSafeEqual(await sha256Base64Url(verifier), challenge);
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}
