import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { audit, generateId } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
  const env = platform?.env;
  if (!env?.DB) return { policy: null, alreadySigned: false, policyUnavailable: true };

  const latestPolicy = await env.DB.prepare(
    'SELECT * FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1',
  ).first<{ id: string; version_label: string; body_text: string; published_at: string }>();

  if (!latestPolicy) {
    // No policy published — authenticated users go to mail, guests see nothing useful
    if (locals.user) throw redirect(302, '/mail');
    return { policy: null, alreadySigned: false, policyUnavailable: false };
  }

  // Check if the logged-in user has already signed this version
  let alreadySigned = false;
  if (locals.user) {
    const existing = await env.DB.prepare(
      'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
    ).bind(locals.user.id, latestPolicy.id).first<{ id: string }>();
    if (existing) alreadySigned = true;
  }

  return {
    policy: latestPolicy,
    alreadySigned,
    policyUnavailable: false,
  };
};

export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env?.DB) return fail(503, { error: 'Policy storage unavailable' });

    const formData = await request.formData();
    const policyVersionId = formData.get('policy_version_id');
    const accepted = formData.get('accept');

    if (!accepted || !policyVersionId) {
      return fail(400, { error: 'Accept the policy to continue' });
    }

    const latestPolicy = await env.DB.prepare(
      'SELECT id FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1',
    ).first<{ id: string }>();
    if (!latestPolicy || policyVersionId !== latestPolicy.id) {
      return fail(409, { error: 'The policy changed. Review the latest version before continuing.' });
    }

    const id = generateId();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ict_policy_signatures
       (id, user_id, policy_version_id, signed_at, ip_address, session_id)
       VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ?, ?)`,
    ).bind(
      id,
      locals.user.id,
      latestPolicy.id,
      request.headers.get('cf-connecting-ip') || '',
      locals.sessionId,
    ).run();

    await audit(env.DB, {
      event_type: 'policy.signed',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Signed policy version ${latestPolicy.id}`,
      ip_address: request.headers.get('cf-connecting-ip') || '',
      session_id: locals.sessionId,
    });

    throw redirect(303, '/mail');
  },
};
