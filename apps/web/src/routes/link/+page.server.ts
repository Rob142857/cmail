import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Matches the risk vocabulary in packages/shared/src/link-risk.ts. */
const RISKS = new Set(['punycode', 'mismatch']);

/** Long enough for real tracking URLs, short enough to stay displayable. */
const MAX_URL_CHARS = 2048;

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    // Origin-only, so the destination never learns which message linked to it.
    'Referrer-Policy': 'strict-origin',
  });
  // Signed-in only. An unauthenticated page that renders an arbitrary
  // attacker-supplied destination would be a phishing lure hosted on this
  // domain, which is precisely what this page exists to prevent.
  if (!locals.user) throw redirect(302, '/');

  const target = url.searchParams.get('u') || '';
  const risk = url.searchParams.get('r') || '';

  if (!target || target.length > MAX_URL_CHARS) throw redirect(303, '/mail');

  let destination: URL;
  try {
    destination = new URL(target);
  } catch {
    throw redirect(303, '/mail');
  }
  // Only web destinations. Anything else has no business being handed a click
  // from an interstitial, and embedded credentials are always a red flag.
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') {
    throw redirect(303, '/mail');
  }
  if (destination.username || destination.password) throw redirect(303, '/mail');

  return {
    href: destination.toString(),
    host: destination.hostname.toLowerCase(),
    insecure: destination.protocol === 'http:',
    risk: RISKS.has(risk) ? risk : 'mismatch',
  };
};
