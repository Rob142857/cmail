// Returning a signed-out user to a pending MCP authorization after sign-in.
//
// /oauth/authorize stores the pending request in D1 and its random id in this
// short-lived HttpOnly cookie. The sign-in completions (Google/Microsoft
// callback, email code, policy acceptance) call mcpResumeLocation(): when the
// cookie holds a well-formed request id they go to one fixed same-origin path
// instead of /mail. No caller-supplied URL is ever used for this redirect.
import { isAuthRequestId } from './oauth';
import { AUTH_REQUEST_TTL_SECONDS } from './config';

export const MCP_AUTHORIZE_COOKIE = 'cmail_mcp_authorize';
export const MCP_RESUME_PATH = '/oauth/authorize?resume=1';

export function mcpAuthorizeCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: AUTH_REQUEST_TTL_SECONDS,
  };
}

export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

/** Where a completed sign-in should land: the pending MCP consent, or the usual default. */
export function mcpResumeLocation(cookieValue: string | null | undefined, defaultLocation: string): string {
  if (defaultLocation !== '/mail') return defaultLocation;
  return isAuthRequestId(cookieValue) ? MCP_RESUME_PATH : defaultLocation;
}
