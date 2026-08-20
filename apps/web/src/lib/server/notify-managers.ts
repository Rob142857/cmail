// A small, content-agnostic broadcast: email every active manager. Used by
// travel.ts's recordTravelRequest, and available for any future notice that
// needs to reach the manager group rather than one specific person.
import { audit } from './db';
import { loadOrgSettings } from './org-settings';
import { detectProvider, sendEmail } from './outbound';
import { consumeRateLimit } from './rate-limit';
import type { Env } from '@cmail/shared/types';

const GLOBAL_LIMIT = 20;
const GLOBAL_WINDOW_SECONDS = 60 * 60; // 1 hour

export interface ManagerNotification {
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email addressed to every active manager. A global cap
 * (20/hour, shared across every notification kind) is checked first so a
 * misbehaving or abused trigger can't turn into a mail flood — when it's
 * exhausted the notification is dropped (never queued) and the refusal is
 * audited. Mirrors how the OTP request action loads org settings and
 * detects the outbound provider, and audits `email.failed` the same way on
 * misconfiguration or delivery failure.
 */
export async function notifyManagers(env: Env, message: ManagerNotification): Promise<{ recipients: number }> {
  const db = env.DB;

  const limit = await consumeRateLimit(db, 'mgr_notify', 'global', GLOBAL_LIMIT, GLOBAL_WINDOW_SECONDS);
  if (!limit.allowed) {
    await audit(db, {
      event_type: 'security.rate_limit',
      detail: 'Manager notification suppressed by the global rate limit',
    });
    return { recipients: 0 };
  }

  const managers = await db.prepare(
    `SELECT email FROM users WHERE role = 'manager' AND status = 'active'`,
  ).all<{ email: string }>();
  const recipients = (managers.results || []).map((row) => row.email).filter(Boolean);
  if (!recipients.length) return { recipients: 0 };

  const envForOutbound = env as unknown as Record<string, unknown>;
  const settings = await loadOrgSettings(envForOutbound);
  const provider = detectProvider(envForOutbound);
  if (provider === 'none' || !settings.systemEmail) {
    // A deployment misconfiguration an operator needs to see — never
    // surfaced to whoever's action triggered the notification.
    await audit(db, {
      event_type: 'email.failed',
      detail: 'Manager notification undeliverable: no outbound provider or system From address configured',
    });
    return { recipients: 0 };
  }

  try {
    const result = await sendEmail(
      {
        from: settings.systemEmail,
        fromName: settings.systemFromName,
        to: recipients,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      envForOutbound,
    );
    if (!result.success) {
      await audit(db, { event_type: 'email.failed', detail: `Manager notification delivery failed: ${message.subject.slice(0, 200)}` });
      return { recipients: 0 };
    }
  } catch (error) {
    console.error('Manager notification delivery failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    await audit(db, { event_type: 'email.failed', detail: `Manager notification delivery failed: ${message.subject.slice(0, 200)}` });
    return { recipients: 0 };
  }

  return { recipients: recipients.length };
}
