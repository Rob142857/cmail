import {
  MAX_RULES_PER_MAILBOX,
  parseRuleDefinition,
  parseRuleName,
  ruleApplies,
  ruleDefinitionFromStorage,
  ruleNeedsBody,
  ruleNeedsHeaders,
  type InboxRuleDefinition,
} from '@cmail/shared/inbox-rules';
import type { MessageImportance } from '@cmail/shared/types';
import { generateId } from './db';

/** "Run rule now" looks at this many of the newest Inbox messages. */
export const RUN_NOW_LIMIT = 1000;
const MAX_DEFINITION_INPUT_CHARS = 32_768;
/** D1 allows 100 bound parameters per statement; leave room for the rest. */
const UPDATE_CHUNK = 90;

export interface RuleMailbox {
  id: string;
  address: string;
  display_name: string;
  type: 'personal' | 'shared';
}

export interface ListedInboxRule {
  id: string;
  name: string;
  enabled: boolean;
  stopProcessing: boolean;
  /** Null when the stored rule no longer validates; it is skipped on delivery. */
  definition: InboxRuleDefinition | null;
  /** Rules that test the body or headers can't run on mail already delivered. */
  canRunNow: boolean;
}

/** Mailboxes whose rules this user may manage: full permission, active. */
export async function listRuleMailboxes(db: D1Database, userId: string): Promise<RuleMailbox[]> {
  const { results } = await db.prepare(
    `SELECT m.id, m.address, m.display_name, m.type
     FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.id
     WHERE ma.user_id = ? AND ma.permissions = 'full' AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address ASC`,
  ).bind(userId).all<RuleMailbox>();
  return results || [];
}

/** The requested mailbox when the user may manage it, else their first one. */
export function pickRuleMailbox(mailboxes: readonly RuleMailbox[], requested: string | null): RuleMailbox | null {
  return mailboxes.find((mailbox) => mailbox.id === requested) || mailboxes[0] || null;
}

/** A mailbox id from a form, accepted only when the user may manage its rules. */
export function authorizedRuleMailbox(mailboxes: readonly RuleMailbox[], requested: unknown): RuleMailbox | null {
  return typeof requested === 'string' ? mailboxes.find((mailbox) => mailbox.id === requested) || null : null;
}

export async function listInboxRules(db: D1Database, mailboxId: string): Promise<ListedInboxRule[]> {
  const { results } = await db.prepare(
    `SELECT id, name, is_enabled, stop_processing, definition
     FROM inbox_rules
     WHERE mailbox_id = ?
     ORDER BY position ASC, created_at ASC`,
  ).bind(mailboxId).all<{ id: string; name: string; is_enabled: number; stop_processing: number; definition: string }>();
  return (results || []).map((row) => {
    const definition = ruleDefinitionFromStorage(row.definition);
    return {
      id: row.id,
      name: row.name,
      enabled: row.is_enabled === 1,
      stopProcessing: row.stop_processing === 1,
      definition,
      canRunNow: !!definition && !ruleNeedsBody(definition) && !ruleNeedsHeaders(definition),
    };
  });
}

export async function getInboxRule(db: D1Database, mailboxId: string, ruleId: string): Promise<ListedInboxRule | null> {
  if (!ruleId || ruleId.length > 128) return null;
  const rules = await listInboxRules(db, mailboxId);
  return rules.find((rule) => rule.id === ruleId) || null;
}

export type RuleFormResult =
  | { ok: true; name: string; definition: InboxRuleDefinition; stopProcessing: boolean; enabled: boolean; runNow: boolean }
  | { ok: false; error: string };

/** Reads the editor form: name, the definition JSON the editor builds, and the switches. */
export function parseRuleForm(form: FormData): RuleFormResult {
  const name = parseRuleName(form.get('name'));
  if (!name.ok) return { ok: false, error: name.error };
  const raw = form.get('definition');
  if (typeof raw !== 'string' || !raw || raw.length > MAX_DEFINITION_INPUT_CHARS) {
    return { ok: false, error: 'The rule could not be read. Reload the page and try again.' };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'The rule could not be read. Reload the page and try again.' };
  }
  const definition = parseRuleDefinition(decoded);
  if (!definition.ok) return { ok: false, error: definition.error };
  return {
    ok: true,
    name: name.value,
    definition: definition.value,
    stopProcessing: form.get('stop_processing') === 'on',
    enabled: form.get('enabled') === 'on',
    runNow: form.get('run_now') === 'on',
  };
}

export async function createInboxRule(
  db: D1Database,
  mailboxId: string,
  userId: string,
  rule: { name: string; definition: InboxRuleDefinition; stopProcessing: boolean; enabled: boolean },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const count = await db.prepare('SELECT COUNT(*) AS total FROM inbox_rules WHERE mailbox_id = ?')
    .bind(mailboxId).first<{ total: number }>();
  if (Number(count?.total || 0) >= MAX_RULES_PER_MAILBOX) {
    return { ok: false, error: `A mailbox can have up to ${MAX_RULES_PER_MAILBOX} rules. Delete or combine some first.` };
  }
  const id = generateId();
  try {
    await db.prepare(
      `INSERT INTO inbox_rules (id, mailbox_id, name, position, is_enabled, stop_processing, definition, created_by, updated_by)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM inbox_rules WHERE mailbox_id = ?), ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      mailboxId,
      rule.name,
      mailboxId,
      rule.enabled ? 1 : 0,
      rule.stopProcessing ? 1 : 0,
      JSON.stringify(rule.definition),
      userId,
      userId,
    ).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('inbox rule limit reached')) {
      return { ok: false, error: `A mailbox can have up to ${MAX_RULES_PER_MAILBOX} rules. Delete or combine some first.` };
    }
    throw error;
  }
  return { ok: true, id };
}

export async function updateInboxRule(
  db: D1Database,
  mailboxId: string,
  ruleId: string,
  userId: string,
  rule: { name: string; definition: InboxRuleDefinition; stopProcessing: boolean; enabled: boolean },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE inbox_rules
     SET name = ?, definition = ?, stop_processing = ?, is_enabled = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ? AND mailbox_id = ?`,
  ).bind(
    rule.name,
    JSON.stringify(rule.definition),
    rule.stopProcessing ? 1 : 0,
    rule.enabled ? 1 : 0,
    userId,
    ruleId,
    mailboxId,
  ).run();
  return Number(result.meta.changes || 0) === 1;
}

export async function deleteInboxRule(db: D1Database, mailboxId: string, ruleId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM inbox_rules WHERE id = ? AND mailbox_id = ?').bind(ruleId, mailboxId).run();
  return Number(result.meta.changes || 0) === 1;
}

export async function setInboxRuleEnabled(
  db: D1Database,
  mailboxId: string,
  ruleId: string,
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE inbox_rules SET is_enabled = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ? AND mailbox_id = ?`,
  ).bind(enabled ? 1 : 0, userId, ruleId, mailboxId).run();
  return Number(result.meta.changes || 0) === 1;
}

/**
 * Moves a rule one place up or down. Positions are renumbered 0..n-1 in the
 * new order in one batch, so gaps left by deletions never stall a move.
 */
export async function moveInboxRule(
  db: D1Database,
  mailboxId: string,
  ruleId: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  const { results } = await db.prepare(
    'SELECT id FROM inbox_rules WHERE mailbox_id = ? ORDER BY position ASC, created_at ASC',
  ).bind(mailboxId).all<{ id: string }>();
  const order = (results || []).map((row) => row.id);
  const index = order.indexOf(ruleId);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) return false;
  [order[index], order[swapWith]] = [order[swapWith], order[index]];
  await db.batch(order.map((id, position) => db.prepare(
    'UPDATE inbox_rules SET position = ? WHERE id = ? AND mailbox_id = ?',
  ).bind(position, id, mailboxId)));
  return true;
}

function jsonAddresses(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Outlook's "Run rule now" for the Inbox: applies one rule to the newest
 * RUN_NOW_LIMIT messages there. Rules that test the body or headers are
 * refused, because those parts of delivered mail are not kept in a form the
 * rule can read; they still apply to new mail.
 */
export async function runInboxRuleNow(
  db: D1Database,
  mailbox: RuleMailbox,
  definition: InboxRuleDefinition,
): Promise<{ ok: true; matched: number; examined: number } | { ok: false; error: string }> {
  if (ruleNeedsBody(definition) || ruleNeedsHeaders(definition)) {
    return { ok: false, error: 'Rules that look at the message body or header only apply to new mail.' };
  }
  const { results } = await db.prepare(
    `SELECT id, from_address, to_addresses, cc_addresses, subject, has_attachments, importance, size_bytes
     FROM messages
     WHERE mailbox_id = ? AND folder = 'inbox' AND draft_owner_id IS NULL
     ORDER BY received_at DESC
     LIMIT ?`,
  ).bind(mailbox.id, RUN_NOW_LIMIT).all<{
    id: string;
    from_address: string;
    to_addresses: string;
    cc_addresses: string;
    subject: string;
    has_attachments: number;
    importance: MessageImportance;
    size_bytes: number;
  }>();
  const messages = results || [];
  const matched = messages.filter((message) => ruleApplies(definition, {
    mailboxAddress: mailbox.address,
    from: message.from_address,
    to: jsonAddresses(message.to_addresses),
    cc: jsonAddresses(message.cc_addresses),
    subject: message.subject,
    body: null,
    headers: null,
    hasAttachment: message.has_attachments === 1,
    importance: message.importance,
    sizeBytes: message.size_bytes,
  })).map((message) => message.id);

  const { actions } = definition;
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (actions.moveTo) {
    assignments.push('folder = ?');
    values.push(actions.moveTo);
  }
  if (actions.markAsRead) assignments.push('is_read = 1');
  if (actions.star) assignments.push('is_starred = 1');
  if (actions.setImportance) {
    assignments.push('importance = ?');
    values.push(actions.setImportance);
  }
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < matched.length; start += UPDATE_CHUNK) {
    const chunk = matched.slice(start, start + UPDATE_CHUNK);
    statements.push(db.prepare(
      `UPDATE messages SET ${assignments.join(', ')}
       WHERE mailbox_id = ? AND folder = 'inbox' AND id IN (${chunk.map(() => '?').join(', ')})`,
    ).bind(...values, mailbox.id, ...chunk));
  }
  if (statements.length) await db.batch(statements);
  return { ok: true, matched: matched.length, examined: messages.length };
}
