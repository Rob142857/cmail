import type { PageServerLoad } from './$types';
import { getEnabledProviders } from '$lib/server/auth';
import { assertStrongSessionSecret, publicRuntimeConfig } from '$lib/server/config';
import { getProviderInfo } from '$lib/server/outbound';
import { loadOrgSettings } from '$lib/server/org-settings';
import { adminLoaderFailure } from '$lib/server/admin-loader-error';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { stats: null, readiness: null };

  let users: { count: number } | null;
  let mailboxes: { count: number } | null;
  let sharedMailboxes: { count: number } | null;
  let messages: { count: number } | null;
  let recentMessages: { count: number } | null;
  let activeSessions: { count: number } | null;
  let policy: { id: string } | null;
  let directory: { enabled: number } | null;
  try {
    [users, mailboxes, sharedMailboxes, messages, recentMessages, activeSessions, policy, directory] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM mailboxes WHERE status = \'active\'').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM mailboxes WHERE status = \'active\' AND type = \'shared\'').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM messages').first<{ count: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM messages WHERE received_at >= datetime('now', '-1 day')`).first<{ count: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE revoked = 0 AND expires_at > datetime('now')`).first<{ count: number }>(),
      env.DB.prepare('SELECT id FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1').first<{ id: string }>(),
      env.DB.prepare('SELECT enabled FROM organization_directory_settings WHERE singleton_id = 1')
        .first<{ enabled: number }>()
        .catch(() => null),
    ]);
  } catch (cause) {
    return { stats: null, readiness: null, ...adminLoaderFailure('dashboard', cause) };
  }

  const runtime = publicRuntimeConfig(env as unknown as Record<string, unknown>);
  const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
  const authProviders = getEnabledProviders(env as unknown as Record<string, string | undefined>);
  const outbound = getProviderInfo(env as unknown as Record<string, unknown>);
  let sessionSecretReady = true;
  try {
    assertStrongSessionSecret(env.SESSION_SECRET);
  } catch {
    sessionSecretReady = false;
  }

  return {
    stats: {
      users: users?.count || 0,
      mailboxes: mailboxes?.count || 0,
      sharedMailboxes: sharedMailboxes?.count || 0,
      messages: messages?.count || 0,
      recentMessages: recentMessages?.count || 0,
      activeSessions: activeSessions?.count || 0,
    },
    readiness: {
      mailDomain: runtime.mailDomain,
      appUrl: settings.appUrl || runtime.appUrl,
      systemEmail: settings.systemEmail,
      authProviders,
      outboundProvider: outbound.name,
      outboundLabel: outbound.label,
      sessionSecretReady,
      storageReady: !!env.STORAGE,
      policyPublished: !!policy,
      directoryEnabled: directory?.enabled === 1,
    },
  };
};
