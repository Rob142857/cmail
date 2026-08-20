import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countryName } from '$lib/countries';
import { audit, generateId } from '$lib/server/db';
import { loadOrgSettings } from '$lib/server/org-settings';
import { detectProvider, sendEmail } from '$lib/server/outbound';
import { formatUtcTimestamp } from '$lib/server/travel';
import { escapeHtml, textField } from '$lib/server/validation';

const PENDING_LIMIT = 200;
const RECENT_LIMIT = 20;
const EXCEPTIONS_LIMIT = 200;

const DURATION_SECONDS: Record<string, number> = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};
const DURATION_LABEL: Record<string, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

interface PendingRow {
  id: string;
  user_id: string;
  country: string;
  created_epoch: number;
  display_name: string;
  email: string;
  denied_count: number;
}
interface DecisionRow {
  id: string;
  country: string;
  status: 'approved' | 'denied';
  decided_epoch: number | null;
  display_name: string;
  email: string;
  decided_by_name: string | null;
}
interface ExceptionRow {
  id: string;
  country: string;
  created_epoch: number;
  expires_epoch: number;
  display_name: string;
  email: string;
  approved_by_name: string | null;
}

function isManager(locals: App.Locals): boolean {
  return !!locals.user && locals.user.role === 'manager';
}

function toIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { pending: [], decisions: [], exceptions: [], unavailable: true };

  const nowEpoch = Math.floor(Date.now() / 1000);
  try {
    const [pendingResult, decisionsResult, exceptionsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT r.id, r.user_id, r.country, r.created_epoch,
                u.display_name, u.email,
                (SELECT COUNT(*) FROM signin_country_requests d
                   WHERE d.user_id = r.user_id AND d.country = r.country AND d.status = 'denied') AS denied_count
         FROM signin_country_requests r
         INNER JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending'
         ORDER BY r.created_epoch ASC
         LIMIT ?`,
      ).bind(PENDING_LIMIT).all<PendingRow>(),
      env.DB.prepare(
        `SELECT r.id, r.country, r.status, r.decided_epoch,
                u.display_name, u.email,
                m.display_name AS decided_by_name
         FROM signin_country_requests r
         INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN users m ON m.id = r.decided_by
         WHERE r.status IN ('approved', 'denied')
         ORDER BY r.decided_epoch DESC, r.id DESC
         LIMIT ?`,
      ).bind(RECENT_LIMIT).all<DecisionRow>(),
      env.DB.prepare(
        `SELECT e.id, e.country, e.created_epoch, e.expires_epoch,
                u.display_name, u.email,
                a.display_name AS approved_by_name
         FROM signin_country_exceptions e
         INNER JOIN users u ON u.id = e.user_id
         LEFT JOIN users a ON a.id = e.approved_by
         WHERE e.expires_epoch > ?
         ORDER BY e.expires_epoch ASC
         LIMIT ?`,
      ).bind(nowEpoch, EXCEPTIONS_LIMIT).all<ExceptionRow>(),
    ]);

    return {
      pending: (pendingResult.results || []).map((row) => ({
        id: row.id,
        country: row.country,
        countryLabel: countryName(row.country),
        displayName: row.display_name,
        email: row.email,
        requestedAt: toIso(row.created_epoch),
        deniedCount: row.denied_count,
      })),
      decisions: (decisionsResult.results || []).map((row) => ({
        id: row.id,
        country: row.country,
        countryLabel: countryName(row.country),
        status: row.status,
        displayName: row.display_name,
        email: row.email,
        decidedByName: row.decided_by_name,
        decidedAt: row.decided_epoch ? toIso(row.decided_epoch) : null,
      })),
      exceptions: (exceptionsResult.results || []).map((row) => ({
        id: row.id,
        country: row.country,
        countryLabel: countryName(row.country),
        displayName: row.display_name,
        email: row.email,
        approvedByName: row.approved_by_name,
        createdAt: toIso(row.created_epoch),
        expiresAt: toIso(row.expires_epoch),
      })),
      unavailable: false,
    };
  } catch (e) {
    console.error('Failed to load travel approvals data:', e);
    return { pending: [], decisions: [], exceptions: [], unavailable: true };
  }
};

function travelApprovedEmail(options: { label: string; countryLabel: string; untilLabel: string }): { subject: string; html: string; text: string } {
  const subject = `Your sign-in from ${options.countryLabel} is approved`;
  const person = escapeHtml(options.label);
  const country = escapeHtml(options.countryLabel);
  const until = escapeHtml(options.untilLabel);
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
    .muted { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <p>Hi ${person},</p>
      <p>Your sign-in from <strong>${country}</strong> is approved until <strong>${until}</strong>. You can sign in normally from there until then.</p>
      <p class="muted">After that, a sign-in from ${country} will need approval again unless it's added to your organisation's regular approved list.</p>
    </div>
  </div>
</body>
</html>`;
  const text = `Hi ${options.label},

Your sign-in from ${options.countryLabel} is approved until ${options.untilLabel}. You can sign in normally from there until then.

After that, a sign-in from ${options.countryLabel} will need approval again unless it's added to your organisation's regular approved list.`;
  return { subject, html, text };
}

export const actions: Actions = {
  approve: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    const duration = textField(form.get('duration'), 10);
    if (!id || !duration || !(duration in DURATION_SECONDS)) {
      return fail(400, { error: 'Choose a request and a duration' });
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const pending = await env.DB.prepare(
      `SELECT r.user_id, r.country, u.email, u.display_name
       FROM signin_country_requests r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.id = ? AND r.status = 'pending'`,
    ).bind(id).first<{ user_id: string; country: string; email: string; display_name: string }>();
    if (!pending) return fail(404, { error: 'Request not found or already decided' });

    const expiresEpoch = nowEpoch + DURATION_SECONDS[duration];

    // Claim the request first, with the same `status = 'pending'` guard as
    // the SELECT above — only on a real win (one row changed) do we create
    // the exception. Two managers racing to decide the same request would
    // otherwise both pass the SELECT and both unconditionally insert an
    // exception, even though only one decision should have "won".
    const decided = await env.DB.prepare(
      `UPDATE signin_country_requests SET status = 'approved', decided_by = ?, decided_epoch = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(locals.user!.id, nowEpoch, id).run();
    if (!Number(decided.meta.changes || 0)) return fail(409, { error: 'Request was already decided' });

    await env.DB.prepare(
      `INSERT INTO signin_country_exceptions (id, user_id, country, approved_by, created_epoch, expires_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(generateId(), pending.user_id, pending.country, locals.user!.id, nowEpoch, expiresEpoch).run();

    const countryLabel = countryName(pending.country);
    await audit(env.DB, {
      event_type: 'user.travel_approved',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: pending.user_id,
      detail: `Approved sign-in from ${countryLabel} (${pending.country}) for ${DURATION_LABEL[duration]}`,
    });

    const envForOutbound = env as unknown as Record<string, unknown>;
    const settings = await loadOrgSettings(envForOutbound);
    const provider = detectProvider(envForOutbound);
    if (provider === 'none' || !settings.systemEmail) {
      await audit(env.DB, {
        event_type: 'email.failed',
        actor_id: locals.user!.id,
        actor_role: 'manager',
        target: pending.user_id,
        detail: 'Travel approval notice undeliverable: no outbound provider or system From address configured',
      });
    } else {
      const { subject, html, text } = travelApprovedEmail({
        label: pending.display_name || pending.email,
        countryLabel,
        untilLabel: formatUtcTimestamp(expiresEpoch),
      });
      try {
        const result = await sendEmail(
          { from: settings.systemEmail, fromName: settings.systemFromName, to: pending.email, subject, html, text },
          envForOutbound,
        );
        if (!result.success) {
          await audit(env.DB, { event_type: 'email.failed', actor_id: locals.user!.id, actor_role: 'manager', target: pending.user_id, detail: 'Travel approval notice delivery failed' });
        }
      } catch (error) {
        console.error('Travel approval notice delivery failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
        await audit(env.DB, { event_type: 'email.failed', actor_id: locals.user!.id, actor_role: 'manager', target: pending.user_id, detail: 'Travel approval notice delivery failed' });
      }
    }

    return { success: `Approved ${pending.display_name || pending.email} from ${countryLabel} for ${DURATION_LABEL[duration]}` };
  },

  deny: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    if (!id) return fail(400, { error: 'Choose a request' });

    const nowEpoch = Math.floor(Date.now() / 1000);
    const pending = await env.DB.prepare(
      `SELECT r.user_id, r.country, u.email, u.display_name
       FROM signin_country_requests r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.id = ? AND r.status = 'pending'`,
    ).bind(id).first<{ user_id: string; country: string; email: string; display_name: string }>();
    if (!pending) return fail(404, { error: 'Request not found or already decided' });

    const decided = await env.DB.prepare(
      `UPDATE signin_country_requests SET status = 'denied', decided_by = ?, decided_epoch = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(locals.user!.id, nowEpoch, id).run();
    if (!Number(decided.meta.changes || 0)) return fail(409, { error: 'Request was already decided' });

    await audit(env.DB, {
      event_type: 'user.travel_denied',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: pending.user_id,
      detail: `Denied sign-in from ${countryName(pending.country)} (${pending.country})`,
    });

    return { success: `Denied ${pending.display_name || pending.email} from ${countryName(pending.country)}` };
  },

  revoke: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    if (!id) return fail(400, { error: 'Choose an exception' });

    const existing = await env.DB.prepare(
      `SELECT user_id, country FROM signin_country_exceptions WHERE id = ?`,
    ).bind(id).first<{ user_id: string; country: string }>();
    if (!existing) return fail(404, { error: 'Exception not found' });

    const result = await env.DB.prepare(`DELETE FROM signin_country_exceptions WHERE id = ?`).bind(id).run();
    if (!Number(result.meta.changes || 0)) return fail(404, { error: 'Exception was already revoked' });

    await audit(env.DB, {
      event_type: 'user.travel_exception_revoked',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: existing.user_id,
      detail: `Revoked sign-in exception for ${countryName(existing.country)} (${existing.country})`,
    });

    return { success: `Revoked the exception for ${countryName(existing.country)}` };
  },
};
