import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { User } from '@cmail/shared/types';
import { exchangeCode, fetchUserInfo, getOAuthCallbackUrl, isAuthProvider } from '$lib/server/auth';
import {
  BOOTSTRAP_PROOF_COOKIE,
  bootstrapConfiguration,
  provisionBootstrapManager,
  verifyBootstrapProof,
} from '$lib/server/bootstrap';
import {
  ENROLLMENT_COOKIE,
  bindEnrolledIdentity,
  enrollmentFailure,
  findBoundUser,
  findEnrollment,
} from '$lib/server/identity';
import { buildSessionCookie, createSessionToken } from '$lib/server/session';
import { assertStrongSessionSecret, maxSessionsPerUser, sessionTtlMs } from '$lib/server/config';
import { normalizeDomain, normalizeEmail } from '$lib/server/validation';
import { audit } from '$lib/server/db';

async function denySignIn(
  db: D1Database,
  code: string,
  provider: 'google' | 'microsoft',
  clientIp: string,
  target?: string | null,
): Promise<never> {
  await audit(db, {
    event_type: 'auth.sign_in_denied',
    actor_role: 'system',
    target: target || null,
    detail: `Denied ${provider} sign-in: ${code}`,
    ip_address: clientIp,
  });
  throw redirect(303, `/?error=${encodeURIComponent(code)}`);
}

export const GET: RequestHandler = async ({ params, url, platform, cookies, request }) => {
  if (!isAuthProvider(params.provider)) throw redirect(303, '/?error=provider_not_configured');
  const provider = params.provider;
  const env = platform?.env;
  if (!env) throw redirect(303, '/?error=configuration');
  const clientIp = (request.headers.get('cf-connecting-ip') || '').slice(0, 64);

  const stateCookie = `cmail_oauth_state_${provider}`;
  const verifierCookie = `cmail_oauth_verifier_${provider}`;
  const state = url.searchParams.get('state');
  const storedState = cookies.get(stateCookie);
  const verifier = cookies.get(verifierCookie);
  cookies.delete(stateCookie, { path: '/' });
  cookies.delete(verifierCookie, { path: '/' });

  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || !code || code.length > 4096 || !state || state !== storedState || !verifier) {
    throw redirect(303, '/?error=invalid_state');
  }

  const redirectUri = getOAuthCallbackUrl(env.APP_URL, provider);
  try {
    assertStrongSessionSecret(env.SESSION_SECRET);
  } catch {
    throw redirect(303, '/?error=configuration');
  }
  if (!redirectUri) throw redirect(303, '/?error=configuration');

  let userInfo;
  try {
    const tokens = await exchangeCode(
      provider,
      env as unknown as Record<string, string | undefined>,
      code,
      redirectUri,
      verifier,
    );
    userInfo = await fetchUserInfo(
      provider,
      env as unknown as Record<string, string | undefined>,
      tokens.access_token,
    );
  } catch (error) {
    console.error('OAuth callback failed', {
      provider,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    throw redirect(303, '/?error=oauth_failed');
  }

  // Intent capabilities are single-attempt cookies. OAuth state is checked
  // before they are read, and neither value is ever copied into a URL or log.
  const enrollmentToken = cookies.get(ENROLLMENT_COOKIE);
  const bootstrapProof = cookies.get(BOOTSTRAP_PROOF_COOKIE);
  cookies.delete(ENROLLMENT_COOKIE, { path: '/' });
  cookies.delete(BOOTSTRAP_PROOF_COOKIE, { path: '/' });

  // Returning sign-in authority is exclusively the exact provider + OIDC sub.
  // UserInfo email is intentionally not part of this lookup or decision.
  let user = await findBoundUser(env.DB, provider, userInfo.subject);

  if (user && enrollmentToken) {
    const enrollment = await findEnrollment(env.DB, enrollmentToken);
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (!enrollment || enrollment.consumed_at || enrollment.expires_at <= nowEpoch) {
      return denySignIn(env.DB, 'enrollment_expired', provider, clientIp, user.id);
    }
    if (enrollment.user_id !== user.id) {
      return denySignIn(env.DB, 'identity_conflict', provider, clientIp, enrollment.user_id);
    }
    // A valid invitation for the already-bound account is harmless but should
    // not remain reusable after this attempt.
    await env.DB.prepare(
      `UPDATE enrollment_tokens SET consumed_at = datetime('now')
       WHERE id = ? AND consumed_at IS NULL AND expires_at > unixepoch('now')`,
    ).bind(enrollment.enrollment_id).run();
  }

  if (!user && enrollmentToken) {
    const enrollment = await findEnrollment(env.DB, enrollmentToken);
    const failure = enrollmentFailure(enrollment, userInfo);
    if (failure) {
      return denySignIn(
        env.DB,
        failure === 'enrollment_required' ? 'enrollment_expired' : failure,
        provider,
        clientIp,
        enrollment?.user_id,
      );
    }

    try {
      await bindEnrolledIdentity(
        env.DB,
        enrollment!,
        provider,
        userInfo.subject,
        userInfo.name,
      );
    } catch (error) {
      console.error('Enrollment identity binding failed', {
        provider,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return denySignIn(env.DB, 'identity_conflict', provider, clientIp, enrollment!.user_id);
    }
    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(enrollment!.user_id).first<User>();
    if (!user) return denySignIn(env.DB, 'identity_conflict', provider, clientIp);
    await audit(env.DB, {
      event_type: 'auth.identity_bound',
      actor_id: user.id,
      actor_role: user.role,
      target: user.id,
      detail: `Enrolled ${provider} identity using a manager invitation`,
      ip_address: clientIp,
    });
  }

  if (!user && !enrollmentToken && bootstrapProof) {
    const configuration = bootstrapConfiguration(env as unknown as Record<string, unknown>);
    const proof = configuration
      ? await verifyBootstrapProof(bootstrapProof, configuration.sessionSecret)
      : null;
    if (!configuration || !proof || proof.email !== configuration.email) {
      return denySignIn(env.DB, 'bootstrap_invalid', provider, clientIp);
    }

    const providerEmail = normalizeEmail(userInfo.email);
    if (!userInfo.emailVerified || !providerEmail) {
      return denySignIn(env.DB, 'unverified_email', provider, clientIp);
    }
    if (providerEmail !== configuration.email) {
      return denySignIn(env.DB, 'bootstrap_invalid', provider, clientIp);
    }

    const existingManager = await env.DB.prepare("SELECT id FROM users WHERE role = 'manager' LIMIT 1")
      .first<{ id: string }>();
    if (existingManager) return denySignIn(env.DB, 'bootstrap_invalid', provider, clientIp);

    try {
      user = await provisionBootstrapManager(env.DB, {
        email: configuration.email,
        displayName: userInfo.name,
        provider,
        subject: userInfo.subject,
        mailDomain: normalizeDomain(env.MAIL_DOMAIN) || '',
      });
    } catch (error) {
      console.error('Bootstrap manager provisioning failed', {
        provider,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return denySignIn(env.DB, 'identity_conflict', provider, clientIp);
    }
    await audit(env.DB, {
      event_type: 'auth.bootstrap_completed',
      actor_id: user.id,
      actor_role: 'manager',
      target: user.id,
      detail: `Provisioned and enrolled the first manager via ${provider}`,
      ip_address: clientIp,
    });
  }

  if (!user) return denySignIn(env.DB, 'enrollment_required', provider, clientIp);
  if (user.status === 'offboarded' || user.status === 'paused') {
    return denySignIn(env.DB, 'account_suspended', provider, clientIp, user.id);
  }

  await env.DB.prepare(
    `UPDATE users
     SET last_sign_in = datetime('now'),
         display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
         status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(userInfo.name.slice(0, 200), user.id).run();

  const ttlMs = sessionTtlMs(env as unknown as Record<string, unknown>);
  const { token, hash, expiresAt, sessionId } = await createSessionToken(user.id, env.SESSION_SECRET, ttlMs);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, issued_at, expires_at, ip_address, revoked)
     VALUES (?, ?, ?, datetime('now'), ?, ?, 0)`,
  ).bind(sessionId, user.id, hash, expiresAt.toISOString(), clientIp).run();

  await env.DB.prepare(
    `UPDATE sessions SET revoked = 1
     WHERE user_id = ? AND revoked = 0 AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY issued_at DESC, id DESC LIMIT ?
     )`,
  ).bind(user.id, user.id, maxSessionsPerUser(env as unknown as Record<string, unknown>)).run();

  await audit(env.DB, {
    event_type: 'auth.sign_in',
    actor_id: user.id,
    actor_role: user.role,
    detail: `Signed in via ${provider}`,
    ip_address: clientIp,
    session_id: sessionId,
  });

  const latestPolicy = await env.DB.prepare(
    'SELECT id FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1',
  ).first<{ id: string }>();
  let location = '/mail';
  if (latestPolicy) {
    const signature = await env.DB.prepare(
      'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
    ).bind(user.id, latestPolicy.id).first<{ id: string }>();
    if (!signature) location = '/policy';
  }

  return new Response(null, {
    status: 303,
    headers: {
      'Set-Cookie': buildSessionCookie(token, ttlMs / 1000, url.protocol === 'https:'),
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
};
