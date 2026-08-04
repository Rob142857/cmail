import type { MessageImportance } from './types';

export interface MessageHeaderEntry {
  key: string;
  value: string;
}

const MAX_HEADER_VALUE_CHARS = 128;

function boundedHeaderValue(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, MAX_HEADER_VALUE_CHARS)
      .toLowerCase()
    : '';
}

export function normalizeMessageImportance(value: unknown): MessageImportance {
  return value === 'high' || value === 'low' ? value : 'normal';
}

/**
 * Normalise the standard Importance field and widely deployed Exchange-era
 * compatibility fields. Importance wins when valid; malformed fields fall
 * through without affecting delivery, filtering, or transport priority.
 */
export function parseMessageImportance(headers: readonly MessageHeaderEntry[] | undefined): MessageImportance {
  const values = new Map<string, string>();
  for (const header of headers || []) {
    const name = typeof header?.key === 'string' ? header.key.trim().toLowerCase() : '';
    if (name && !values.has(name)) values.set(name, boundedHeaderValue(header.value));
  }

  const importance = values.get('importance');
  if (importance === 'high' || importance === 'low' || importance === 'normal') return importance;

  const priority = values.get('priority');
  if (priority === 'urgent') return 'high';
  if (priority === 'non-urgent') return 'low';
  if (priority === 'normal') return 'normal';

  const xPriority = values.get('x-priority')?.match(/^([1-5])(?:\D|$)/)?.[1];
  if (xPriority === '1' || xPriority === '2') return 'high';
  if (xPriority === '4' || xPriority === '5') return 'low';
  if (xPriority === '3') return 'normal';

  const microsoftPriority = values.get('x-msmail-priority');
  if (microsoftPriority === 'high') return 'high';
  if (microsoftPriority === 'low') return 'low';
  return 'normal';
}

/** Sender-authored human importance. This never changes SMTP delivery priority. */
export function messageImportanceHeaders(importance: MessageImportance | undefined): Record<string, string> | undefined {
  if (importance === 'high') {
    return {
      'Importance': 'high',
      'X-Priority': '1 (Highest)',
      'X-MSMail-Priority': 'High',
    };
  }
  if (importance === 'low') {
    return {
      'Importance': 'low',
      'X-Priority': '5 (Lowest)',
      'X-MSMail-Priority': 'Low',
    };
  }
  return undefined;
}
