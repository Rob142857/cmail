// Optional Cloudflare Turnstile check on the email-OTP request form.
// Enabled only when both TURNSTILE_SITE_KEY (public) and
// TURNSTILE_SECRET_KEY (Pages secret) are configured — see
// docs/configuration.md. These exact variable names are already configured
// on every production tenant of this application.

function envString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function turnstileSiteKey(env: Record<string, unknown>): string {
  return envString(env, 'TURNSTILE_SITE_KEY');
}

export function turnstileEnabled(env: Record<string, unknown>): boolean {
  return !!turnstileSiteKey(env) && !!envString(env, 'TURNSTILE_SECRET_KEY');
}

interface TurnstileSiteverifyResponse {
  success: boolean;
}

/**
 * Verifies a Turnstile response token against Cloudflare's siteverify
 * endpoint. Any failure at all — missing/expired/reused token, network
 * error, timeout, malformed response — returns false; callers must treat
 * that identically to "no token provided" (fail closed, generic refusal).
 * `fetcher` is injectable so tests can stub the network call.
 */
export async function verifyTurnstile(
  env: Record<string, unknown>,
  token: string,
  remoteIp: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  const secret = envString(env, 'TURNSTILE_SECRET_KEY');
  if (!secret || typeof token !== 'string' || !token || token.length > 2048) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  };
  try {
    init.signal = AbortSignal.timeout(8000);
  } catch {
    // Runtime lacks AbortSignal.timeout — proceed without a client-side timeout.
  }

  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', init);
    if (!response.ok) return false;
    const result = await response.json() as TurnstileSiteverifyResponse;
    return result.success === true;
  } catch {
    return false;
  }
}
