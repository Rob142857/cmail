import { redirect, error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(302, '/');
  if (locals.user.role !== 'manager') throw error(403, 'Admin access required');

  const env = platform?.env;
  const pendingTravel = env
    ? await env.DB.prepare(`SELECT COUNT(*) AS count FROM signin_country_requests WHERE status = 'pending'`)
      .first<{ count: number }>()
      .catch(() => null)
    : null;

  return { user: locals.user, pendingTravelCount: pendingTravel?.count || 0 };
};
