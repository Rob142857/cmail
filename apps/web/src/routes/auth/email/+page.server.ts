// Invitation-scoped email one-time-code (OTP) sign-in — a third sign-in
// method for people whose mail is hosted by neither Google nor Microsoft.
// Never self-serve: a code is only ever issued to an address a manager
// invited (purpose 'enroll', reached via /enroll/email) or one already
// enrolled this way (purpose 'signin', reached from the landing page).
//
// Both actions answer identically no matter what happened internally —
// see NEUTRAL_REQUEST_MESSAGE/NEUTRAL_VERIFY_MESSAGE below — so a caller
// can never learn whether an address exists, is enrolled, was refused by
// geography, or ran out of attempts. The real reason is always audited.
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { User } from '@cmail/shared/types';
import {
  assertStrongSessionSecret,
  emailOtpEnabled,
  maxSessionsPerUser,
  otpSessionTtlMs,
} from '$lib/server/config';
import { audit } from '$lib/server/db';
import { detectEmailProvider } from '$lib/server/email-provider';
import {
  createOtpProof,
  generateOtpEmail,
  issueOtp,
  OTP_PROOF_COOKIE,
  OTP_PROOF_TTL_SECONDS,
  verifyOtp,
  verifyOtpProof,
  type OtpPurpose,
} from '$lib/server/email-otp';
import {
  ENROLLMENT_COOKIE,
  bindEnrolledIdentity,
  findBoundUser,
  findEnrollment,
  type EnrollmentRecord,
} from '$lib/server/identity';
import { loadOrgSettings } from '$lib/server/org-settings';
import { detectProvider, sendEmail } from '$lib/server/outbound';
import { consumeRateLimit } from '$lib/server/rate-limit';
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SECONDS, createSessionToken } from '$lib/server/session';
import {
  COUNTRY_PENDING_MESSAGE,
  countryAllowed,
  recordTravelRequest,
  requestCountry,
  signInCountryGate,
} from '$lib/server/travel';
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from '$lib/server/turnstile';
import { normalizeEmail } from '$lib/server/validation';

const NEUTRAL_REQUEST_MESSAGE = 'If this address is registered for email sign-in, a code is on its way.';
const NEUTRAL_VERIFY_MESSAGE = "That code didn't work or has expired.";

function clientIpOf(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  ).slice(0, 64);
}

async function resolveSigninEligibility(db: D1Database, address: string): Promise<User | null> {
  const user = await findBoundUser(db, 'email', address);
  return user && user.status === 'active' ? user : null;
}

/**
 * An enrollment is only a valid basis for an OTP request when it's live,
 * unbound, addressed to exactly this address, and — re-checked live rather
 * than trusted from invite time — still not actually Google/Microsoft
 * hosted, so a stray /enroll/email link built for a different invitee can
 * never be redeemed through this route.
 */
async function resolveEnrollEligibility(
  db: D1Database,
  address: string,
  token: string | undefined,
): Promise<EnrollmentRecord | null> {
  if (!token) return null;
  const enrollment = await findEnrollment(db, token);
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (
    !enrollment || enrollment.consumed_at || enrollment.expires_at <= nowEpoch ||
    enrollment.bound_provider || enrollment.status === 'paused' || enrollment.status === 'offboarded'
  ) return null;
  if (normalizeEmail(enrollment.email) !== address) return null;
  const detection = await detectEmailProvider(enrollment.email);
  if (detection !== 'unknown') return null;
  return enrollment;
}

export const load: PageServerLoad = async ({ url, platform, cookies, setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    // Keeps the enrollment cookie's token-bearing origin out of the Referer
    // header on this page's own POSTs — same reasoning as /enroll/[provider].
    'Referrer-Policy': 'strict-origin',
  });
  const env = platform?.env;
  if (!env || !emailOtpEnabled(env as unknown as Record<string, unknown>)) {
    throw redirect(303, '/?error=provider_not_configured');
  }

  const enroll = url.searchParams.get('enroll') === '1';
  let enrollAddress = '';
  if (enroll) {
    const token = cookies.get(ENROLLMENT_COOKIE);
    if (token) {
      const enrollment = await findEnrollment(env.DB, token);
      const nowEpoch = Math.floor(Date.now() / 1000);
      if (enrollment && !enrollment.consumed_at && enrollment.expires_at > nowEpoch && !enrollment.bound_provider) {
        enrollAddress = enrollment.email;
      }
    }
  }

  const envRecord = env as unknown as Record<string, unknown>;
  return {
    enroll,
    enrollAddress,
    turnstileSiteKey: turnstileSiteKey(envRecord),
    turnstileEnabled: turnstileEnabled(envRecord),
  };
};

export const actions: Actions = {
  request: async ({ request, platform, cookies, url }) => {
    const env = platform?.env;
    if (!env || !emailOtpEnabled(env as unknown as Record<string, unknown>)) {
      return fail(400, { requestError: 'Email sign-in is not available.' });
    }
    const envRecord = env as unknown as Record<string, unknown>;
    const clientIp = clientIpOf(request);
    const country = requestCountry(request);

    const data = await request.formData();
    const address = normalizeEmail(data.get('address'));
    const purpose: OtpPurpose = data.get('purpose') === 'enroll' ? 'enroll' : 'signin';
    if (!address) {
      return fail(400, { requestError: 'Enter a valid email address.', purpose });
    }

    // A decoy request id, bound into the proof cookie exactly like a real
    // one, so verify's response is identical whether or not a code was
    // actually issued (no matching auth_otp_codes row will ever exist).
    let requestId: string = crypto.randomUUID();

    const respondNeutral = async () => {
      const proof = await createOtpProof(purpose, address, requestId, env.SESSION_SECRET);
      cookies.set(OTP_PROOF_COOKIE, proof, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        maxAge: OTP_PROOF_TTL_SECONDS,
      });
      return { requestSent: true, purpose, message: NEUTRAL_REQUEST_MESSAGE };
    };

    await audit(env.DB, {
      event_type: 'otp.requested',
      detail: `purpose=${purpose} country=${country}`,
      ip_address: clientIp,
    });

    const [addressLimit, ipLimit] = await Promise.all([
      consumeRateLimit(env.DB, 'otp_addr', address, 3, 15 * 60),
      consumeRateLimit(env.DB, 'otp_ip', clientIp, 10, 15 * 60),
    ]);
    if (!addressLimit.allowed || !ipLimit.allowed) {
      return respondNeutral();
    }

    // Sign-in countries are a managed org setting (Admin > Settings), not an
    // env var — one list shared by every sign-in method. This is the
    // pre-authentication surface, so it stays neutral like every other
    // refusal reason here; the equivalent check in `verify` runs after the
    // code is proven and returns a plain explanation instead.
    const settings = await loadOrgSettings(envRecord);
    if (!countryAllowed(country, settings.signInCountries)) {
      await audit(env.DB, {
        event_type: 'otp.geo_refused',
        detail: `purpose=${purpose} country=${country}`,
        ip_address: clientIp,
      });
      return respondNeutral();
    }

    if (turnstileEnabled(envRecord)) {
      const token = data.get('cf-turnstile-response');
      const passed = typeof token === 'string' && await verifyTurnstile(envRecord, token, clientIp);
      if (!passed) {
        await audit(env.DB, {
          event_type: 'otp.turnstile_failed',
          detail: `purpose=${purpose} country=${country}`,
          ip_address: clientIp,
        });
        return respondNeutral();
      }
    }

    const eligibleUser = purpose === 'signin' ? await resolveSigninEligibility(env.DB, address) : null;
    const eligibleEnrollment = purpose === 'enroll'
      ? await resolveEnrollEligibility(env.DB, address, cookies.get(ENROLLMENT_COOKIE))
      : null;
    const targetId = eligibleUser?.id ?? eligibleEnrollment?.user_id ?? null;
    if (!targetId) {
      return respondNeutral();
    }

    const issued = await issueOtp(env.DB, { purpose, address, sessionSecret: env.SESSION_SECRET });
    requestId = issued.requestId;

    const outboundProvider = detectProvider(envRecord);
    if (outboundProvider === 'none' || !settings.systemEmail) {
      // Nothing is actually sent, but this is a deployment misconfiguration
      // an operator needs to see — never surfaced to the (unauthenticated,
      // possibly anonymous) requester, only to the audit log.
      await audit(env.DB, {
        event_type: 'email.failed',
        actor_id: targetId,
        target: targetId,
        detail: `OTP delivery unavailable (purpose=${purpose} country=${country}): no outbound provider or system From address configured`,
        ip_address: clientIp,
      });
      return respondNeutral();
    }

    const { subject, html, text } = generateOtpEmail({ code: issued.code, orgName: settings.orgName || settings.appName });
    try {
      const result = await sendEmail(
        { from: settings.systemEmail, fromName: settings.systemFromName, to: address, subject, html, text },
        envRecord,
      );
      await audit(env.DB, {
        event_type: result.success ? 'otp.sent' : 'email.failed',
        actor_id: targetId,
        target: targetId,
        detail: `purpose=${purpose} country=${country}`,
        ip_address: clientIp,
      });
    } catch (error) {
      console.error('OTP email delivery failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
      await audit(env.DB, {
        event_type: 'email.failed',
        actor_id: targetId,
        target: targetId,
        detail: `purpose=${purpose} country=${country}`,
        ip_address: clientIp,
      });
    }

    return respondNeutral();
  },

  verify: async ({ request, platform, cookies, url }) => {
    const env = platform?.env;
    if (!env || !emailOtpEnabled(env as unknown as Record<string, unknown>)) {
      return fail(400, { verifyError: 'Email sign-in is not available.' });
    }
    try {
      assertStrongSessionSecret(env.SESSION_SECRET);
    } catch {
      return fail(503, { verifyError: NEUTRAL_VERIFY_MESSAGE });
    }

    const clientIp = clientIpOf(request);
    const country = requestCountry(request);

    // The proof cookie must survive a simple typo: the stored code allows
    // OTP_MAX_ATTEMPTS tries, and clearing the proof on the first mismatch
    // would silently reduce that to one. It is cleared on every terminal
    // outcome (success, lock, expiry, unknown request, refusal) — only a
    // plain mismatch keeps it, so the person can retype the code.
    const clearProof = () => cookies.delete(OTP_PROOF_COOKIE, { path: '/' });
    const proofCookie = cookies.get(OTP_PROOF_COOKIE);
    const proof = await verifyOtpProof(proofCookie, env.SESSION_SECRET);
    if (!proof) {
      clearProof();
      return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
    }

    // Deliberately no pre-decode geography check here (unlike the old
    // env-var-driven version of this action): a per-user exception can only
    // be evaluated once the code is decoded and a real user is resolved
    // below, so gating earlier would wrongly block someone with a valid
    // exception. A wrong-code guess never reaches that point anyway — it
    // fails at the `result !== 'ok'` branch below regardless of geography.
    const data = await request.formData();
    const rawCode = data.get('code');
    const code = typeof rawCode === 'string' ? rawCode.replace(/\s+/g, '') : '';

    const result = /^\d{8}$/.test(code)
      ? await verifyOtp(env.DB, {
        purpose: proof.purpose, address: proof.address, code, requestId: proof.requestId,
        sessionSecret: env.SESSION_SECRET,
      })
      : 'mismatch';

    if (result !== 'ok') {
      if (result !== 'mismatch') clearProof();
      await audit(env.DB, {
        event_type: result === 'locked' ? 'otp.locked' : 'otp.verify_failed',
        detail: `purpose=${proof.purpose} country=${country} reason=${result}`,
        ip_address: clientIp,
      });
      return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
    }

    // From here the code row is already consumed — every outcome, success or
    // refusal, is terminal for this proof.
    clearProof();

    let user: User | null;
    if (proof.purpose === 'enroll') {
      const token = cookies.get(ENROLLMENT_COOKIE);
      const enrollment = await resolveEnrollEligibility(env.DB, proof.address, token);
      if (!enrollment) {
        await audit(env.DB, {
          event_type: 'otp.verify_failed',
          detail: `purpose=enroll country=${country} reason=enrollment_invalid`,
          ip_address: clientIp,
        });
        return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
      }
      try {
        // Consumes the enrollment token, creates the user_identities row,
        // and activates the account — the exact same binding the OAuth
        // callback uses, reused rather than duplicated.
        await bindEnrolledIdentity(env.DB, enrollment, 'email', proof.address, enrollment.email);
      } catch (error) {
        console.error('Email enrollment binding failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
        return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
      }
      cookies.delete(ENROLLMENT_COOKIE, { path: '/' });
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(enrollment.user_id).first<User>();
      if (user) {
        await audit(env.DB, {
          event_type: 'auth.identity_bound',
          actor_id: user.id,
          actor_role: user.role,
          target: user.id,
          detail: 'Enrolled email identity using a manager invitation (one-time code)',
          ip_address: clientIp,
        });
      }
    } else {
      user = await findBoundUser(env.DB, 'email', proof.address);
    }

    if (!user || user.status === 'paused' || user.status === 'offboarded') {
      await audit(env.DB, {
        event_type: 'otp.verify_failed',
        detail: `purpose=${proof.purpose} country=${country} reason=account_unavailable`,
        ip_address: clientIp,
      });
      return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
    }

    // Covers a manager who somehow acquired an email identity (e.g. an
    // OAuth-enrolled manager whose invitation was somehow also redeemed via
    // the OTP route) — manager access always requires an OAuth identity.
    if (user.role === 'manager') {
      await audit(env.DB, {
        event_type: 'auth.otp.manager_blocked',
        actor_id: user.id,
        actor_role: 'manager',
        target: user.id,
        detail: `purpose=${proof.purpose} country=${country}`,
        ip_address: clientIp,
      });
      return fail(400, { verifyError: NEUTRAL_VERIFY_MESSAGE });
    }

    // Post-authentication sign-in-country gate: this person has just proven
    // who they are (the code was correct), so — unlike every neutral
    // response above — a denial here says exactly why, rather than hiding
    // the reason.
    const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
    const gate = await signInCountryGate(env.DB, settings, { userId: user.id, country });
    if (!gate.allowed) {
      await recordTravelRequest(env.DB, env, { user, country, appUrl: settings.appUrl || env.APP_URL });
      await audit(env.DB, {
        event_type: 'auth.sign_in_denied',
        actor_id: user.id,
        actor_role: user.role,
        target: user.id,
        detail: `Denied email sign-in: country_blocked (${country})`,
        ip_address: clientIp,
      });
      return fail(400, { verifyError: COUNTRY_PENDING_MESSAGE });
    }

    if (user.last_auth_country && user.last_auth_country !== country) {
      await audit(env.DB, {
        event_type: 'auth.otp.country_changed',
        actor_id: user.id,
        actor_role: user.role,
        target: user.id,
        detail: `country changed ${user.last_auth_country} -> ${country}`,
        ip_address: clientIp,
      });
    }

    await env.DB.prepare(
      `UPDATE users
       SET last_sign_in = datetime('now'), last_auth_country = ?,
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(country, user.id).run();

    const ttlMs = otpSessionTtlMs(env as unknown as Record<string, unknown>);
    const { token: sessionToken, hash, expiresAt, sessionId } = await createSessionToken(user.id, env.SESSION_SECRET, ttlMs);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, issued_at, expires_at, ip_address, revoked)
       VALUES (?, ?, ?, datetime('now'), ?, ?, 0)`,
    ).bind(sessionId, user.id, hash, expiresAt.toISOString(), clientIp).run();

    // Same sliding-eviction rule as the OAuth callback: keep the
    // most-recently-renewed sessions, not the most-recently-issued ones.
    await env.DB.prepare(
      `UPDATE sessions SET revoked = 1
       WHERE user_id = ? AND revoked = 0 AND id NOT IN (
         SELECT id FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY expires_at DESC, id DESC LIMIT ?
       )`,
    ).bind(user.id, user.id, maxSessionsPerUser(env as unknown as Record<string, unknown>)).run();

    await audit(env.DB, {
      event_type: 'otp.verify_ok',
      actor_id: user.id,
      actor_role: user.role,
      target: user.id,
      detail: `purpose=${proof.purpose} country=${country}`,
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

    cookies.set(SESSION_COOKIE, sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    throw redirect(303, location);
  },
};
