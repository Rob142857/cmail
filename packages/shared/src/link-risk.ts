/**
 * Phishing heuristics for links inside untrusted email HTML.
 *
 * Two signals are worth flagging because they are cheap, objective, and hard
 * for a legitimate sender to trip by accident:
 *
 *  - `punycode`  the host contains an IDN label, the classic homograph vector
 *                (`xn--pypal-4ve.com` renders as `pаypal.com`).
 *  - `mismatch`  the anchor text itself names a domain, and it is not the
 *                domain the link goes to.
 *
 * Anchor text that is not domain-like ("Click here", "View invoice") is never
 * a mismatch — there is nothing to contradict. Comparison is on the
 * registrable domain, so `click.example.com` under the text `example.com` is
 * ordinary link tracking rather than a finding. Alert fatigue is the failure
 * mode that makes a warning worthless, so the bar is deliberately high.
 *
 * These are heuristics, not a verdict. They mark a link as worth a second
 * look; they never block it.
 */

export type LinkRisk = 'punycode' | 'mismatch';

export interface LinkAssessment {
  risk: LinkRisk | null;
  /** Lowercased hostname of the true destination, for display. */
  host: string;
}

export const NO_LINK_RISK: LinkAssessment = { risk: null, host: '' };

/** Longest anchor text worth inspecting. Beyond this it is prose, not a URL. */
const MAX_DISPLAY_TEXT = 256;

/**
 * Second-level labels that behave as public suffixes, so `example.co.uk` is
 * compared as a whole rather than collapsing to `co.uk`. This is a pragmatic
 * subset, not the Public Suffix List — shipping and updating the full PSL is
 * not worth it for a heuristic. A miss degrades to a false negative on an
 * unusual ccTLD, never to a false accusation.
 */
const COMPOUND_SUFFIX_LABELS = new Set([
  'ac', 'co', 'com', 'edu', 'gov', 'govt', 'id', 'in', 'mil', 'ne', 'net',
  'nom', 'or', 'org', 'sch', 'web',
]);

/** Matches anchor text that names a host, with or without scheme or path. */
const DISPLAY_HOST_PATTERN =
  /^\s*(?:(?:https?|ftp):\/\/)?(?:[^\s/@]{1,64}@)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?=[\s:/?#]|$)/i;

/**
 * Collapses a hostname to the registrable domain, approximately. Used only to
 * compare two hosts for equivalence.
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  // labels.at(-2) is the label directly left of the TLD.
  const beforeTld = labels[labels.length - 2];
  const take = COMPOUND_SUFFIX_LABELS.has(beforeTld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Extracts the host named by anchor text, or '' when the text names none. */
export function displayedHost(text: unknown): string {
  if (typeof text !== 'string') return '';
  const candidate = text.trim();
  if (!candidate || candidate.length > MAX_DISPLAY_TEXT) return '';
  const match = DISPLAY_HOST_PATTERN.exec(candidate);
  return match ? match[1].toLowerCase() : '';
}

/** True when any label of the host is an IDN (punycode) label. */
export function hasPunycodeLabel(host: string): boolean {
  return host.toLowerCase().split('.').some((label) => label.startsWith('xn--'));
}

/**
 * Assesses one link. `displayText` is the anchor's visible text; pass '' when
 * the anchor wraps only an image, which carries no claim to contradict.
 */
export function assessLinkRisk(href: unknown, displayText: unknown): LinkAssessment {
  if (typeof href !== 'string' || !href) return NO_LINK_RISK;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return NO_LINK_RISK;
  }
  // mailto: has no host to compare and cannot carry a homograph host.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return NO_LINK_RISK;

  const host = url.hostname.toLowerCase();
  if (!host) return NO_LINK_RISK;
  if (hasPunycodeLabel(host)) return { risk: 'punycode', host };

  const claimed = displayedHost(displayText);
  if (claimed && registrableDomain(claimed) !== registrableDomain(host)) {
    return { risk: 'mismatch', host };
  }

  return { risk: null, host };
}
