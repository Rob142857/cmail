import { normalizeDomain, normalizeEmail } from '$lib/server/validation';

export const SENDER_RULE_ACTIONS = ['allow', 'block'] as const;
export type SenderRuleAction = (typeof SENDER_RULE_ACTIONS)[number];

/**
 * A sender rule pattern is either a full address or a bare domain, always
 * lowercased so matching against inbound mail is an exact, case-insensitive
 * comparison. Tries an address first (the common case — allowing or
 * blocking one sender) and falls back to a domain. Returns null when the
 * input is neither.
 */
export function parseSenderRulePattern(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeEmail(trimmed) || normalizeDomain(trimmed) || null;
}
