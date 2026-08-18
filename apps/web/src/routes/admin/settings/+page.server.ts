import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { audit } from '$lib/server/db';
import { loadOrgSettings, ORG_SETTINGS_KEYS, type OrgSettingsKey } from '$lib/server/org-settings';
import { normalizeDomain, normalizeEmail } from '$lib/server/validation';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { settings: null, mailDomain: '' };
  const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
  return {
    settings,
    mailDomain: normalizeDomain(env.MAIL_DOMAIN) || '',
  };
};

const FIELD_MAP: Record<OrgSettingsKey, { label: string; max: number }> = {
  org_name: { label: 'Organisation name', max: 200 },
  org_short_name: { label: 'Organisation short name', max: 80 },
  org_url: { label: 'Organisation URL', max: 300 },
  app_name: { label: 'App name', max: 80 },
  system_email: { label: 'System mailbox (From address)', max: 200 },
  system_from_name: { label: 'System From display name', max: 120 },
  support_email: { label: 'Support email', max: 200 },
  landing_url: { label: 'Landing page URL', max: 300 },
  policy_url: { label: 'Policy page URL', max: 300 },
};

function isSafeHttpUrl(s: string): boolean {
  if (!s) return true; // optional
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || (
      u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    );
  } catch { return false; }
}

export const actions: Actions = {
  save: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!locals.user) return fail(401, { error: 'Authentication required' });
    if (locals.user.role !== 'manager') return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const updates: Array<{ key: OrgSettingsKey; value: string }> = [];

    for (const key of ORG_SETTINGS_KEYS) {
      const raw = data.get(key);
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      const meta = FIELD_MAP[key];
      if (value.length > meta.max) return fail(400, { error: `${meta.label} is too long (max ${meta.max})` });

      // Field-specific validation
      if (key === 'system_email' || key === 'support_email') {
        if (value && !normalizeEmail(value)) return fail(400, { error: `${meta.label} must be a valid email address` });
      }
      if (key === 'org_url' || key === 'landing_url' || key === 'policy_url') {
        if (!isSafeHttpUrl(value)) return fail(400, { error: `${meta.label} must start with https://` });
      }
      // Reject control characters (CR/LF) anywhere — header injection guard
      if (/[\u0000-\u001f\u007f]/.test(value)) return fail(400, { error: `${meta.label} contains invalid characters` });
      updates.push({ key, value });
    }

    if (!updates.length) return fail(400, { error: 'Nothing to update' });

    await env.DB.batch(updates.map(({ key, value }) =>
      env.DB.prepare(
        `INSERT INTO org_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`,
      ).bind(key, value, locals.user!.id),
    ));

    await audit(env.DB, {
      event_type: 'org.settings_updated',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Updated org settings: ${updates.map((u) => u.key).join(', ')}`,
    });

    return { success: 'Settings saved' };
  },
};
