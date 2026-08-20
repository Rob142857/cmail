import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getOAuthCallbackUrl, getProviderConfig, isAuthProvider } from '$lib/server/auth';
import { BOOTSTRAP_PROOF_COOKIE } from '$lib/server/bootstrap';
import { emailOtpEnabled } from '$lib/server/config';
import {
  ENROLLMENT_COOKIE,
  ENROLLMENT_COOKIE_TTL_SECONDS,
  findEnrollment,
  validEnrollmentToken,
} from '$lib/server/identity';
import { consumeRateLimit } from '$lib/server/rate-limit';

type EnrollProvider = 'google' | 'microsoft' | 'email';

// 'email' is accepted here — and only here — alongside the two OAuth
// providers: this route's whole job is moving a token into a cookie before
// the next hop, and for an email-OTP invitee that next hop is /auth/email
// rather than an identity provider's consent screen.
function providerReady(provider: string, env: App.Platform['env'] | undefined): provider is EnrollProvider {
  if (!env) return false;
  if (provider === 'email') return emailOtpEnabled(env as unknown as Record<string, unknown>);
  if (!isAuthProvider(provider)) return false;
  const authEnv = env as unknown as Record<string, string | undefined>;
  return !!getProviderConfig(provider, authEnv) && !!getOAuthCallbackUrl(env.APP_URL, provider);
}

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    // Origin-only referrer keeps the invitation token out of outbound Referer
    // headers while still letting the browser send a real Origin on the POST.
    'Referrer-Policy': 'strict-origin',
  });
  if (!providerReady(params.provider, platform?.env)) {
    throw redirect(303, '/?error=provider_not_configured');
  }
  return { provider: params.provider };
};

export const actions: Actions = {
  default: async ({ params, platform, request, cookies, url }) => {
    const env = platform?.env;
    if (!env || !providerReady(params.provider, env)) {
      return fail(400, { error: 'Sign-in provider not available.' });
    }

    const clientIp = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const rate = await consumeRateLimit(
      env.DB,
      'enrollment_prepare',
      `${params.provider}:${clientIp.slice(0, 64)}`,
      20,
      600,
    );
    if (!rate.allowed) {
      return fail(429, { error: 'Too many attempts. Wait a few minutes, then try again.' });
    }

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 4096) return fail(413, { error: 'Invitation not valid.' });
    const data = await request.formData();
    const token = data.get('token');
    if (!validEnrollmentToken(token)) {
      return fail(400, { error: 'Invitation link is incomplete or no longer valid.' });
    }

    const enrollment = await findEnrollment(env.DB, token);
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (
      !enrollment || enrollment.consumed_at || enrollment.expires_at <= nowEpoch ||
      enrollment.bound_provider || enrollment.status === 'paused' || enrollment.status === 'offboarded'
    ) {
      return fail(400, {
        error: 'Invitation expired or replaced. Ask a manager to resend it.',
      });
    }

    cookies.delete(BOOTSTRAP_PROOF_COOKIE, { path: '/' });
    cookies.set(ENROLLMENT_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: ENROLLMENT_COOKIE_TTL_SECONDS,
    });
    throw redirect(303, params.provider === 'email' ? '/auth/email?enroll=1' : `/auth/login/${params.provider}`);
  },
};
