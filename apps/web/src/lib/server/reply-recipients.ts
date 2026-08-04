import { normalizeEmail } from './validation';

export interface ReplyRecipientSource {
  from_address: string;
  to_addresses: string;
  cc_addresses: string;
  reply_to_addresses: string;
  direction: string;
  folder: string;
}

function storedAddresses(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.flatMap((address) => {
        const normalized = typeof address === 'string' ? normalizeEmail(address) : null;
        return normalized ? [normalized] : [];
      })
      : [];
  } catch {
    return [];
  }
}

/**
 * Build Outlook-style Reply/Reply all recipients without sending copies back
 * to any active mailbox currently assigned to the user.
 */
export function buildReplyRecipients(
  source: ReplyRecipientSource,
  assignedAddresses: readonly string[],
  replyAll: boolean,
): { to: string[]; cc: string[] } {
  const self = new Set(assignedAddresses.flatMap((address) => {
    const normalized = normalizeEmail(address);
    return normalized ? [normalized] : [];
  }));
  const to: string[] = [];
  const cc: string[] = [];
  const seen = new Set(self);
  const add = (target: string[], address: string | null): void => {
    if (!address || seen.has(address)) return;
    seen.add(address);
    target.push(address);
  };

  const sourceIsOutgoing = source.direction === 'outbound' || source.folder === 'sent';
  const replyTo = storedAddresses(source.reply_to_addresses);
  if (!sourceIsOutgoing) {
    if (replyTo.length) {
      for (const address of replyTo) add(to, address);
    } else {
      add(to, normalizeEmail(source.from_address));
    }
  }

  // Replying from a Sent item targets its original recipients. Reply all also
  // retains co-recipients from an inbound message.
  if (sourceIsOutgoing || replyAll) {
    for (const address of storedAddresses(source.to_addresses)) add(to, address);
  }
  if (replyAll) {
    for (const address of storedAddresses(source.cc_addresses)) add(cc, address);
  }

  return { to, cc };
}

/** Show Reply all only when it adds a non-self recipient to an ordinary reply. */
export function replyAllAddsRecipients(
  source: ReplyRecipientSource,
  assignedAddresses: readonly string[],
): boolean {
  const reply = buildReplyRecipients(source, assignedAddresses, false);
  const replyAll = buildReplyRecipients(source, assignedAddresses, true);
  const ordinaryRecipients = new Set([...reply.to, ...reply.cc]);
  return [...replyAll.to, ...replyAll.cc]
    .some((address) => !ordinaryRecipients.has(address));
}
