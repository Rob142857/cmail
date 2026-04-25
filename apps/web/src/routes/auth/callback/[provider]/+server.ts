import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthProvider, User } from '@cmail/shared/types';
import { exchangeCode, fetchUserInfo } from '$lib/server/auth';
import { createSessionToken, buildSessionCookie } from '$lib/server/session';
import { audit, generateId, nowISO } from '$lib/server/db';

export const GET: RequestHandler = async ({ params, url, platform, cookies }) => {
  const provider = params.provider as AuthProvider;
  const env = platform?.env;
  if (!env) throw redirect(302, '/?error=no_platform');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('cmail_oauth_state');

  // Clear state cookie
  cookies.delete('cmail_oauth_state', { path: '/' });

  if (!code || !state || state !== storedState) {
    throw redirect(302, '/?error=invalid_state');
  }

  const redirectUri = `${env.APP_URL}/auth/callback/${provider}`;

  // Exchange code for tokens
  const tokens = await exchangeCode(
    provider,
    env as unknown as Record<string, string | undefined>,
    code,
    redirectUri,
  );

  // Fetch user info
  const userInfo = await fetchUserInfo(
    provider,
    env as unknown as Record<string, string | undefined>,
    tokens.access_token,
  );

  if (!userInfo.email) {
    throw redirect(302, '/?error=no_email');
  }

  const email = userInfo.email.toLowerCase();

  // Look up user in DB
  let user = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?',
  ).bind(email).first<User>();

  // Bootstrap: if BOOTSTRAP_ADMIN_EMAIL matches and no user exists, auto-provision as manager
  const bootstrapEmail = (env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase().trim();
  if (!user && bootstrapEmail && email === bootstrapEmail) {
    const newUserId = generateId();
    await env.DB.prepare(
      `INSERT INTO users (id, email, display_name, role, status, auth_provider, last_sign_in, created_at, updated_at)
       VALUES (?, ?, ?, 'manager', 'active', ?, datetime('now'), datetime('now'), datetime('now'))`,
    ).bind(newUserId, email, userInfo.name || '', provider).run();

    // Create personal mailbox for bootstrap admin if MAIL_DOMAIN is configured
    if (env.MAIL_DOMAIN) {
      const localPart = email.split('@')[0];
      const personalAddr = `${localPart}@${env.MAIL_DOMAIN}`;
      const existingMailbox = await env.DB.prepare(
        'SELECT id FROM mailboxes WHERE address = ?',
      ).bind(personalAddr).first<{ id: string }>();

      if (!existingMailbox) {
        const mailboxId = generateId();
        await env.DB.prepare(
          `INSERT INTO mailboxes (id, address, display_name, type, status, created_at, updated_at)
           VALUES (?, ?, ?, 'personal', 'active', datetime('now'), datetime('now'))`,
        ).bind(mailboxId, personalAddr, userInfo.name || email).run();

        const assignmentId = generateId();
        await env.DB.prepare(
          `INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at)
           VALUES (?, ?, ?, 'full', datetime('now'))`,
        ).bind(assignmentId, mailboxId, newUserId).run();
      }
    }

    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(newUserId).first<User>();
  }

  if (!user) {
    throw redirect(302, '/?error=not_registered');
  }

  if (user.status === 'offboarded' || user.status === 'paused') {
    throw redirect(302, '/?error=account_suspended');
  }

  // Update user on sign-in
  await env.DB.prepare(
    'UPDATE users SET last_sign_in = datetime(\'now\'), auth_provider = ?, display_name = CASE WHEN display_name = \'\' THEN ? ELSE display_name END, status = CASE WHEN status = \'pending\' THEN \'active\' ELSE status END, updated_at = datetime(\'now\') WHERE id = ?',
  ).bind(provider, userInfo.name || '', user.id).run();

  // Create session
  const { token, hash, expiresAt } = await createSessionToken(user.id, env.SESSION_SECRET);
  const sessionId = generateId();
  const clientIp = url.searchParams.get('cf-connecting-ip') || '';

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, issued_at, expires_at, ip_address, revoked) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, 0)',
  ).bind(sessionId, user.id, hash, expiresAt.toISOString(), clientIp).run();

  // Audit
  await audit(env.DB, {
    event_type: 'auth.sign_in',
    actor_id: user.id,
    actor_role: user.role as 'standard' | 'manager',
    detail: `Signed in via ${provider}`,
    ip_address: clientIp,
    session_id: sessionId,
  });

  // Check if user needs to sign ICT policy
  const latestPolicy = await env.DB.prepare(
    'SELECT id FROM ict_policy_versions ORDER BY published_at DESC LIMIT 1',
  ).first<{ id: string }>();

  if (latestPolicy) {
    const signature = await env.DB.prepare(
      'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
    ).bind(user.id, latestPolicy.id).first<{ id: string }>();

    if (!signature) {
      // Redirect to policy acceptance page
      const headers = new Headers();
      headers.set('Set-Cookie', buildSessionCookie(token, env.MAIL_DOMAIN));
      headers.set('Location', '/policy');
      return new Response(null, { status: 302, headers });
    }
  }

  // Set session cookie and redirect to inbox
  const headers = new Headers();
  headers.set('Set-Cookie', buildSessionCookie(token, env.MAIL_DOMAIN));
  headers.set('Location', '/mail');
  return new Response(null, { status: 302, headers });
};
