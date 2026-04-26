import type { PageServerLoad, Actions } from './$types';
import { generateId, audit } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { policies: [] };

  const policies = await env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM ict_policy_signatures WHERE policy_version_id = p.id) as signature_count
     FROM ict_policy_versions p ORDER BY p.published_at DESC`,
  ).all<{ id: string; version_label: string; body_text: string; published_at: string; signature_count: number }>();

  return { policies: policies.results || [] };
};

export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    // ✅ Permission check: only managers can publish
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can publish policies' };

    const data = await request.formData();
    const versionLabel = (data.get('version_label') as string)?.trim();
    const htmlBody = (data.get('html_body') as string)?.trim();

    // ✅ Enhanced validation
    if (!versionLabel || !htmlBody) return { error: 'Version label and body are required' };
    if (versionLabel.length > 255) return { error: 'Version label is too long (max 255 chars)' };
    if (htmlBody.length > 100000) return { error: 'Policy body is too large (max 100KB)' };

    try {
      const id = generateId();
      await env.DB.prepare(
        'INSERT INTO ict_policy_versions (id, version_label, body_text, published_at, published_by) VALUES (?, ?, ?, datetime(\'now\'), ?)',
      ).bind(id, versionLabel, htmlBody, locals.user.id).run();

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
      return { error: `Failed to publish policy: ${(e as Error).message}` };
    }
  },
};
