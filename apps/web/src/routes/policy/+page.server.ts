import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { audit, generateId } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  const latestPolicy = await env.DB.prepare(
    'SELECT * FROM ict_policy_versions ORDER BY published_at DESC LIMIT 1',
  ).first<{ id: string; version_label: string; html_body: string; published_at: string }>();

  if (!latestPolicy) throw redirect(302, '/mail');

  // Check if already signed
  const existing = await env.DB.prepare(
    'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
  ).bind(locals.user.id, latestPolicy.id).first<{ id: string }>();

  if (existing) throw redirect(302, '/mail');

  return {
    policy: latestPolicy,
  };
};

export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const formData = await request.formData();
    const policyVersionId = formData.get('policy_version_id') as string;
    const accepted = formData.get('accept');

    if (!accepted || !policyVersionId) {
      return { error: 'You must accept the policy to continue' };
    }

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO ict_policy_signatures (id, user_id, policy_version_id, signed_at) VALUES (?, ?, ?, datetime(\'now\'))',
    ).bind(id, locals.user.id, policyVersionId).run();

    await audit(env.DB, {
      event_type: 'policy.signed',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Signed policy version ${policyVersionId}`,
    });

    throw redirect(302, '/mail');
  },
};
