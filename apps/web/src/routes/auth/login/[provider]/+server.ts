import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorizationUrl, createPkcePair, getOAuthCallbackUrl, getProviderConfig, isAuthProvider } from '$lib/server/auth';
import { assertStrongSessionSecret } from '$lib/server/config';
import { consumeRateLimit } from '$lib/server/rate-limit';

export const GET: RequestHandler = async ({ params, platform, url, cookies, request }) => {
  if (!isAuthProvider(params.provider)) throw redirect(303, '/?error=provider_not_configured');
  const provider = params.provider;
  const env = platform?.env;
  if (!env) throw redirect(303, '/?error=configuration');

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
    headers: { Location: authUrl, 'Cache-Control': 'no-store' },
  });
};
