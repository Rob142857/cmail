// Org-level configuration: a small key/value store backed by D1 with env-var fallback.
//
// Why it exists: a manager should be able to change "from address", "from
// display name", org name, support email, landing URL, etc. without redeploy.
// Values live in the `org_settings` table; this helper merges DB overrides on
// top of process env defaults and exposes a typed object.
import { isValidCountryCode } from '$lib/countries';
import { normalizeEmail } from './validation';

export interface OrgSettings {
  orgName: string;
  orgShortName: string;
  orgUrl: string;
  appName: string;
  appUrl: string;
  /** Mailbox used as the "From" address for system mail (invites etc). Must be on a verified sending domain. */
  systemEmail: string;
  /** Display name shown in the "From" header, e.g. "Example Org Mail". */
  systemFromName: string;
  /** Address shown to users for support replies. Defaults to systemEmail. */
  supportEmail: string;
  /** Public marketing/landing site (footer link). */
  landingUrl: string;
  /** Acceptable-use policy URL. Defaults to `${appUrl}/policy` when blank. */
  policyUrl: string;
  /**
   * ISO 3166-1 alpha-2 codes sign-in is allowed from, enforced after
   * authentication on every sign-in method (Google, Microsoft, email
   * one-time code). Empty = feature off — every country is allowed. See
   * lib/server/travel.ts's signInCountryGate.
   */
  signInCountries: string[];
}

export const ORG_SETTINGS_KEYS = [
  'org_name',
  'org_short_name',
  'org_url',
  'app_name',
  'system_email',
  'system_from_name',
  'support_email',
  'landing_url',
  'policy_url',
  'sign_in_countries',
] as const;

export type OrgSettingsKey = (typeof ORG_SETTINGS_KEYS)[number];

const DEFAULT_APP_NAME = 'cmail';

function envStr(env: Record<string, unknown>, key: string): string {
  const v = env[key];
  return typeof v === 'string' ? v : '';
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

/**
 * Tolerant JSON-array-of-codes parser: a malformed or pre-migration value
 * degrades to `[]` (feature off, every country allowed) rather than
 * throwing, matching this app's "never lock the organisation out" posture
 * for this particular setting.
 */
function parseCountryList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const codes = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      const code = entry.trim().toUpperCase();
      if (isValidCountryCode(code)) codes.add(code);
    }
    return [...codes].sort();
  } catch {
    return [];
  }
}

function cleanHttpUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    if (url.protocol === 'https:') return url.toString().replace(/\/$/, '');
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Invalid or relative URLs are not exposed as public links.
  }
  return '';
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

  // APP_URL is a deployment boundary because OAuth callbacks are derived from
  // it. Keeping it env-only prevents a D1 setting from drifting away from the
  // identity-provider registration.
  const appUrl = cleanHttpUrl(envStr(env, 'APP_URL'));
  const systemEmail = normalizeEmail(overrides.system_email || envStr(env, 'SYSTEM_EMAIL')) || '';
  const orgName = cleanText(overrides.org_name || envStr(env, 'ORG_NAME'), 200);
  const orgShortName = cleanText(overrides.org_short_name || envStr(env, 'ORG_SHORT_NAME') || orgName, 80);

  return {
    orgName,
    orgShortName,
    orgUrl: cleanHttpUrl(overrides.org_url || envStr(env, 'ORG_URL')),
    appName: cleanText(overrides.app_name || envStr(env, 'APP_NAME') || DEFAULT_APP_NAME, 80) || DEFAULT_APP_NAME,
    appUrl,
    systemEmail,
    systemFromName: cleanText(
      overrides.system_from_name ||
      envStr(env, 'SYSTEM_FROM_NAME') ||
      (orgShortName ? `${orgShortName} Desk` : ''),
      120,
    ),
    supportEmail: normalizeEmail(overrides.support_email || envStr(env, 'SUPPORT_EMAIL')) || systemEmail,
    landingUrl: cleanHttpUrl(overrides.landing_url || envStr(env, 'LANDING_URL')),
    policyUrl: cleanHttpUrl(overrides.policy_url || envStr(env, 'POLICY_URL')) || (appUrl ? `${appUrl}/policy` : '/policy'),
    signInCountries: parseCountryList(overrides.sign_in_countries),
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
