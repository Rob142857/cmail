import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '#lib/server/db.js';
import {
  authorizedRuleMailbox,
  createInboxRule,
  getInboxRule,
  listRuleMailboxes,
  parseRuleForm,
  pickRuleMailbox,
  runInboxRuleNow,
  RUN_NOW_LIMIT,
  updateInboxRule,
} from '#lib/server/inbox-rules.js';

/** A prefill value from "Create rule" on a message: bounded, single line. */
function prefill(value: string | null, max: number): string {
  return (value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) throw redirect(303, '/mail/rules');

  const mailboxes = await listRuleMailboxes(env.DB, locals.user.id);
  const mailbox = pickRuleMailbox(mailboxes, url.searchParams.get('mailbox'));
  if (!mailbox) throw redirect(303, '/mail/rules');

  const ruleId = url.searchParams.get('rule');
  if (ruleId) {
    const rule = await getInboxRule(env.DB, mailbox.id, ruleId);
    if (!rule) throw error(404, 'Rule not found');
    if (!rule.definition) throw redirect(303, `/mail/rules?mailbox=${encodeURIComponent(mailbox.id)}`);
    return {
      mailbox,
      runNowLimit: RUN_NOW_LIMIT,
      rule: { id: rule.id, name: rule.name, enabled: rule.enabled, stopProcessing: rule.stopProcessing, definition: rule.definition },
      prefill: null,
    };
  }
  return {
    mailbox,
    runNowLimit: RUN_NOW_LIMIT,
    rule: null,
    prefill: {
      from: prefill(url.searchParams.get('from'), 254),
      subject: prefill(url.searchParams.get('subject'), 200),
    },
  };
};

export const actions: Actions = {
  save: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });

    const form = await request.formData();
    const mailboxes = await listRuleMailboxes(env.DB, locals.user.id);
    const mailbox = authorizedRuleMailbox(mailboxes, form.get('mailbox_id'));
    if (!mailbox) return fail(403, { error: 'You need full access to a mailbox to manage its rules' });

    const parsed = parseRuleForm(form);
    if (!parsed.ok) return fail(400, { error: parsed.error });

    const ruleId = form.get('rule_id');
    let created = false;
    if (typeof ruleId === 'string' && ruleId) {
      const existing = await getInboxRule(env.DB, mailbox.id, ruleId);
      if (!existing || !await updateInboxRule(env.DB, mailbox.id, ruleId, locals.user.id, parsed)) {
        return fail(404, { error: 'That rule no longer exists' });
      }
    } else {
      const result = await createInboxRule(env.DB, mailbox.id, locals.user.id, parsed);
      if (!result.ok) return fail(400, { error: result.error });
      created = true;
    }
    await audit(env.DB, {
      event_type: created ? 'inbox_rule.create' : 'inbox_rule.update',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: mailbox.id,
      detail: `${created ? 'Created' : 'Updated'} inbox rule "${parsed.name}"${parsed.enabled ? '' : ' (off)'}`,
      session_id: locals.sessionId,
    });

    const params = new URLSearchParams({ mailbox: mailbox.id, saved: created ? 'created' : 'updated' });
    if (parsed.runNow) {
      const run = await runInboxRuleNow(env.DB, mailbox, parsed.definition);
      if (run.ok) {
        params.set('ran', String(run.matched));
        await audit(env.DB, {
          event_type: 'inbox_rule.run',
          actor_id: locals.user.id,
          actor_role: locals.user.role,
          target: mailbox.id,
          detail: `Ran inbox rule "${parsed.name}" on the Inbox: ${run.matched} of ${run.examined} messages matched`,
          session_id: locals.sessionId,
        });
      }
    }
    throw redirect(303, `/mail/rules?${params}`);
  },
};
