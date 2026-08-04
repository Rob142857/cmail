import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  BOOTSTRAP_PROOF_COOKIE,
  BOOTSTRAP_PROOF_TTL_SECONDS,
  bootstrapConfiguration,
  createBootstrapProof,
  secretsEqual,
} from '$lib/server/bootstrap';
import { ENROLLMENT_COOKIE } from '$lib/server/identity';
import { consumeRateLimit } from '$lib/server/rate-limit';

async function managerExists(db: D1Database): Promise<boolean> {
  return !!await db.prepare("SELECT id FROM users WHERE role = 'manager' LIMIT 1").first<{ id: string }>();
}

export const load: PageServerLoad = async ({ locals, platform, setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    // Origin-only referrer keeps this path out of outbound Referer headers
    // while still letting the browser send a real Origin on the form POST.
    'Referrer-Policy': 'strict-origin',
  });
  if (locals.user) throw redirect(303, '/mail');
  const env = platform?.env;
  const configuration = env
    ? bootstrapConfiguration(env as unknown as Record<string, unknown>)
    : null;
  if (!env || !configuration || await managerExists(env.DB)) throw redirect(303, '/');
  return {};
};

export const actions: Actions = {
  default: async ({ request, platform, cookies, url }) => {
    const env = platform?.env;
    const configuration = env
      ? bootstrapConfiguration(env as unknown as Record<string, unknown>)
      : null;
    if (!env || !configuration) {
      return fail(503, { error: 'Initial manager setup is not configured.' });
    }
    if (await managerExists(env.DB)) {
      return fail(409, { error: 'Initial manager setup has already been completed.' });
    }

    const clientIp = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const rate = await consumeRateLimit(env.DB, 'bootstrap_proof', clientIp.slice(0, 64), 5, 900);
    if (!rate.allowed) {
      return fail(429, { error: 'Too many setup attempts. Wait a few minutes, then try again.' });
    }

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 4096) return fail(413, { error: 'The setup token could not be verified.' });
    const data = await request.formData();
    const candidate = data.get('token');
    if (typeof candidate !== 'string' || candidate.length > 512 || !await secretsEqual(candidate, configuration.token)) {
      return fail(403, { error: 'The setup token could not be verified.' });
    }

    const proof = await createBootstrapProof(configuration.email, configuration.sessionSecret);
    cookies.delete(ENROLLMENT_COOKIE, { path: '/' });
    cookies.set(BOOTSTRAP_PROOF_COOKIE, proof, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: BOOTSTRAP_PROOF_TTL_SECONDS,
    });
    throw redirect(303, '/');
  },
};
