import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { generateId, audit } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { policies: [], affectedUsers: 0 };

  const policies = await env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM ict_policy_signatures WHERE policy_version_id = p.id) as signature_count
     FROM ict_policy_versions p ORDER BY p.published_at DESC LIMIT 50`,
  ).all<{ id: string; version_label: string; body_text: string; published_at: string; signature_count: number }>();

  const affected = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE status IN ('active', 'pending')`,
  ).first<{ count: number }>();

  return { policies: policies.results || [], affectedUsers: affected?.count || 0 };
};

export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });

    // ✅ Permission check: only managers can publish
    if (!locals.user) return fail(401, { error: 'Not authenticated' });
    if (locals.user.role !== 'manager') return fail(403, { error: 'Only managers can publish policies' });

    const data = await request.formData();
    const versionEntry = data.get('version_label');
    const bodyEntry = data.get('body_text') ?? data.get('html_body');
    const versionLabel = typeof versionEntry === 'string' ? versionEntry.trim() : '';
    const bodyText = typeof bodyEntry === 'string' ? bodyEntry.trim() : '';

    // ✅ Enhanced validation
    const values = { versionLabel, bodyText };
    if (!versionLabel || !bodyText) return fail(400, { error: 'Version label and body are required', values });
    if (versionLabel.length > 100) return fail(400, { error: 'Version label is too long (max 100 characters)', values });
    if (bodyText.length > 100000) return fail(400, { error: 'Policy body is too large (max 100,000 characters)', values });

    try {
      const id = generateId();
      await env.DB.prepare(
        `INSERT INTO ict_policy_versions (id, version_label, body_text, published_at, published_by)
         VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ?)`,
      ).bind(id, versionLabel, bodyText, locals.user.id).run();

      // ✅ Audit with error handling
      try {
        await audit(env.DB, {
          event_type: 'policy.published',
          actor_id: locals.user.id,
          actor_role: locals.user.role as 'manager' | 'standard',
          detail: `Published policy version: ${versionLabel}`,
        });
      } catch (e) {
        console.error('Failed to log policy.published audit event:', e);
      }

      return { success: `Policy ${versionLabel} published. All users will be prompted to sign.` };
    } catch (e) {
      console.error('Policy publication failed', e instanceof Error ? e.message : String(e));
      return fail(500, { error: 'Policy could not be published. Please try again.', values });
    }
  },
};
