import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPublicDirectory } from '$lib/server/public-directory';

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

export const GET: RequestHandler = async ({ platform }) => {
  const directory = await loadPublicDirectory(platform?.env?.DB, platform?.env?.MAIL_DOMAIN);
  return json(directory.entries, { headers: PRIVATE_HEADERS });
};
