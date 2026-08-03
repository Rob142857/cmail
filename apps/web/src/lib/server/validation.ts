const EMAIL_RX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOMAIN_RX = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RX.test(email)) return null;
  return email;
}

export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
  return DOMAIN_RX.test(domain) ? domain : null;
}

export function isAddressAtDomain(address: string, domain: string): boolean {
  const email = normalizeEmail(address);
  const normalizedDomain = normalizeDomain(domain);
  return !!email && !!normalizedDomain && email.endsWith(`@${normalizedDomain}`);
}

export function normalizeMailboxLocalPart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const localPart = value.trim().toLowerCase();
  if (
    localPart.length < 1 ||
    localPart.length > 64 ||
    localPart.includes('..') ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(localPart)
  ) {
    return null;
  }
  return localPart;
}

export function parseRecipientList(
  value: unknown,
  maxRecipients: number,
): { recipients: string[]; error?: string } {
  if (typeof value !== 'string') return { recipients: [], error: 'Recipient list is invalid' };

  const raw = value.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  if (raw.length > maxRecipients) {
    return { recipients: [], error: `A message can have at most ${maxRecipients} recipients` };
  }

  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const email = normalizeEmail(entry);
    if (!email) return { recipients: [], error: `Invalid email address: ${entry.slice(0, 80)}` };
    if (!seen.has(email)) {
      seen.add(email);
      recipients.push(email);
    }
  }
  return { recipients };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

export function htmlToPlainText(value: string): string {
  return value
    .replace(/<(br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function textField(value: FormDataEntryValue | null, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}
