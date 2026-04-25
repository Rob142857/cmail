import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthProvider } from '@cmail/shared/types';
import { buildAuthorizationUrl, getProviderConfig } from '$lib/server/auth';

export const GET: RequestHandler = async ({ params, platform, url }) => {
  const provider = params.provider as AuthProvider;
  const env = platform?.env;
  if (!env) throw redirect(302, '/?error=no_platform');

  const config = getProviderConfig(provider, env as unknown as Record<string, string | undefined>);
  if (!config) throw redirect(302, '/?error=provider_not_configured');

  // Generate state for CSRF protection
  const state = crypto.randomUUID();

  const redirectUri = `${env.APP_URL}/auth/callback/${provider}`;
  const authUrl = buildAuthorizationUrl(
    provider,
    env as unknown as Record<string, string | undefined>,
    redirectUri,
    state,
  );

  // Store state in a short-lived cookie for verification
  const headers = new Headers();
  headers.set('Set-Cookie', `cmail_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);
  headers.set('Location', authUrl);

  return new Response(null, { status: 302, headers });
};
