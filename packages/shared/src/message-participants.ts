import type { MessageParticipant } from './types';

export type { MessageParticipant } from './types';

const DOT_ATOM_LOCAL_RX = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const QUOTED_LOCAL_RX = /^"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"$/;
const DOMAIN_NAME_RX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOMAIN_LITERAL_RX = /^\[(?:[\x21-\x5a\x5e-\x7e]|\\[\x20-\x7e])+\]$/;
const MAX_ADDRESS_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_PARTICIPANTS = 100;

/** Canonical ASCII addr-spec used for routing. SMTPUTF8 requires an explicit
 * end-to-end capability decision; it must never be silently rewritten here. */
export function normalizeParticipantAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  if (
    !address
    || address.length > MAX_ADDRESS_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/.test(address)
  ) return null;

  // The delimiter is the final @ because a quoted local-part may itself
  // contain @. PostalMime has already separated display names and groups;
  // this validates the resulting RFC addr-spec without narrowing it to the
  // common dot-atom-only form.
  const delimiter = address.lastIndexOf('@');
  if (delimiter <= 0 || delimiter === address.length - 1) return null;
  const local = address.slice(0, delimiter);
  const domain = address.slice(delimiter + 1);
  if (local.length > 64 || domain.length > 255) return null;
  if (!DOT_ATOM_LOCAL_RX.test(local) && !QUOTED_LOCAL_RX.test(local)) return null;
  if (!DOMAIN_NAME_RX.test(domain) && !DOMAIN_LITERAL_RX.test(domain)) return null;
  return address;
}

/** Display-only decoded name: no controls, header folding, or unbounded data. */
export function sanitizeParticipantName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const collapsed = value
    // C0/C1 controls and explicit bidi overrides/isolation controls can make
    // the visible identity disagree with its underlying text. Natural RTL
    // letters remain untouched; only invisible formatting controls are gone.
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(collapsed).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
}

export function participant(address: unknown, name?: unknown): MessageParticipant | null {
  const normalized = normalizeParticipantAddress(address);
  if (!normalized) return null;
  const displayName = sanitizeParticipantName(name);
  return {
    address: normalized,
    name: displayName.toLowerCase() === normalized ? '' : displayName,
  };
}

/**
 * Bounds and de-duplicates an already MIME-parsed participant list. The first
 * valid occurrence wins so header order remains stable for display.
 */
export function normalizeParticipants(values: readonly MessageParticipant[]): MessageParticipant[] {
  const result: MessageParticipant[] = [];
  const seen = new Map<string, number>();
  for (const value of values) {
    const parsed = participant(value?.address, value?.name);
    if (!parsed) continue;
    const existingIndex = seen.get(parsed.address);
    if (existingIndex !== undefined) {
      // Keep the first header position, but do not throw away a later decoded
      // name when the first occurrence contained only the address.
      if (!result[existingIndex]?.name && parsed.name) result[existingIndex] = parsed;
      continue;
    }
    seen.set(parsed.address, result.length);
    result.push(parsed);
    if (result.length >= MAX_PARTICIPANTS) break;
  }
  return result;
}

export function serializeParticipants(values: readonly MessageParticipant[]): string {
  return JSON.stringify(normalizeParticipants(values));
}
