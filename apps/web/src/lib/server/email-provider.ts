// Identifies which identity provider (Google or Microsoft) actually hosts a
// given email address, so invitations are only sent to addresses cmail can
// authenticate against. Well-known consumer domains are classified directly;
// everything else is resolved by an MX lookup over DNS-over-HTTPS, since
// Node's `dns` module is not available in the Workers runtime.

export type EmailProviderDetection = 'google' | 'microsoft' | 'unknown' | 'unverifiable';

// Conservative: only the first label followed by a plausible public-suffix
// tail (e.g. hotmail.com, hotmail.co.uk, hotmail.com.au). Deliberately does
// NOT match a lookalike like outlook.example.com.
const MICROSOFT_CONSUMER_DOMAIN_RX = /^(hotmail|live|outlook)\.[a-z]{2,3}(\.[a-z]{2})?$/;

/**
 * Classifies a domain as Google- or Microsoft-hosted purely from a
 * well-known list of consumer domains. Returns null for everything else,
 * including custom/business domains that merely happen to use Google
 * Workspace or Microsoft 365 — those are only detectable via MX lookup.
 */
export function classifyEmailDomain(domain: string): 'google' | 'microsoft' | null {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
  if (normalized === 'gmail.com' || normalized === 'googlemail.com') return 'google';
  if (normalized === 'msn.com') return 'microsoft';
  if (MICROSOFT_CONSUMER_DOMAIN_RX.test(normalized)) return 'microsoft';
  return null;
}

interface DnsAnswer {
  data?: string;
}

interface DohResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

function extractDomain(address: string): string | null {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at === -1 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1).replace(/\.$/, '');
  return domain || null;
}

function parseMxHost(data: string): string | null {
  const parts = data.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const host = parts[1];
  return host ? host.toLowerCase().replace(/\.$/, '') : null;
}

function isGoogleMxHost(host: string): boolean {
  return host.endsWith('.google.com') || host === 'smtp.google.com' || host.endsWith('.googlemail.com');
}

function isMicrosoftMxHost(host: string): boolean {
  return host.endsWith('.mail.protection.outlook.com') || host.endsWith('.olc.protection.outlook.com');
}

async function resolveProviderByMx(
  domain: string,
  fetcher: typeof fetch,
): Promise<EmailProviderDetection> {
  const init: RequestInit = { headers: { accept: 'application/dns-json' } };
  try {
    init.signal = AbortSignal.timeout(8000);
  } catch {
    // Runtime lacks AbortSignal.timeout — proceed without a client-side
    // timeout rather than failing the lookup outright.
  }

  let payload: DohResponse;
  try {
    const query = new URLSearchParams({ name: domain, type: 'MX' });
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?${query}`, init);
    if (!response.ok) return 'unverifiable';
    payload = await response.json();
  } catch {
    return 'unverifiable';
  }

  if (payload.Status === 3) return 'unknown'; // NXDOMAIN: domain doesn't exist
  if (payload.Status !== 0) return 'unverifiable';

  const hosts = (payload.Answer ?? [])
    .map((answer) => parseMxHost(answer?.data ?? ''))
    .filter((host): host is string => host !== null);

  if (hosts.some(isGoogleMxHost)) return 'google';
  if (hosts.some(isMicrosoftMxHost)) return 'microsoft';
  return 'unknown';
}

/**
 * Detects which identity provider hosts `address`'s mail, so an invitation
 * is only offered through a sign-in flow the recipient can actually use.
 * Well-known consumer domains resolve instantly; everything else is
 * resolved by an MX lookup over DNS-over-HTTPS. `fetcher` is injectable so
 * tests can stub the network call.
 */
export async function detectEmailProvider(
  address: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<EmailProviderDetection> {
  const domain = extractDomain(address);
  if (!domain) return 'unknown';

  const classified = classifyEmailDomain(domain);
  if (classified) return classified;

  return resolveProviderByMx(domain, fetcher);
}
