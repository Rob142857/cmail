// Redirect URI policy for MCP OAuth clients.
//
// - https URIs: exact string match only.
// - http URIs: only on a loopback host (127.0.0.1, [::1], localhost). Native
//   apps pick a free port at runtime, so RFC 8252 section 7.3 lets the port
//   vary; scheme, host, path and query must still match exactly.
// - Private-use URI schemes (RFC 8252 section 7.1) for native apps, exact
//   match, minus schemes that a browser would execute or that make no sense
//   as an OAuth callback.
// - Never a fragment, never userinfo.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const DENIED_SCHEMES = new Set([
  'javascript', 'data', 'file', 'vbscript', 'blob', 'about', 'ftp', 'ws', 'wss', 'mailto', 'tel', 'sms', 'chrome', 'view-source',
]);
export const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;

export type RedirectUriKind = 'https' | 'loopback' | 'private-use';

export function classifyRedirectUri(value: unknown): RedirectUriKind | null {
  if (typeof value !== 'string' || !value || value.length > MAX_REDIRECT_URI_LENGTH) return null;
  if (/[\u0000- \u007f]/.test(value) || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return url.hostname ? 'https' : null;
  if (scheme === 'http') return LOOPBACK_HOSTS.has(url.hostname) ? 'loopback' : null;
  if (DENIED_SCHEMES.has(scheme)) return null;
  if (!/^[a-z][a-z0-9+.-]{1,62}$/.test(scheme)) return null;
  return 'private-use';
}

function loopbackKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Does the redirect_uri in an authorization request match one the client registered? */
export function redirectUriMatches(requested: unknown, registered: readonly string[]): requested is string {
  if (typeof requested !== 'string') return false;
  const kind = classifyRedirectUri(requested);
  if (!kind) return false;
  if (registered.includes(requested)) return true;
  if (kind !== 'loopback') return false;
  const requestedKey = loopbackKey(requested);
  return !!requestedKey && registered.some((uri) => loopbackKey(uri) === requestedKey);
}

/** Validate a client's registered redirect URI list. Returns null when any entry is unacceptable. */
export function validateRedirectUriList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REDIRECT_URIS) return null;
  const uris: string[] = [];
  for (const entry of value) {
    if (!classifyRedirectUri(entry)) return null;
    if (!uris.includes(entry as string)) uris.push(entry as string);
  }
  return uris;
}

/**
 * True when every registered redirect URI is a loopback address. Any program on
 * the user's computer can listen there, so the app's identity can't be checked.
 */
export function redirectsOnlyToLoopback(registered: readonly string[]): boolean {
  return registered.length > 0 && registered.every((uri) => classifyRedirectUri(uri) === 'loopback');
}

/** Short, human-readable destination shown on the consent screen. */
export function redirectDisplay(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.host;
    if (url.protocol === 'http:') return 'an app on this computer (localhost)';
    return `the app registered for ${url.protocol}`;
  } catch {
    return 'an unknown address';
  }
}

/** Build the client redirect with OAuth response parameters (RFC 6749 4.1.2 / RFC 9207). */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
}
