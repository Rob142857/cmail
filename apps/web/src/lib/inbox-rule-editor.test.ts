import { describe, expect, it } from 'vitest';
import { parseRuleDefinition } from '@cmail/shared/inbox-rules';
import {
  CONDITION_OPTIONS,
  EXCEPTION_OPTIONS,
  definitionFromRows,
  definitionRows,
  newRow,
  splitEntries,
  startingRows,
} from './inbox-rule-editor';

function parsed(raw: Record<string, unknown>) {
  const result = parseRuleDefinition(raw);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('rule editor rows', () => {
  it('round-trips every condition kind, exceptions and actions through the editor rows', () => {
    const definition = parsed({
      conditions: {
        from: ['ann@partner.example', 'bulk.example'],
        sentTo: ['team@clio.example'],
        subjectContains: ['invoice', 'receipt, final'],
        subjectOrBodyContains: ['webinar'],
        bodyContains: ['unsubscribe'],
        senderContains: ['noreply'],
        recipientContains: ['sales'],
        headerContains: ['List-Id'],
        myPosition: 'cc',
        hasAttachment: true,
        importance: 'high',
        sizeAtLeastKb: 100,
        sizeAtMostKb: 5000,
      },
      exceptions: { from: ['boss@clio.example'], importance: 'low' },
      actions: { moveTo: 'spam', markAsRead: true, star: true, setImportance: 'low' },
    });
    const rows = definitionRows(definition);
    expect(rows.conditions.map((row) => row.kind)).toEqual(CONDITION_OPTIONS.map((option) => option.kind).filter((kind) => kind !== 'appliesToAll'));
    expect(parsed(definitionFromRows(rows.conditions, rows.exceptions, rows.actions))).toEqual(definition);
  });

  it('keeps "Apply to all messages" as a condition row and never as an exception', () => {
    const definition = parsed({ appliesToAll: true, actions: { markAsRead: true } });
    const rows = definitionRows(definition);
    expect(rows.conditions.map((row) => row.kind)).toEqual(['appliesToAll']);
    expect(EXCEPTION_OPTIONS.some((option) => option.kind === 'appliesToAll')).toBe(false);
    expect(definitionFromRows(rows.conditions, [newRow('appliesToAll')], rows.actions).exceptions).toEqual({});
  });

  it('splits addresses on spaces, commas and semicolons, and phrases only on semicolons or new lines', () => {
    expect(splitEntries(' ann@x.example, bob@y.example;example.org\nz.example ', 'addresses'))
      .toEqual(['ann@x.example', 'bob@y.example', 'example.org', 'z.example']);
    expect(splitEntries('final notice, please; second\nthird ;', 'words')).toEqual(['final notice, please', 'second', 'third']);
  });

  it('starts a new rule from a message with its sender, or with an empty From row', () => {
    const fromMessage = startingRows({ from: 'ann@partner.example' });
    expect(fromMessage.conditions.map((row) => [row.kind, row.text])).toEqual([['from', 'ann@partner.example']]);
    expect(fromMessage.actions.map((row) => [row.kind, row.choice])).toEqual([['moveTo', 'archive']]);
    expect(startingRows({}).conditions.map((row) => [row.kind, row.text])).toEqual([['from', '']]);
  });

  it('leaves empty values for the validator to report', () => {
    const rows = startingRows({});
    const result = parseRuleDefinition(definitionFromRows(rows.conditions, [], rows.actions));
    expect(result.ok).toBe(false);
  });
});
