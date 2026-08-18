import { fail } from '@sveltejs/kit';
import type { Env } from '@cmail/shared/types';
import type { Actions, PageServerLoad } from './$types';
import { audit, generateId } from '$lib/server/db';
import { textField } from '$lib/server/validation';
import { parseSenderRulePattern, type SenderRuleAction } from './quarantine-rules';

const PAGE_SIZE = 50;
const RULES_LIMIT = 500;

export interface QuarantinedMessageRow {
  id: string;
  subject: string;
  from_address: string;
  from_name: string;
  spam_score: number | null;
  quarantine_reason: string | null;
  received_at: string;
  mailbox_id: string;
  mailbox_address: string;
  mailbox_display_name: string;
}

export interface SenderRuleRow {
  id: string;
  pattern: string;
  action: SenderRuleAction;
  note: string | null;
  created_at: string;
}

function isManager(locals: App.Locals): boolean {
  return !!locals.user && locals.user.role === 'manager';
}

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { messages: [], total: 0, page: 1, totalPages: 1, rules: [], unavailable: true };

  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const [messagesResult, totalRow, rulesResult] = await Promise.all([
      env.DB.prepare(
        `SELECT m.id, m.subject, m.from_address, m.from_name, m.spam_score, m.quarantine_reason,
                m.received_at, m.mailbox_id, mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
         FROM messages m
         INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE m.folder = 'spam'
         ORDER BY m.received_at DESC, m.id DESC
         LIMIT ? OFFSET ?`,
      ).bind(PAGE_SIZE, offset).all<QuarantinedMessageRow>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM messages WHERE folder = 'spam'`).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT id, pattern, action, note, created_at FROM sender_rules ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(RULES_LIMIT).all<SenderRuleRow>(),
    ]);

    const total = totalRow?.count || 0;
    return {
      messages: messagesResult.results || [],
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rules: rulesResult.results || [],
      unavailable: false,
    };
  } catch (e) {
    console.error('Failed to load quarantine data:', e);
    return { messages: [], total: 0, page, totalPages: 1, rules: [], unavailable: true };
  }
};

/** Resolves the sender_rules pattern from either a specific message's sender or a typed value. */
async function resolveRulePattern(db: D1Database, form: FormData): Promise<{ pattern: string } | { error: string }> {
  const messageId = textField(form.get('message_id'), 100);
  if (messageId) {
    const message = await db.prepare('SELECT from_address FROM messages WHERE id = ?').bind(messageId).first<{ from_address: string }>();
    if (!message) return { error: 'Message not found' };
    const pattern = parseSenderRulePattern(message.from_address);
    if (!pattern) return { error: 'This message has no usable sender address' };
    return { pattern };
  }
  const pattern = parseSenderRulePattern(form.get('pattern'));
  if (!pattern) return { error: 'Enter a valid email address or domain' };
  return { pattern };
}

async function upsertSenderRule(
  env: Env,
  actorId: string,
  form: FormData,
  ruleAction: SenderRuleAction,
): Promise<{ error: string } | { success: string }> {
  const resolved = await resolveRulePattern(env.DB, form);
  if ('error' in resolved) return { error: resolved.error };
  const note = textField(form.get('note'), 500) || null;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO sender_rules (id, pattern, action, note, created_at, created_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
  ).bind(generateId(), resolved.pattern, ruleAction, note, actorId).run();

  await audit(env.DB, {
    event_type: ruleAction === 'allow' ? 'spam.sender_allowed' : 'spam.sender_blocked',
    actor_id: actorId,
    actor_role: 'manager',
    target: resolved.pattern,
    detail: `${ruleAction === 'allow' ? 'Allowed' : 'Blocked'} sender ${resolved.pattern}`,
  });
  return { success: ruleAction === 'allow' ? `Allowed ${resolved.pattern}` : `Blocked ${resolved.pattern}` };
}

export const actions: Actions = {
  release: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    if (!id) return fail(400, { error: 'Choose a message' });

    const result = await env.DB.prepare(
      `UPDATE messages SET folder = 'inbox' WHERE id = ? AND folder = 'spam'`,
    ).bind(id).run();
    if (!Number(result.meta.changes || 0)) return fail(404, { error: 'Message is not in quarantine' });

    await audit(env.DB, {
      event_type: 'email.released',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: id,
      detail: 'Released message from quarantine to inbox',
    });
    return { success: 'Message moved to inbox' };
  },

  remove: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    if (!id) return fail(400, { error: 'Choose a message' });

    const result = await env.DB.prepare(
      `UPDATE messages SET folder = 'trash' WHERE id = ? AND folder = 'spam'`,
    ).bind(id).run();
    if (!Number(result.meta.changes || 0)) return fail(404, { error: 'Message is not in quarantine' });

    await audit(env.DB, {
      event_type: 'email.quarantine_deleted',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: id,
      detail: 'Deleted message from quarantine',
    });
    return { success: 'Message deleted' };
  },

  allowSender: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const result = await upsertSenderRule(env, locals.user!.id, form, 'allow');
    return 'error' in result ? fail(400, result) : result;
  },

  blockSender: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const result = await upsertSenderRule(env, locals.user!.id, form, 'block');
    return 'error' in result ? fail(400, result) : result;
  },

  removeRule: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const id = textField(form.get('id'), 100);
    if (!id) return fail(400, { error: 'Choose a rule' });

    const existing = await env.DB.prepare('SELECT pattern FROM sender_rules WHERE id = ?').bind(id).first<{ pattern: string }>();
    if (!existing) return fail(404, { error: 'Rule not found' });

    await env.DB.prepare('DELETE FROM sender_rules WHERE id = ?').bind(id).run();

    await audit(env.DB, {
      event_type: 'spam.rule_removed',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: existing.pattern,
      detail: `Removed sender rule for ${existing.pattern}`,
    });
    return { success: 'Rule removed' };
  },
};
