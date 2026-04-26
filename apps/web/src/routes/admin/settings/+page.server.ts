import type { PageServerLoad, Actions } from './$types';
import { audit } from '$lib/server/db';
import { loadOrgSettings, ORG_SETTINGS_KEYS, type OrgSettingsKey } from '$lib/server/org-settings';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { settings: null, mailDomain: '' };
  const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
  return {
    settings,
    mailDomain: (env.MAIL_DOMAIN as string) || '',
  };
};

const FIELD_MAP: Record<OrgSettingsKey, { label: string; max: number }> = {
  org_name: { label: 'Organisation name', max: 200 },
  org_short_name: { label: 'Organisation short name', max: 80 },
  org_url: { label: 'Organisation URL', max: 300 },
  app_name: { label: 'App name', max: 80 },
  app_url: { label: 'App URL', max: 300 },
  system_email: { label: 'System mailbox (From address)', max: 200 },
  system_from_name: { label: 'System From display name', max: 120 },
  support_email: { label: 'Support email', max: 200 },
  landing_url: { label: 'Landing page URL', max: 300 },
  policy_url: { label: 'Policy page URL', max: 300 },
};

function isHttpUrl(s: string): boolean {
  if (!s) return true; // optional
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

const EMAIL_RX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export const actions: Actions = {
  save: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Manager role required' };

    const data = await request.formData();
    const updates: Array<{ key: OrgSettingsKey; value: string }> = [];

    for (const key of ORG_SETTINGS_KEYS) {
      const raw = data.get(key);
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      const meta = FIELD_MAP[key];
      if (value.length > meta.max) return { error: `${meta.label} is too long (max ${meta.max})` };

      // Field-specific validation
      if (key === 'system_email' || key === 'support_email') {
        if (value && !EMAIL_RX.test(value)) return { error: `${meta.label} must be a valid email address` };
      }
      if (key === 'org_url' || key === 'app_url' || key === 'landing_url' || key === 'policy_url') {
        if (!isHttpUrl(value)) return { error: `${meta.label} must be an http(s) URL` };
      }
      // Reject control characters (CR/LF) anywhere — header injection guard
      if (/[\r\n]/.test(value)) return { error: `${meta.label} contains invalid characters` };
      updates.push({ key, value });
    }

    if (!updates.length) return { error: 'Nothing to update' };

    // Upsert each row
    for (const { key, value } of updates) {
      await env.DB.prepare(
        `INSERT INTO org_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`,
      ).bind(key, value, locals.user.id).run();
    }

    await audit(env.DB, {
      event_type: 'org.settings_updated',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Updated org settings: ${updates.map((u) => u.key).join(', ')}`,
    });

    return { success: 'Settings saved' };
  },
};
