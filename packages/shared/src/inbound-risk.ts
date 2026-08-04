/**
 * Inbound spam scoring and first-contact detection.
 *
 * Cloudflare Email Routing already refuses mail that fails both SPF and DKIM,
 * violates the sender's DMARC policy, or arrives from an IP on a realtime
 * block list. What reaches the Worker has therefore cleared the coarse gate.
 * What it does *not* carry is an `Authentication-Results` header — Email
 * Routing does not stamp one on Worker deliveries (cloudflare/workerd#6740) —
 * so per-message SPF/DKIM/DMARC verdicts cannot be recorded from here.
 *
 * A spam score does come through, on `X-CF-SpamH-Score`. Cloudflare does not
 * document its scale, so this module records the score unconditionally but
 * quarantines nothing unless an operator sets an explicit threshold. Silently
 * filing mail into Junk against an undocumented scale would lose real mail,
 * and losing mail is far worse than showing a score.
 */

/**
 * Checked in order. The Cloudflare header is the one that actually arrives on
 * Email Routing deliveries; the others are conventional and cost nothing to
 * accept if the deployment sits behind a different boundary.
 */
export const SPAM_SCORE_HEADERS: readonly string[] = [
  'x-cf-spamh-score',
  'x-spam-score',
  'x-spamd-score',
];

/** Scores outside this range are malformed rather than extreme. */
const MIN_SCORE = -1000;
const MAX_SCORE = 1000;

/** Leading signed decimal, so `5.4/10` and `5.4 (spammy)` both parse. */
const SCORE_PATTERN = /^\s*([+-]?\d{1,4}(?:\.\d{1,4})?)/;

export function parseSpamScore(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = SCORE_PATTERN.exec(value);
  if (!match) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < MIN_SCORE || score > MAX_SCORE) return null;
  return score;
}

/** Reads the first spam score header present. Returns null when none is. */
export function readSpamScore(headers: { get(name: string): string | null }): number | null {
  for (const header of SPAM_SCORE_HEADERS) {
    const score = parseSpamScore(headers.get(header));
    if (score !== null) return score;
  }
  return null;
}

/**
 * Resolves the configured quarantine threshold. Returns null — meaning never
 * quarantine — for anything unset, blank, or unparseable. Requiring a
 * deliberate, valid number is the point: a typo must not start filing mail
 * into Junk.
 */
export function spamQuarantineThreshold(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= MIN_SCORE && value <= MAX_SCORE ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const threshold = Number(trimmed);
  if (!Number.isFinite(threshold) || threshold < MIN_SCORE || threshold > MAX_SCORE) return null;
  return threshold;
}

/** A message is quarantined only when both a score and a threshold exist. */
export function shouldQuarantine(score: number | null, threshold: number | null): boolean {
  if (score === null || threshold === null) return false;
  return score >= threshold;
}
