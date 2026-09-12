import {
  outboundRateLimitPerHour,
  outboundWorkLimitPerHour,
} from './config';
import { consumeRateLimit } from './rate-limit';

type CalendarOutboundResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: string };

/** Apply the same user-wide outbound budgets used by compose to calendar mail. */
export async function consumeCalendarOutboundLimits(
  db: D1Database,
  env: Record<string, unknown>,
  userId: string,
  recipientCount: number,
): Promise<CalendarOutboundResult> {
  try {
    const sendRate = await consumeRateLimit(
      db,
      'outbound',
      userId,
      outboundRateLimitPerHour(env),
      60 * 60,
    );
    if (!sendRate.allowed) {
      return {
        ok: false,
        status: 429,
        error: `Hourly send limit reached. Try again in about ${Math.ceil(sendRate.retryAfter / 60)} minutes.`,
      };
    }

    const workRate = await consumeRateLimit(
      db,
      'outbound-work',
      userId,
      outboundWorkLimitPerHour(env),
      60 * 60,
      Math.max(1, recipientCount),
    );
    if (!workRate.allowed) {
      return {
        ok: false,
        status: 429,
        error: `Hourly recipient and attachment limit reached. Try again in about ${Math.ceil(workRate.retryAfter / 60)} minutes.`,
      };
    }
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Couldn\'t check sending limits right now. Try again shortly.',
    };
  }

  return { ok: true };
}
