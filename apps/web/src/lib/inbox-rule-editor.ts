import type {
  InboxRuleDefinition,
  RecipientPosition,
  RuleActions,
  RuleConditions,
  RuleMoveFolder,
} from '@cmail/shared/inbox-rules';
import type { MessageImportance } from '@cmail/shared/types';

/**
 * The rule editor's model: Outlook-style rows ("Add a condition", "Add an
 * action", "Add an exception"), each a kind plus its value. The server
 * validates the definition these rows produce with parseRuleDefinition, so
 * this file only maps between the two shapes.
 */

export type ConditionKind = keyof RuleConditions | 'appliesToAll';
export type ActionKind = keyof RuleActions;
type ValueInput = 'addresses' | 'words' | 'position' | 'importance' | 'size' | 'none';

export interface ConditionOption {
  kind: ConditionKind;
  label: string;
  input: ValueInput;
  placeholder?: string;
}

export interface ActionOption {
  kind: ActionKind;
  label: string;
  input: 'folder' | 'importance' | 'none';
}

export interface EditorRow {
  id: number;
  kind: string;
  /** Free text: addresses, words or a size. */
  text: string;
  /** A chosen option: position, importance or folder. */
  choice: string;
}

/** Outlook's condition list, minus what cmail has no data for (categories, flags, sensitivity). */
export const CONDITION_OPTIONS: readonly ConditionOption[] = [
  { kind: 'from', label: 'From', input: 'addresses', placeholder: 'ann@example.com; example.org' },
  { kind: 'sentTo', label: 'Sent to', input: 'addresses', placeholder: 'team@example.com' },
  { kind: 'subjectContains', label: 'Subject includes', input: 'words', placeholder: 'invoice; receipt' },
  { kind: 'subjectOrBodyContains', label: 'Subject or body includes', input: 'words', placeholder: 'webinar' },
  { kind: 'bodyContains', label: 'Message body includes', input: 'words', placeholder: 'unsubscribe' },
  { kind: 'senderContains', label: 'Sender address includes', input: 'words', placeholder: 'noreply' },
  { kind: 'recipientContains', label: 'Recipient address includes', input: 'words', placeholder: 'sales' },
  { kind: 'headerContains', label: 'Message header includes', input: 'words', placeholder: 'List-Id' },
  { kind: 'myPosition', label: 'My address is', input: 'position' },
  { kind: 'hasAttachment', label: 'Has an attachment', input: 'none' },
  { kind: 'importance', label: 'Importance is', input: 'importance' },
  { kind: 'sizeAtLeastKb', label: 'Size is at least (KB)', input: 'size', placeholder: '1024' },
  { kind: 'sizeAtMostKb', label: 'Size is at most (KB)', input: 'size', placeholder: '50' },
  { kind: 'appliesToAll', label: 'Apply to all messages', input: 'none' },
];

/** Exceptions take the same tests, apart from "Apply to all messages". */
export const EXCEPTION_OPTIONS: readonly ConditionOption[] = CONDITION_OPTIONS.filter((option) => option.kind !== 'appliesToAll');

/** Outlook's actions that fit cmail's folders and message state. */
export const ACTION_OPTIONS: readonly ActionOption[] = [
  { kind: 'moveTo', label: 'Move to', input: 'folder' },
  { kind: 'markAsRead', label: 'Mark as read', input: 'none' },
  { kind: 'star', label: 'Star it', input: 'none' },
  { kind: 'setImportance', label: 'Mark with importance', input: 'importance' },
];

export const POSITION_CHOICES: ReadonlyArray<{ value: RecipientPosition; label: string }> = [
  { value: 'to', label: 'on the To line' },
  { value: 'cc', label: 'on the Cc line' },
  { value: 'to-or-cc', label: 'on the To or Cc line' },
  { value: 'not-to', label: 'not on the To line' },
  { value: 'only-recipient', label: 'the only recipient' },
];

export const IMPORTANCE_CHOICES: ReadonlyArray<{ value: MessageImportance; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export const FOLDER_CHOICES: ReadonlyArray<{ value: RuleMoveFolder; label: string }> = [
  { value: 'archive', label: 'Archive' },
  { value: 'spam', label: 'Junk' },
  { value: 'trash', label: 'Deleted' },
];

const DEFAULT_CHOICE: Record<string, string> = {
  myPosition: 'to',
  importance: 'high',
  setImportance: 'high',
  moveTo: 'archive',
};

let nextRowId = 0;

export function newRow(kind: string, text = '', choice = DEFAULT_CHOICE[kind] || ''): EditorRow {
  nextRowId += 1;
  return { id: nextRowId, kind, text, choice };
}

export function conditionOption(kind: string): ConditionOption | undefined {
  return CONDITION_OPTIONS.find((option) => option.kind === kind);
}

export function actionOption(kind: string): ActionOption | undefined {
  return ACTION_OPTIONS.find((option) => option.kind === kind);
}

/** Addresses separate on spaces, commas or semicolons; words and phrases only on semicolons or new lines. */
export function splitEntries(text: string, input: ValueInput): string[] {
  const separator = input === 'addresses' ? /[\s,;]+/ : /\s*[;\n]\s*/;
  return text.split(separator).map((entry) => entry.trim()).filter(Boolean);
}

export function rowsFromConditions(conditions: RuleConditions, appliesToAll = false): EditorRow[] {
  const rows: EditorRow[] = [];
  if (appliesToAll) rows.push(newRow('appliesToAll'));
  for (const option of CONDITION_OPTIONS) {
    if (option.kind === 'appliesToAll') continue;
    const value = conditions[option.kind as keyof RuleConditions];
    if (value === undefined) continue;
    if (Array.isArray(value)) rows.push(newRow(option.kind, value.join('; ')));
    else if (typeof value === 'number') rows.push(newRow(option.kind, String(value)));
    else if (typeof value === 'string') rows.push(newRow(option.kind, '', value));
    else rows.push(newRow(option.kind));
  }
  return rows;
}

export function rowsFromActions(actions: RuleActions): EditorRow[] {
  const rows: EditorRow[] = [];
  if (actions.moveTo) rows.push(newRow('moveTo', '', actions.moveTo));
  if (actions.markAsRead) rows.push(newRow('markAsRead'));
  if (actions.star) rows.push(newRow('star'));
  if (actions.setImportance) rows.push(newRow('setImportance', '', actions.setImportance));
  return rows;
}

/** Rows to the shape parseRuleDefinition reads. Empty values are left for the server to report. */
export function conditionsFromRows(rows: readonly EditorRow[]): { appliesToAll: boolean; conditions: Record<string, unknown> } {
  const conditions: Record<string, unknown> = {};
  let appliesToAll = false;
  for (const row of rows) {
    const option = conditionOption(row.kind);
    if (!option) continue;
    if (option.kind === 'appliesToAll') appliesToAll = true;
    else if (option.input === 'addresses' || option.input === 'words') conditions[option.kind] = splitEntries(row.text, option.input);
    else if (option.input === 'size') conditions[option.kind] = row.text.trim();
    else if (option.input === 'none') conditions[option.kind] = true;
    else conditions[option.kind] = row.choice;
  }
  return { appliesToAll, conditions };
}

export function actionsFromRows(rows: readonly EditorRow[]): Record<string, unknown> {
  const actions: Record<string, unknown> = {};
  for (const row of rows) {
    const option = actionOption(row.kind);
    if (!option) continue;
    actions[option.kind] = option.input === 'none' ? true : row.choice;
  }
  return actions;
}

export function definitionFromRows(
  conditionRows: readonly EditorRow[],
  exceptionRows: readonly EditorRow[],
  actionRows: readonly EditorRow[],
): Record<string, unknown> {
  const { appliesToAll, conditions } = conditionsFromRows(conditionRows);
  return {
    version: 1,
    appliesToAll,
    conditions,
    exceptions: conditionsFromRows(exceptionRows.filter((row) => row.kind !== 'appliesToAll')).conditions,
    actions: actionsFromRows(actionRows),
  };
}

/** The editor's starting rows for a new rule, optionally from a message ("Create rule"). */
export function startingRows(prefill: { from?: string; subject?: string }): {
  conditions: EditorRow[];
  actions: EditorRow[];
} {
  const conditions: EditorRow[] = [];
  if (prefill.from) conditions.push(newRow('from', prefill.from));
  if (prefill.subject) conditions.push(newRow('subjectContains', prefill.subject));
  if (!conditions.length) conditions.push(newRow('from'));
  return { conditions, actions: [newRow('moveTo')] };
}

export function definitionRows(definition: InboxRuleDefinition): {
  conditions: EditorRow[];
  exceptions: EditorRow[];
  actions: EditorRow[];
} {
  return {
    conditions: rowsFromConditions(definition.conditions, definition.appliesToAll),
    exceptions: rowsFromConditions(definition.exceptions),
    actions: rowsFromActions(definition.actions),
  };
}
