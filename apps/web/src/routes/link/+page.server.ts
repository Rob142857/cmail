import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { checkLinkHost, verifyLinkSignature } from '#lib/server/link-check.js';

/** Matches the risk vocabulary in packages/shared/src/link-risk.ts. */
const RISKS = new Set(['punycode', 'mismatch']);

/** Long enough for real tracking URLs, short enough to stay displayable. */
const MAX_URL_CHARS = 4096;

export const load: PageServerLoad = async ({ locals, url, setHeaders, platform }) => {
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

  const host = destination.hostname.toLowerCase();
  const env = platform?.env;
  const verdict = env?.STORAGE ? await checkLinkHost(env.STORAGE, host) : 'unavailable';
  // The decision only, plus the host when it is listed: hosts of ordinary
  // links can identify a recipient (per-recipient tracking subdomains).
  console.log('Link check', verdict === 'listed' ? { decision: verdict, host } : { decision: verdict });

  const page = {
    href: destination.toString(),
    host,
    insecure: destination.protocol === 'http:',
  };
  if (verdict === 'listed') return { ...page, risk: 'listed' };
  if (RISKS.has(risk)) return { ...page, risk };
  // A host the check can't read is never opened silently.
  if (verdict === 'uncheckable') return { ...page, risk: 'unverified' };

  // Only a link cmail itself signed is opened without a warning, so this page
  // can never be used as an open redirect. A list that can't be read fails open.
  const signature = url.searchParams.get('s');
  if (env?.SESSION_SECRET && verifyLinkSignature(env.SESSION_SECRET, locals.user.id, target, signature)) {
    throw redirect(303, destination.toString(), { external: true });
  }
  return { ...page, risk: 'unverified' };
};
