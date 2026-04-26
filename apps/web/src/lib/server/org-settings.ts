// Org-level configuration: a small key/value store backed by D1 with env-var fallback.
//
// Why it exists: a manager should be able to change "from address", "from
// display name", org name, support email, landing URL, etc. without redeploy.
// Values live in the `org_settings` table; this helper merges DB overrides on
// top of process env defaults and exposes a typed object.

export interface OrgSettings {
  orgName: string;
  orgShortName: string;
  orgUrl: string;
  appName: string;
  appUrl: string;
  /** Mailbox used as the "From" address for system mail (invites etc). Must be on a verified sending domain. */
  systemEmail: string;
  /** Display name shown in the "From" header, e.g. "Ma'atara Desk". */
  systemFromName: string;
  /** Address shown to users for support replies. Defaults to systemEmail. */
  supportEmail: string;
  /** Public marketing/landing site (footer link). */
  landingUrl: string;
  /** Acceptable-use policy URL. Defaults to `${appUrl}/policy` when blank. */
  policyUrl: string;
}

export const ORG_SETTINGS_KEYS = [
  'org_name',
  'org_short_name',
  'org_url',
  'app_name',
  'app_url',
  'system_email',
  'system_from_name',
  'support_email',
  'landing_url',
  'policy_url',
] as const;

export type OrgSettingsKey = (typeof ORG_SETTINGS_KEYS)[number];

const DEFAULT_APP_NAME = 'cmail';

function envStr(env: Record<string, unknown>, key: string): string {
  const v = env[key];
  return typeof v === 'string' ? v : '';
}

export async function loadOrgSettings(env: Record<string, unknown>): Promise<OrgSettings> {
  const db = env.DB as D1Database | undefined;
  const overrides: Partial<Record<OrgSettingsKey, string>> = {};
  if (db) {
    try {
      const rows = await db.prepare('SELECT key, value FROM org_settings').all<{ key: string; value: string }>();
      for (const r of rows.results || []) {
        if ((ORG_SETTINGS_KEYS as readonly string[]).includes(r.key) && typeof r.value === 'string') {
          overrides[r.key as OrgSettingsKey] = r.value;
        }
      }
    } catch {
      // Table may not exist yet on first run — fall back to env-only.
    }
  }

  const appUrl = overrides.app_url || envStr(env, 'APP_URL') || '';
  const systemEmail = overrides.system_email || envStr(env, 'SYSTEM_EMAIL') || '';
  const orgName = overrides.org_name || envStr(env, 'ORG_NAME') || '';
  const orgShortName = overrides.org_short_name || envStr(env, 'ORG_SHORT_NAME') || orgName;

  return {
    orgName,
    orgShortName,
    orgUrl: overrides.org_url || envStr(env, 'ORG_URL') || '',
    appName: overrides.app_name || envStr(env, 'APP_NAME') || DEFAULT_APP_NAME,
    appUrl,
    systemEmail,
    systemFromName:
      overrides.system_from_name ||
      envStr(env, 'SYSTEM_FROM_NAME') ||
      (orgShortName ? `${orgShortName} Desk` : ''),
    supportEmail: overrides.support_email || envStr(env, 'SUPPORT_EMAIL') || systemEmail,
    landingUrl: overrides.landing_url || envStr(env, 'LANDING_URL') || '',
    policyUrl: overrides.policy_url || envStr(env, 'POLICY_URL') || (appUrl ? `${appUrl}/policy` : '/policy'),
  };
}

/**
 * Build an RFC 5322 "From" header value with display name.
 * Encodes display name as a quoted string and strips characters that could
 * break the header (CR/LF/quotes).
 */
export function formatFromHeader(displayName: string, address: string): string {
  if (!address) return '';
  if (!displayName) return address;
  const safe = displayName.replace(/[\r\n"\\]/g, '').trim();
  if (!safe) return address;
  return `"${safe}" <${address}>`;
}
