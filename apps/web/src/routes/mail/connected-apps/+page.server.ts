import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '#lib/server/db.js';
import { isMcpEnabled, mcpResource } from '#lib/server/mcp/config.js';
import { listConnectedApps } from '#lib/server/mcp/grants.js';
import { revokeGrant } from '#lib/server/mcp/oauth.js';

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) return { apps: [], enabled: false, mcpUrl: null };
  const [apps, enabled] = await Promise.all([
    listConnectedApps(env.DB, locals.user.id),
    isMcpEnabled(env.DB),
  ]);
  return { apps, enabled, mcpUrl: mcpResource(env as unknown as Record<string, unknown>) };
};

export const actions: Actions = {
  revoke: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    const form = await request.formData();
    const grantId = form.get('grant_id');
    if (typeof grantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(grantId)) return fail(400, { error: 'Choose a connection to disconnect' });
    // Only the owner's own active grant can be revoked from this page.
    const grant = await env.DB.prepare(
      'SELECT id, client_name FROM mcp_grants WHERE id = ? AND user_id = ? AND revoked_epoch IS NULL',
    ).bind(grantId, locals.user.id).first<{ id: string; client_name: string }>();
    if (!grant) return fail(404, { error: 'That connection was already disconnected' });
    await revokeGrant(env.DB, grant.id, 'user');
    await audit(env.DB, {
      event_type: 'mcp.grant_revoked',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: grant.id,
      detail: `Disconnected AI app "${grant.client_name.slice(0, 80)}"`,
      session_id: locals.sessionId,
    });
    return { success: `${grant.client_name} was disconnected. Its tokens stopped working immediately.` };
  },
};
