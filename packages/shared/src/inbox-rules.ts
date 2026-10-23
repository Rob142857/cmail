import type { MessageImportance } from './types';

/**
 * Inbox rules: per-mailbox filters that act on incoming mail, modelled on
 * Outlook's rules (Settings > Mail > Rules).
 *
 * A rule has conditions, optional exceptions and actions. Every condition a
 * rule sets must match ("and"); the values inside one condition are
 * alternatives ("or"), and the rule is skipped when any exception matches.
 * Rules run in their saved order. A rule with "stop processing more rules"
 * set (the default, as in Outlook) ends the run once it applies.
 *
 * Outlook features with no cmail equivalent are left out rather than
 * approximated: there are no custom folders or categories, and forwarding or
 * redirecting is not offered because automatic forwarding is a classic data
 * exfiltration path. Permanent delete is replaced by moving to Deleted.
 *
 * This module is pure: the email worker (external mail) and the web app
 * (mail between mailboxes of this organisation) both load a mailbox's rules
 * and call evaluateInboxRules, so the two delivery paths behave the same.
 */

export const INBOX_RULE_VERSION = 1;
export const MAX_RULES_PER_MAILBOX = 50;
export const MAX_RULE_NAME_CHARS = 120;
export const MAX_VALUES_PER_CONDITION = 20;
export const MAX_VALUE_CHARS = 200;
export const MAX_RULE_DEFINITION_CHARS = 16_384;
/** 150 MB, well above the largest message cmail accepts. */
export const MAX_RULE_SIZE_KB = 153_600;

/** The folders a rule can move a message to. Inbox is where it starts. */
export const RULE_MOVE_FOLDERS = ['archive', 'spam', 'trash'] as const;
export type RuleMoveFolder = (typeof RULE_MOVE_FOLDERS)[number];
export type RuleFolder = 'inbox' | RuleMoveFolder;

/** Outlook's "I'm on the To line", "I'm on the Cc line" and related tests. */
export const RECIPIENT_POSITIONS = ['to', 'cc', 'to-or-cc', 'not-to', 'only-recipient'] as const;
export type RecipientPosition = (typeof RECIPIENT_POSITIONS)[number];

const IMPORTANCE_VALUES: readonly MessageImportance[] = ['low', 'normal', 'high'];

export interface RuleConditions {
  /** Sender is one of these addresses, or at one of these domains. */
  from?: string[];
  /** An address or domain on the To or Cc line. */
  sentTo?: string[];
  subjectContains?: string[];
  subjectOrBodyContains?: string[];
  bodyContains?: string[];
  /** Part of the sender's address ("Sender address includes"). */
  senderContains?: string[];
  /** Part of any To or Cc address ("Recipient address includes"). */
  recipientContains?: string[];
  /** Text anywhere in the message header ("Message header includes"). */
  headerContains?: string[];
  /** Where this mailbox's address appears among the recipients. */
  myPosition?: RecipientPosition;
  hasAttachment?: true;
  importance?: MessageImportance;
  sizeAtLeastKb?: number;
  sizeAtMostKb?: number;
}

export interface RuleActions {
  moveTo?: RuleMoveFolder;
  markAsRead?: true;
  star?: true;
  setImportance?: MessageImportance;
}

export interface InboxRuleDefinition {
  version: typeof INBOX_RULE_VERSION;
  /** Outlook's "Apply to all messages": required when there are no conditions. */
  appliesToAll: boolean;
  conditions: RuleConditions;
  exceptions: RuleConditions;
  actions: RuleActions;
}

export interface InboxRule {
  id: string;
  name: string;
  enabled: boolean;
  stopProcessing: boolean;
  definition: InboxRuleDefinition;
}

/** What a rule can test. Addresses are lower-case addr-specs. */
export interface RuleMessageFacts {
  /** This mailbox's own address: "me" in the recipient-position tests. */
  mailboxAddress: string;
  from: string;
  to: readonly string[];
  cc: readonly string[];
  subject: string;
  /** Plain-text body; null when the caller did not load it. */
  body: string | null;
  /** The header block as "Name: value" lines; null when not available. */
  headers: string | null;
  hasAttachment: boolean;
  importance: MessageImportance;
  sizeBytes: number;
}

export interface InboxRuleOutcome {
  folder: RuleFolder;
  isRead: boolean;
  isStarred: boolean;
  importance: MessageImportance;
  /** Rules that applied, in the order they ran. */
  applied: Array<{ id: string; name: string }>;
}

type TextConditionKey =
  | 'subjectContains' | 'subjectOrBodyContains' | 'bodyContains'
  | 'senderContains' | 'recipientContains' | 'headerContains';
type AddressConditionKey = 'from' | 'sentTo';

const TEXT_CONDITION_KEYS: readonly TextConditionKey[] = [
  'subjectContains', 'subjectOrBodyContains', 'bodyContains',
  'senderContains', 'recipientContains', 'headerContains',
];
const ADDRESS_CONDITION_KEYS: readonly AddressConditionKey[] = ['from', 'sentTo'];
const CONDITION_KEYS: ReadonlySet<string> = new Set([
  ...ADDRESS_CONDITION_KEYS, ...TEXT_CONDITION_KEYS,
  'myPosition', 'hasAttachment', 'importance', 'sizeAtLeastKb', 'sizeAtMostKb',
]);
const ACTION_KEYS: ReadonlySet<string> = new Set(['moveTo', 'markAsRead', 'star', 'setImportance']);

const DOMAIN_RX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_PART_RX = /^[^\s@"(),:;<>[\]\\]{1,64}$/;

/** Case-insensitive, width-insensitive text with runs of white space folded to one space. */
export function normalizeRuleText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanValue(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
    : '';
}

/** An address ("ann@example.com") or a domain ("example.com" or "@example.com"). */
function normalizeAddressEntry(value: string): string | null {
  const entry = value.trim().replace(/^<(.*)>$/, '$1').trim().toLowerCase();
  const domainOnly = entry.startsWith('@') ? entry.slice(1) : entry;
  if (!domainOnly.includes('@')) return DOMAIN_RX.test(domainOnly) ? domainOnly : null;
  const at = domainOnly.lastIndexOf('@');
  if (at !== domainOnly.indexOf('@')) return null;
  const local = domainOnly.slice(0, at);
  const domain = domainOnly.slice(at + 1);
  return LOCAL_PART_RX.test(local) && DOMAIN_RX.test(domain) ? `${local}@${domain}` : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CONDITION_LABELS: Record<string, string> = {
  from: 'From',
  sentTo: 'Sent to',
  subjectContains: 'Subject includes',
  subjectOrBodyContains: 'Subject or body includes',
  bodyContains: 'Body includes',
  senderContains: 'Sender address includes',
  recipientContains: 'Recipient address includes',
  headerContains: 'Message header includes',
  sizeAtLeastKb: 'Size is at least',
  sizeAtMostKb: 'Size is at most',
};

function parseValueList(raw: unknown, label: string, addresses: boolean): Parsed<string[] | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, error: `${label}: expected a list` };
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const cleaned = cleanValue(item);
    if (!cleaned) continue;
    if (cleaned.length > MAX_VALUE_CHARS) {
      return { ok: false, error: `${label}: each entry must be ${MAX_VALUE_CHARS} characters or fewer` };
    }
    let value: string;
    if (addresses) {
      const entry = normalizeAddressEntry(cleaned);
      if (!entry) return { ok: false, error: `${label}: "${cleaned}" is not an email address or domain` };
      value = entry;
    } else {
      value = cleaned;
    }
    const key = normalizeRuleText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  if (values.length > MAX_VALUES_PER_CONDITION) {
    return { ok: false, error: `${label}: use ${MAX_VALUES_PER_CONDITION} entries or fewer` };
  }
  return { ok: true, value: values.length ? values : undefined };
}

function parseSize(raw: unknown, label: string): Parsed<number | undefined> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RULE_SIZE_KB) {
    return { ok: false, error: `${label}: enter a whole number of KB from 1 to ${MAX_RULE_SIZE_KB}` };
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConditions(raw: unknown, group: 'Condition' | 'Exception'): Parsed<RuleConditions> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, error: `${group}s: expected an object` };
  for (const key of Object.keys(raw)) {
    if (!CONDITION_KEYS.has(key)) return { ok: false, error: `${group}: unknown test "${key}"` };
  }
  const conditions: RuleConditions = {};
  for (const key of ADDRESS_CONDITION_KEYS) {
    const parsed = parseValueList(raw[key], `${group} "${CONDITION_LABELS[key]}"`, true);
    if (!parsed.ok) return parsed;
    if (parsed.value) conditions[key] = parsed.value;
  }
  for (const key of TEXT_CONDITION_KEYS) {
    const parsed = parseValueList(raw[key], `${group} "${CONDITION_LABELS[key]}"`, false);
    if (!parsed.ok) return parsed;
    if (parsed.value) conditions[key] = parsed.value;
  }
  if (raw.myPosition !== undefined && raw.myPosition !== null && raw.myPosition !== '') {
    if (!(RECIPIENT_POSITIONS as readonly unknown[]).includes(raw.myPosition)) {
      return { ok: false, error: `${group}: unknown recipient position` };
    }
    conditions.myPosition = raw.myPosition as RecipientPosition;
  }
  if (raw.hasAttachment !== undefined && raw.hasAttachment !== null && raw.hasAttachment !== false) {
    if (raw.hasAttachment !== true) return { ok: false, error: `${group}: "Has an attachment" must be on or off` };
    conditions.hasAttachment = true;
  }
  if (raw.importance !== undefined && raw.importance !== null && raw.importance !== '') {
    if (!(IMPORTANCE_VALUES as readonly unknown[]).includes(raw.importance)) {
      return { ok: false, error: `${group}: importance must be low, normal or high` };
    }
    conditions.importance = raw.importance as MessageImportance;
  }
  for (const key of ['sizeAtLeastKb', 'sizeAtMostKb'] as const) {
    const parsed = parseSize(raw[key], `${group} "${CONDITION_LABELS[key]}"`);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) conditions[key] = parsed.value;
  }
  if (conditions.sizeAtLeastKb !== undefined && conditions.sizeAtMostKb !== undefined
    && conditions.sizeAtLeastKb > conditions.sizeAtMostKb) {
    return { ok: false, error: `${group}: the smallest size is larger than the largest size` };
  }
  return { ok: true, value: conditions };
}

function parseActions(raw: unknown): Parsed<RuleActions> {
  if (!isRecord(raw)) return { ok: false, error: 'Actions: expected an object' };
  for (const key of Object.keys(raw)) {
    if (!ACTION_KEYS.has(key)) return { ok: false, error: `Action: unknown action "${key}"` };
  }
  const actions: RuleActions = {};
  if (raw.moveTo !== undefined && raw.moveTo !== null && raw.moveTo !== '') {
    if (!(RULE_MOVE_FOLDERS as readonly unknown[]).includes(raw.moveTo)) {
      return { ok: false, error: 'Action: a rule can move messages to Archive, Junk or Deleted' };
    }
    actions.moveTo = raw.moveTo as RuleMoveFolder;
  }
  for (const key of ['markAsRead', 'star'] as const) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === false) continue;
    if (raw[key] !== true) return { ok: false, error: `Action: "${key}" must be on or off` };
    actions[key] = true;
  }
  if (raw.setImportance !== undefined && raw.setImportance !== null && raw.setImportance !== '') {
    if (!(IMPORTANCE_VALUES as readonly unknown[]).includes(raw.setImportance)) {
      return { ok: false, error: 'Action: importance must be low, normal or high' };
    }
    actions.setImportance = raw.setImportance as MessageImportance;
  }
  if (!Object.keys(actions).length) return { ok: false, error: 'Add at least one action' };
  return { ok: true, value: actions };
}

/**
 * Validates and normalises a rule definition, from the editor or from the
 * database. Unknown keys are rejected so a typo can never silently widen a
 * rule; addresses are lower-cased and duplicates dropped.
 */
export function parseRuleDefinition(raw: unknown): Parsed<InboxRuleDefinition> {
  if (!isRecord(raw)) return { ok: false, error: 'Rule: expected an object' };
  for (const key of Object.keys(raw)) {
    if (!['version', 'appliesToAll', 'conditions', 'exceptions', 'actions'].includes(key)) {
      return { ok: false, error: `Rule: unknown field "${key}"` };
    }
  }
  if (raw.version !== undefined && raw.version !== INBOX_RULE_VERSION) {
    return { ok: false, error: 'Rule: unsupported version' };
  }
  if (raw.appliesToAll !== undefined && typeof raw.appliesToAll !== 'boolean') {
    return { ok: false, error: 'Rule: "Apply to all messages" must be on or off' };
  }
  const conditions = parseConditions(raw.conditions, 'Condition');
  if (!conditions.ok) return conditions;
  const exceptions = parseConditions(raw.exceptions, 'Exception');
  if (!exceptions.ok) return exceptions;
  // Problems are reported in the order the editor shows its sections.
  const hasConditions = Object.keys(conditions.value).length > 0;
  const appliesToAll = raw.appliesToAll === true;
  if (hasConditions && appliesToAll) {
    return { ok: false, error: 'Choose conditions or "Apply to all messages", not both' };
  }
  if (!hasConditions && !appliesToAll) {
    return { ok: false, error: 'Add at least one condition, or choose "Apply to all messages"' };
  }
  const actions = parseActions(raw.actions);
  if (!actions.ok) return actions;

  const definition: InboxRuleDefinition = {
    version: INBOX_RULE_VERSION,
    appliesToAll,
    conditions: conditions.value,
    exceptions: exceptions.value,
    actions: actions.value,
  };
  if (JSON.stringify(definition).length > MAX_RULE_DEFINITION_CHARS) {
    return { ok: false, error: 'This rule is too large; split it into smaller rules' };
  }
  return { ok: true, value: definition };
}

export function parseRuleName(raw: unknown): Parsed<string> {
  const name = cleanValue(raw).replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the rule a name' };
  if (Array.from(name).length > MAX_RULE_NAME_CHARS) {
    return { ok: false, error: `Rule names must be ${MAX_RULE_NAME_CHARS} characters or fewer` };
  }
  return { ok: true, value: name };
}

/** Reads a stored definition. A row that no longer validates is ignored, never half-applied. */
export function ruleDefinitionFromStorage(json: unknown): InboxRuleDefinition | null {
  if (typeof json !== 'string' || json.length > MAX_RULE_DEFINITION_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = parseRuleDefinition(raw);
  return parsed.ok ? parsed.value : null;
}

function conditionGroups(definition: InboxRuleDefinition): RuleConditions[] {
  return [definition.conditions, definition.exceptions];
}

/** Whether evaluating the rule needs the message body. */
export function ruleNeedsBody(definition: InboxRuleDefinition): boolean {
  return conditionGroups(definition).some((group) => !!(group.bodyContains || group.subjectOrBodyContains));
}

/** Whether evaluating the rule needs the message header block. */
export function ruleNeedsHeaders(definition: InboxRuleDefinition): boolean {
  return conditionGroups(definition).some((group) => !!group.headerContains);
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

function addressMatches(address: string, entries: readonly string[]): boolean {
  const value = address.toLowerCase();
  const domain = domainOf(value);
  return entries.some((entry) => entry.includes('@')
    ? value === entry
    : domain === entry || domain.endsWith(`.${entry}`));
}

function includesAny(text: string | null, needles: readonly string[]): boolean {
  if (text === null) return false;
  return needles.some((needle) => text.includes(normalizeRuleText(needle)));
}

interface PreparedFacts extends RuleMessageFacts {
  me: string;
  recipients: string[];
  /** Normalised subject, body and headers, computed once per message. */
  text(field: 'subject' | 'body' | 'headers'): string | null;
}

function prepare(facts: RuleMessageFacts): PreparedFacts {
  const lower = (values: readonly string[]) => values.map((value) => value.toLowerCase());
  const to = lower(facts.to);
  const cc = lower(facts.cc);
  const cache = new Map<string, string | null>();
  return {
    ...facts,
    from: facts.from.toLowerCase(),
    to,
    cc,
    me: facts.mailboxAddress.toLowerCase(),
    recipients: [...to, ...cc],
    text(field) {
      if (!cache.has(field)) {
        const raw = facts[field];
        cache.set(field, raw === null ? null : normalizeRuleText(raw));
      }
      return cache.get(field) ?? null;
    },
  };
}

function positionMatches(position: RecipientPosition, facts: PreparedFacts): boolean {
  const onTo = facts.to.includes(facts.me);
  const onCc = facts.cc.includes(facts.me);
  switch (position) {
    case 'to': return onTo;
    case 'cc': return onCc;
    case 'to-or-cc': return onTo || onCc;
    case 'not-to': return !onTo;
    case 'only-recipient': return facts.to.length > 0 && facts.to.every((address) => address === facts.me) && facts.cc.length === 0;
  }
}

/** Each test a condition group sets, as a separate predicate. */
function tests(conditions: RuleConditions, facts: PreparedFacts): boolean[] {
  const results: boolean[] = [];
  if (conditions.from) results.push(addressMatches(facts.from, conditions.from));
  if (conditions.sentTo) {
    const entries = conditions.sentTo;
    results.push(facts.recipients.some((address) => addressMatches(address, entries)));
  }
  if (conditions.subjectContains) results.push(includesAny(facts.text('subject'), conditions.subjectContains));
  if (conditions.subjectOrBodyContains) {
    results.push(includesAny(facts.text('subject'), conditions.subjectOrBodyContains)
      || includesAny(facts.text('body'), conditions.subjectOrBodyContains));
  }
  if (conditions.bodyContains) results.push(includesAny(facts.text('body'), conditions.bodyContains));
  if (conditions.senderContains) results.push(includesAny(normalizeRuleText(facts.from), conditions.senderContains));
  if (conditions.recipientContains) {
    const needles = conditions.recipientContains;
    results.push(facts.recipients.some((address) => includesAny(normalizeRuleText(address), needles)));
  }
  if (conditions.headerContains) results.push(includesAny(facts.text('headers'), conditions.headerContains));
  if (conditions.myPosition) results.push(positionMatches(conditions.myPosition, facts));
  if (conditions.hasAttachment) results.push(facts.hasAttachment);
  if (conditions.importance) results.push(facts.importance === conditions.importance);
  if (conditions.sizeAtLeastKb !== undefined) results.push(facts.sizeBytes >= conditions.sizeAtLeastKb * 1024);
  if (conditions.sizeAtMostKb !== undefined) results.push(facts.sizeBytes <= conditions.sizeAtMostKb * 1024);
  return results;
}

function applies(definition: InboxRuleDefinition, facts: PreparedFacts): boolean {
  const conditionResults = tests(definition.conditions, facts);
  if (!definition.appliesToAll && (!conditionResults.length || conditionResults.includes(false))) return false;
  return !tests(definition.exceptions, facts).includes(true);
}

/** Whether one rule applies to a message, ignoring whether it is enabled. */
export function ruleApplies(definition: InboxRuleDefinition, facts: RuleMessageFacts): boolean {
  return applies(definition, prepare(facts));
}

/**
 * Runs a mailbox's rules, in order, on a message that is about to land in
 * the Inbox. The first rule that moves the message decides its folder and
 * the first that sets importance decides that; marking read and starring
 * only ever add. A rule set to stop processing ends the run once it applies.
 */
export function evaluateInboxRules(
  rules: readonly InboxRule[],
  facts: RuleMessageFacts,
  initialImportance: MessageImportance = facts.importance,
): InboxRuleOutcome {
  const outcome: InboxRuleOutcome = {
    folder: 'inbox',
    isRead: false,
    isStarred: false,
    importance: initialImportance,
    applied: [],
  };
  const prepared = prepare(facts);
  let importanceSet = false;
  for (const rule of rules) {
    if (!rule.enabled || !applies(rule.definition, prepared)) continue;
    outcome.applied.push({ id: rule.id, name: rule.name });
    const { actions } = rule.definition;
    if (actions.moveTo && outcome.folder === 'inbox') outcome.folder = actions.moveTo;
    if (actions.markAsRead) outcome.isRead = true;
    if (actions.star) outcome.isStarred = true;
    if (actions.setImportance && !importanceSet) {
      outcome.importance = actions.setImportance;
      importanceSet = true;
    }
    if (rule.stopProcessing) break;
  }
  return outcome;
}

/** Whether a delivered message still warrants a new-mail alert. */
export function outcomeNotifies(outcome: InboxRuleOutcome): boolean {
  return outcome.folder === 'inbox' && !outcome.isRead;
}

/** A row of the inbox_rules table. */
export interface InboxRuleRow {
  id: string;
  name: string;
  is_enabled: number;
  stop_processing: number;
  definition: string;
}

/** Turns stored rows into rules, dropping any whose definition no longer validates. */
export function inboxRulesFromRows(rows: readonly InboxRuleRow[]): InboxRule[] {
  const rules: InboxRule[] = [];
  for (const row of rows) {
    const definition = ruleDefinitionFromStorage(row.definition);
    if (!definition) continue;
    rules.push({
      id: row.id,
      name: row.name,
      enabled: row.is_enabled === 1,
      stopProcessing: row.stop_processing === 1,
      definition,
    });
  }
  return rules;
}

/** Reads a mailbox's enabled rules in order. Callers treat a failure as "no rules". */
export async function loadEnabledInboxRules(db: D1Database, mailboxId: string): Promise<InboxRule[]> {
  const { results } = await db.prepare(
    `SELECT id, name, is_enabled, stop_processing, definition
     FROM inbox_rules
     WHERE mailbox_id = ? AND is_enabled = 1
     ORDER BY position ASC, created_at ASC
     LIMIT ?`,
  ).bind(mailboxId, MAX_RULES_PER_MAILBOX).all<InboxRuleRow>();
  return inboxRulesFromRows(results || []);
}

/** Header lines for "Message header includes", bounded so a huge header block stays cheap. */
export function ruleHeaderText(headers: ReadonlyArray<{ key: string; originalKey?: string; value: string }> | undefined): string {
  let text = '';
  for (const header of headers || []) {
    const line = `${header.originalKey || header.key}: ${header.value}\n`;
    if (text.length + line.length > 65_536) break;
    text += line;
  }
  return text;
}

/** The longest body a rule reads; text past this point is not searched. */
export const MAX_RULE_BODY_CHARS = 262_144;

const END_TAGS = { script: /<\/script/gi, style: /<\/style/gi } as const;

/**
 * Drops tags, and the content of script and style elements, in one forward
 * pass. A scanner rather than tag-matching regular expressions, which take
 * quadratic time on markup such as thousands of "<" with no ">". An
 * unterminated tag is kept as text.
 */
function htmlWithoutTags(html: string): string {
  const parts: string[] = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) break;
    const close = html.indexOf('>', open + 1);
    if (close < 0) break;
    parts.push(html.slice(index, open), ' ');
    index = close + 1;
    const element = /^<(script|style)[\s/>]/.exec(html.slice(open, open + 8).toLowerCase())?.[1] as keyof typeof END_TAGS | undefined;
    if (element) {
      const endTag = END_TAGS[element];
      endTag.lastIndex = index;
      const end = endTag.exec(html);
      const endClose = end ? html.indexOf('>', end.index) : -1;
      index = endClose < 0 ? html.length : endClose + 1;
    }
  }
  parts.push(html.slice(index));
  return parts.join('');
}

/** Plain text from a body for "Body includes": the text part, else the HTML with tags removed. */
export function ruleBodyText(text: string | null | undefined, html: string | null | undefined): string {
  if (text) return text.slice(0, MAX_RULE_BODY_CHARS);
  if (!html) return '';
  return htmlWithoutTags(html.slice(0, MAX_RULE_BODY_CHARS * 2))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .slice(0, MAX_RULE_BODY_CHARS);
}

const FOLDER_NAMES: Record<RuleFolder, string> = { inbox: 'Inbox', archive: 'Archive', spam: 'Junk', trash: 'Deleted' };
const POSITION_TEXT: Record<RecipientPosition, string> = {
  to: "I'm on the To line",
  cc: "I'm on the Cc line",
  'to-or-cc': "I'm on the To or Cc line",
  'not-to': "I'm not on the To line",
  'only-recipient': "I'm the only recipient",
};

export function ruleFolderName(folder: RuleFolder): string {
  return FOLDER_NAMES[folder];
}

export function recipientPositionText(position: RecipientPosition): string {
  return POSITION_TEXT[position];
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(' or ');
}

/** Plain-language lines for a condition group, as Outlook lists them. */
export function describeConditions(conditions: RuleConditions): string[] {
  const lines: string[] = [];
  if (conditions.from) lines.push(`From ${conditions.from.join(' or ')}`);
  if (conditions.sentTo) lines.push(`Sent to ${conditions.sentTo.join(' or ')}`);
  if (conditions.subjectContains) lines.push(`Subject includes ${quoted(conditions.subjectContains)}`);
  if (conditions.subjectOrBodyContains) lines.push(`Subject or body includes ${quoted(conditions.subjectOrBodyContains)}`);
  if (conditions.bodyContains) lines.push(`Body includes ${quoted(conditions.bodyContains)}`);
  if (conditions.senderContains) lines.push(`Sender address includes ${quoted(conditions.senderContains)}`);
  if (conditions.recipientContains) lines.push(`Recipient address includes ${quoted(conditions.recipientContains)}`);
  if (conditions.headerContains) lines.push(`Message header includes ${quoted(conditions.headerContains)}`);
  if (conditions.myPosition) lines.push(POSITION_TEXT[conditions.myPosition]);
  if (conditions.hasAttachment) lines.push('Has an attachment');
  if (conditions.importance) lines.push(`Importance is ${conditions.importance}`);
  if (conditions.sizeAtLeastKb !== undefined) lines.push(`Size is at least ${conditions.sizeAtLeastKb} KB`);
  if (conditions.sizeAtMostKb !== undefined) lines.push(`Size is at most ${conditions.sizeAtMostKb} KB`);
  return lines;
}

/** Plain-language lines for a rule's actions. */
export function describeActions(actions: RuleActions): string[] {
  const lines: string[] = [];
  if (actions.moveTo) lines.push(`Move to ${FOLDER_NAMES[actions.moveTo]}`);
  if (actions.markAsRead) lines.push('Mark as read');
  if (actions.star) lines.push('Star it');
  if (actions.setImportance) lines.push(`Set importance to ${actions.setImportance}`);
  return lines;
}
