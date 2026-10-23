import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { describeActions, describeConditions, MAX_RULES_PER_MAILBOX } from '@cmail/shared/inbox-rules';
import { audit } from '#lib/server/db.js';
import {
  RUN_NOW_LIMIT,
  authorizedRuleMailbox,
  deleteInboxRule,
  getInboxRule,
  listInboxRules,
  listRuleMailboxes,
  moveInboxRule,
  pickRuleMailbox,
  runInboxRuleNow,
  setInboxRuleEnabled,
} from '#lib/server/inbox-rules.js';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) return { mailboxes: [], mailbox: null, rules: [], maxRules: MAX_RULES_PER_MAILBOX, runNowLimit: RUN_NOW_LIMIT };

  const mailboxes = await listRuleMailboxes(env.DB, locals.user.id);
  const mailbox = pickRuleMailbox(mailboxes, url.searchParams.get('mailbox'));
  const rules = mailbox ? await listInboxRules(env.DB, mailbox.id) : [];
  return {
    mailboxes,
    mailbox,
    maxRules: MAX_RULES_PER_MAILBOX,
    runNowLimit: RUN_NOW_LIMIT,
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      stopProcessing: rule.stopProcessing,
      canRunNow: rule.canRunNow,
      valid: !!rule.definition,
      conditions: rule.definition
        ? rule.definition.appliesToAll ? ['All messages'] : describeConditions(rule.definition.conditions)
        : [],
      exceptions: rule.definition ? describeConditions(rule.definition.exceptions) : [],
      actions: rule.definition ? describeActions(rule.definition.actions) : [],
    })),
  };
};

/** The mailbox and rule a list action names, checked against what this user may manage. */
async function target(event: RequestEvent) {
  if (!event.locals.user) throw redirect(303, '/');
  const env = event.platform?.env;
  if (!env) return { error: fail(503, { error: 'Service configuration is unavailable' }) } as const;
  const form = await event.request.formData();
  const mailboxes = await listRuleMailboxes(env.DB, event.locals.user.id);
  const mailbox = authorizedRuleMailbox(mailboxes, form.get('mailbox_id'));
  if (!mailbox) return { error: fail(403, { error: 'You need full access to a mailbox to manage its rules' }) } as const;
  const ruleId = form.get('rule_id');
  const rule = typeof ruleId === 'string' ? await getInboxRule(env.DB, mailbox.id, ruleId) : null;
  if (!rule) return { error: fail(404, { error: 'That rule no longer exists' }) } as const;
  return { env, user: event.locals.user, form, mailbox, rule } as const;
}

export const actions: Actions = {
  toggle: async (event) => {
    const context = await target(event);
    if ('error' in context) return context.error;
    const { env, user, mailbox, rule } = context;
    const enabled = !rule.enabled;
    await setInboxRuleEnabled(env.DB, mailbox.id, rule.id, user.id, enabled);
    await audit(env.DB, {
      event_type: enabled ? 'inbox_rule.enable' : 'inbox_rule.disable',
      actor_id: user.id,
      actor_role: user.role,
      target: mailbox.id,
      detail: `${enabled ? 'Turned on' : 'Turned off'} inbox rule "${rule.name}"`,
      session_id: event.locals.sessionId,
    });
    return { success: `"${rule.name}" is ${enabled ? 'on' : 'off'}.` };
  },

  move: async (event) => {
    const context = await target(event);
    if ('error' in context) return context.error;
    const { env, user, form, mailbox, rule } = context;
    const direction = form.get('direction');
    if (direction !== 'up' && direction !== 'down') return fail(400, { error: 'Choose up or down' });
    if (!await moveInboxRule(env.DB, mailbox.id, rule.id, direction)) {
      return fail(400, { error: `"${rule.name}" is already ${direction === 'up' ? 'first' : 'last'}.` });
    }
    await audit(env.DB, {
      event_type: 'inbox_rule.reorder',
      actor_id: user.id,
      actor_role: user.role,
      target: mailbox.id,
      detail: `Moved inbox rule "${rule.name}" ${direction}`,
      session_id: event.locals.sessionId,
    });
    return { success: `Moved "${rule.name}" ${direction}.` };
  },

  delete: async (event) => {
    const context = await target(event);
    if ('error' in context) return context.error;
    const { env, user, mailbox, rule } = context;
    await deleteInboxRule(env.DB, mailbox.id, rule.id);
    await audit(env.DB, {
      event_type: 'inbox_rule.delete',
      actor_id: user.id,
      actor_role: user.role,
      target: mailbox.id,
      detail: `Deleted inbox rule "${rule.name}"`,
      session_id: event.locals.sessionId,
    });
    return { success: `Deleted "${rule.name}".` };
  },

  run: async (event) => {
    const context = await target(event);
    if ('error' in context) return context.error;
    const { env, user, mailbox, rule } = context;
    if (!rule.definition) return fail(400, { error: 'This rule can no longer be read. Delete it and create it again.' });
    const result = await runInboxRuleNow(env.DB, mailbox, rule.definition);
    if (!result.ok) return fail(400, { error: result.error });
    await audit(env.DB, {
      event_type: 'inbox_rule.run',
      actor_id: user.id,
      actor_role: user.role,
      target: mailbox.id,
      detail: `Ran inbox rule "${rule.name}" on the Inbox: ${result.matched} of ${result.examined} messages matched`,
      session_id: event.locals.sessionId,
    });
    return {
      success: result.matched
        ? `"${rule.name}" applied to ${result.matched} ${result.matched === 1 ? 'message' : 'messages'} in the Inbox.`
        : `"${rule.name}" didn't match any of the ${result.examined} newest messages in the Inbox.`,
    };
  },
};
