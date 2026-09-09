import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorizationUrl, createPkcePair, getOAuthCallbackUrl, getProviderConfig, isAuthProvider } from '$lib/server/auth';
import { assertStrongSessionSecret } from '$lib/server/config';
import { consumeRateLimit } from '$lib/server/rate-limit';
import { BOOTSTRAP_PROOF_COOKIE } from '$lib/server/bootstrap';
import { ENROLLMENT_COOKIE } from '$lib/server/identity';

export const GET: RequestHandler = async ({ params, platform, url, cookies, request, locals }) => {
  if (!isAuthProvider(params.provider)) throw redirect(303, '/?error=provider_not_configured');
  const provider = params.provider;
  const env = platform?.env;
  if (!env) throw redirect(303, '/?error=configuration');

  // This is a presentation preference, never an assertion of staff identity.
  // Enrollment/bootstrap must still ask which account receives that binding.
  const reuseProviderSession = url.searchParams.get('sso') === '1'
    && !cookies.get(ENROLLMENT_COOKIE)
    && !cookies.get(BOOTSTRAP_PROOF_COOKIE);
  if (reuseProviderSession && locals.user) {
    // The hook has validated the cmail session; /mail enforces policy and
    // mailbox assignments. No provider or Access header authenticates here.
    return new Response(null, {
      status: 303,
      headers: { Location: '/mail', 'Cache-Control': 'no-store', Vary: 'Cookie' },
    });
  }

  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit(env.DB, 'oauth_start', `${provider}:${clientIp.slice(0, 64)}`, 30, 600);
  if (!rate.allowed) {
    throw redirect(303, `/?error=rate_limited&retry=${Math.max(1, Math.ceil(rate.retryAfter / 60))}`);
  }

  try {
    assertStrongSessionSecret(env.SESSION_SECRET);
  } catch {
    throw redirect(303, '/?error=configuration');
  }

  const config = getProviderConfig(provider, env as unknown as Record<string, string | undefined>);
  const redirectUri = getOAuthCallbackUrl(env.APP_URL, provider);
  if (!config || !redirectUri) throw redirect(303, '/?error=provider_not_configured');

  const state = crypto.randomUUID();
  const pkce = await createPkcePair();
  const authUrl = buildAuthorizationUrl(
    provider,
    env as unknown as Record<string, string | undefined>,
    redirectUri,
    state,
    pkce.challenge,
    reuseProviderSession ? 'existing' : 'choose',
  );

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: url.protocol === 'https:',
    maxAge: 600,
  };
  cookies.set(`cmail_oauth_state_${provider}`, state, cookieOptions);
  cookies.set(`cmail_oauth_verifier_${provider}`, pkce.verifier, cookieOptions);

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl, 'Cache-Control': 'no-store', Vary: 'Cookie' },
  });
};
