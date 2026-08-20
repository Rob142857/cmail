// Sign-in country policy: gates every authentication method (Google,
// Microsoft, and email one-time code) on the organisation's approved
// sign-in countries (org_settings.sign_in_countries — see org-settings.ts),
// checked after identity is established but before a session is created.
//
// A sign-in from outside the list is refused. The refusal creates (or
// reuses) a pending travel request for that (user, country) pair, notifies
// every active manager by email — throttled so repeated attempts don't spam
// the org — and the caller audits the denial and tells the person plainly
// that a manager needs to approve it. A manager can grant a temporary
// per-user, per-country exception from /admin/travel; an unexpired exception
// satisfies the gate exactly like being on the approved list.
//
// The first-manager bootstrap flow (routes/auth/callback/[provider]) is
// deliberately exempt from this gate — see the comment at its call site.
import { escapeHtml } from './validation';
import { generateId } from './db';
import { countryName } from '$lib/countries';
import { notifyManagers } from './notify-managers';
import type { OrgSettings } from './org-settings';
import type { Env, User } from '@cmail/shared/types';

/** Uppercased CF-IPCountry, or 'XX' when absent/malformed (e.g. local dev). */
export function requestCountry(request: Request): string {
  const raw = (request.headers.get('cf-ipcountry') || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : 'XX';
}

/**
 * `allowedCountries` empty means no restriction is configured — every
 * country passes. This single "empty = unrestricted" contract is shared by
 * both the authenticated per-user gate below and the OTP request action's
 * pre-authentication neutral check, so there is exactly one meaning of
 * "empty" anywhere sign-in geography is evaluated.
 */
export function countryAllowed(country: string, allowedCountries: string[]): boolean {
  return allowedCountries.length === 0 || allowedCountries.includes(country);
}

export type SignInCountryDecision = { allowed: true } | { allowed: false };

/**
 * The post-authentication gate. Call this once identity is fully resolved
 * (a real `users` row) and eligibility already checked (active, not
 * paused/offboarded, role permitted for this sign-in method) — this
 * function only ever decides geography, nothing else.
 *
 * 'XX' (country header absent or unparsable — local dev, or a request that
 * didn't pass through Cloudflare) is deliberately NOT exempted once the
 * feature is on: it can never appear in a real approved-country list or a
 * legitimately-granted exception, so it fails closed here exactly like any
 * other country that isn't on the list. This falls out of the plain
 * membership/exception checks below without special-casing — documented
 * here so nobody "fixes" it by exempting XX. Local deployments are
 * unaffected in practice because the feature defaults off (empty list),
 * which is short-circuited first.
 */
export async function signInCountryGate(
  db: D1Database,
  settings: Pick<OrgSettings, 'signInCountries'>,
  options: { userId: string; country: string; nowEpoch?: number },
): Promise<SignInCountryDecision> {
  if (settings.signInCountries.length === 0) return { allowed: true }; // feature off

  if (countryAllowed(options.country, settings.signInCountries)) {
    return { allowed: true };
  }

  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);
  const exception = await db.prepare(
    `SELECT id FROM signin_country_exceptions
     WHERE user_id = ? AND country = ? AND expires_epoch > ?
     LIMIT 1`,
  ).bind(options.userId, options.country, nowEpoch).first<{ id: string }>();

  return exception ? { allowed: true } : { allowed: false };
}

/** e.g. "20 Aug 2026, 14:32 UTC" — used in the travel-approval emails. */
export function formatUtcTimestamp(epochSeconds: number): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(epochSeconds * 1000));
  return `${formatted} UTC`;
}

/**
 * Shown to the person on a denied sign-in. Reused verbatim by both the OTP
 * verify action (inline form error) and the landing page's `errorMessages`
 * map (the OAuth callback can only pass a redirect code, not this server
 * module, across the client/server import boundary — keep that copy in sync
 * with this one; +page.svelte carries a comment pointing back here).
 */
export const COUNTRY_PENDING_MESSAGE =
  "This sign-in came from outside your organisation's approved countries. Your managers have been notified — try again once a manager approves it.";

const MANAGER_NOTIFY_THROTTLE_SECONDS = 6 * 60 * 60; // 6 hours

function travelRequestEmail(options: {
  label: string;
  email: string;
  countryLabel: string;
  appUrl: string;
  whenLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Sign-in approval needed: ${options.label} from ${options.countryLabel}`;
  const link = `${options.appUrl}/admin/travel`;
  const person = escapeHtml(options.label);
  const country = escapeHtml(options.countryLabel);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #f7f8fa; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 0 auto; padding: 32px 20px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; }
    p { margin: 12px 0; color: #374151; }
    .btn { display: inline-block; margin-top: 8px; padding: 11px 22px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; }
    .muted { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <p><strong>${person}</strong> (${escapeHtml(options.email)}) tried to sign in from <strong>${country}</strong> at ${escapeHtml(options.whenLabel)} — outside this organisation's approved sign-in countries.</p>
      <p><a class="btn" href="${escapeHtml(link)}">Review in Travel approvals</a></p>
      <p class="muted">Automated notice. Grant a temporary exception there if this is expected travel.</p>
    </div>
  </div>
</body>
</html>`;
  const text = `${options.label} (${options.email}) tried to sign in from ${options.countryLabel} at ${options.whenLabel} — outside this organisation's approved sign-in countries.

Review and grant a temporary exception if this is expected:
${link}

Automated notice.`;
  return { subject, html, text };
}

/**
 * Upserts the pending request for (user, country) — a no-op when one is
 * already outstanding, since the partial unique index on
 * (user_id, country) WHERE status = 'pending' absorbs the conflict — then
 * notifies managers, but only when the last notification for this exact
 * pair is missing or older than six hours. The throttle update's
 * `RETURNING` makes exactly one caller "win" under concurrent denials for
 * the same pair, so they can't double-send.
 */
export async function recordTravelRequest(
  db: D1Database,
  env: Env,
  options: { user: User; country: string; appUrl: string; nowEpoch?: number },
): Promise<void> {
  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);

  await db.prepare(
    `INSERT INTO signin_country_requests (id, user_id, country, status, created_epoch)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT (user_id, country) WHERE status = 'pending' DO NOTHING`,
  ).bind(generateId(), options.user.id, options.country, nowEpoch).run();

  const pending = await db.prepare(
    `SELECT id FROM signin_country_requests WHERE user_id = ? AND country = ? AND status = 'pending'`,
  ).bind(options.user.id, options.country).first<{ id: string }>();
  if (!pending) return; // shouldn't happen, but never notify about a request we can't find

  const throttleCutoff = nowEpoch - MANAGER_NOTIFY_THROTTLE_SECONDS;
  const claimed = await db.prepare(
    `UPDATE signin_country_requests
     SET last_notified_epoch = ?
     WHERE id = ? AND (last_notified_epoch IS NULL OR last_notified_epoch < ?)
     RETURNING id`,
  ).bind(nowEpoch, pending.id, throttleCutoff).first<{ id: string }>();
  if (!claimed) return; // another concurrent denial already claimed this notify window

  const { subject, html, text } = travelRequestEmail({
    label: options.user.display_name || options.user.email,
    email: options.user.email,
    countryLabel: countryName(options.country),
    appUrl: options.appUrl,
    whenLabel: formatUtcTimestamp(nowEpoch),
  });
  await notifyManagers(env, { subject, html, text });
}
