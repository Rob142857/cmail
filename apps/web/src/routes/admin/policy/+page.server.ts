import type { PageServerLoad, Actions } from './$types';
import { generateId, audit } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { policies: [] };

  const policies = await env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM ict_policy_signatures WHERE policy_version_id = p.id) as signature_count
     FROM ict_policy_versions p ORDER BY p.published_at DESC`,
  ).all<{ id: string; version_label: string; html_body: string; published_at: string; signature_count: number }>();

  return { policies: policies.results || [] };
};

export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const versionLabel = (data.get('version_label') as string)?.trim();
    const htmlBody = (data.get('html_body') as string)?.trim();

    if (!versionLabel || !htmlBody) return { error: 'Version label and body are required' };

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO ict_policy_versions (id, version_label, html_body, published_at) VALUES (?, ?, ?, datetime(\'now\'))',
    ).bind(id, versionLabel, htmlBody).run();

    await audit(env.DB, {
      event_type: 'policy.published',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      detail: `Published policy version ${versionLabel}`,
    });

    return { success: `Policy ${versionLabel} published. All users will be prompted to sign.` };
  },
};
