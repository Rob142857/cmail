const MESSAGE_ID_RX = /^<[^<>\s@]+@[^<>\s@]+>$/;
const IN_REPLY_TO_VALUE_BYTES = 998 - 'In-Reply-To'.length - 2;
const REFERENCES_VALUE_BYTES = 998 - 'References'.length - 2;
const ENCODER = new TextEncoder();

export interface StoredThreadingHeaders {
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
}

/** Validate one Message-ID for use as an In-Reply-To field body. */
export function safeMessageId(value: string): string | null {
  const trimmed = value.trim();
  return MESSAGE_ID_RX.test(trimmed)
    && ENCODER.encode(trimmed).byteLength <= IN_REPLY_TO_VALUE_BYTES
    ? trimmed
    : null;
}

/**
 * Keep a bounded, de-duplicated References ancestry. The root and newest tail
 * survive truncation, and the complete physical header remains within RFC
 * 5322's 998-character hard line limit after `References: ` is added.
 */
export function safeReferences(value: string): string | null {
  const bounded = value.length <= 4096
    ? value
    : `${value.slice(0, 998)} ${value.slice(-3098)}`;
  const parsed = bounded.match(/<[^<>\s@]+@[^<>\s@]+>/g) || [];
  const tokens = [...new Set(parsed.flatMap((token) => {
    const safe = safeMessageId(token);
    return safe ? [safe] : [];
  }))];
  const root = tokens[0];
  if (!root) return null;

  const tail: string[] = [];
  let byteLength = ENCODER.encode(root).byteLength;
  for (let index = tokens.length - 1; index > 0 && tail.length < 49; index -= 1) {
    const token = tokens[index];
    if (!token) continue;
    const nextLength = byteLength + 1 + ENCODER.encode(token).byteLength;
    if (nextLength > REFERENCES_VALUE_BYTES) break;
    tail.unshift(token);
    byteLength = nextLength;
  }
  return [root, ...tail].join(' ');
}

export function appendReference(existing: string | null, parent: string | null): string | null {
  return safeReferences([existing || '', safeMessageId(parent || '') || ''].filter(Boolean).join(' '));
}

/**
 * Build reply ancestry from stored headers. A provider-controlled message can
 * lack its own known wire Message-ID; in that case retain the nearest known
 * parent rather than silently breaking an established conversation.
 */
export function deriveReplyThreading(
  source: StoredThreadingHeaders,
): { inReplyTo: string | null; referencesHeader: string | null } {
  const sourceMessageId = safeMessageId(source.message_id_header || '');
  const inheritedReferences = safeReferences(source.references_header || '');
  const inheritedParent = safeMessageId(source.in_reply_to || '')
    || inheritedReferences?.split(' ').at(-1)
    || null;

  if (sourceMessageId) {
    return {
      inReplyTo: sourceMessageId,
      referencesHeader: appendReference(inheritedReferences || inheritedParent, sourceMessageId),
    };
  }

  return {
    inReplyTo: inheritedParent,
    referencesHeader: appendReference(inheritedReferences, inheritedParent),
  };
}
