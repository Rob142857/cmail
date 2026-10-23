import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RULE_DEFINITION_CHARS,
  MAX_VALUES_PER_CONDITION,
  describeActions,
  describeConditions,
  evaluateInboxRules,
  inboxRulesFromRows,
  outcomeNotifies,
  parseRuleDefinition,
  parseRuleName,
  ruleApplies,
  ruleBodyText,
  ruleDefinitionFromStorage,
  ruleHeaderText,
  ruleNeedsBody,
  ruleNeedsHeaders,
  type InboxRule,
  type InboxRuleDefinition,
  type RuleMessageFacts,
} from './inbox-rules.ts';

function facts(overrides: Partial<RuleMessageFacts> = {}): RuleMessageFacts {
  return {
    mailboxAddress: 'me@clio.example',
    from: 'ann@partner.example',
    to: ['me@clio.example'],
    cc: [],
    subject: 'Quarterly invoice',
    body: 'Please find the invoice attached.',
    headers: 'List-Id: <news.partner.example>\nX-Mailer: Example\n',
    hasAttachment: true,
    importance: 'normal',
    sizeBytes: 40_000,
    ...overrides,
  };
}

function definition(raw: Record<string, unknown>): InboxRuleDefinition {
  const parsed = parseRuleDefinition(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function rule(id: string, raw: Record<string, unknown>, options: Partial<InboxRule> = {}): InboxRule {
  return { id, name: `Rule ${id}`, enabled: true, stopProcessing: true, definition: definition(raw), ...options };
}

describe('parseRuleDefinition', () => {
  it('normalises addresses and domains, drops blanks and duplicates', () => {
    const parsed = parseRuleDefinition({
      conditions: { from: [' Ann@Partner.Example ', '@Bulk.Example', 'bulk.example', '', '<Bob@X.Example>'] },
      actions: { moveTo: 'archive' },
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, {
      version: 1,
      appliesToAll: false,
      conditions: { from: ['ann@partner.example', 'bulk.example', 'bob@x.example'] },
      exceptions: {},
      actions: { moveTo: 'archive' },
    });
  });

  it('rejects entries that are not an address or a domain', () => {
    for (const bad of ['not an address', 'a@b@c.example', 'ann@', 'localhost', '"quoted"@x.example']) {
      const parsed = parseRuleDefinition({ conditions: { from: [bad] }, actions: { markAsRead: true } });
      assert.equal(parsed.ok, false, bad);
    }
  });

  it('requires a condition or "Apply to all messages", but not both, and an action', () => {
    assert.equal(parseRuleDefinition({ actions: { markAsRead: true } }).ok, false);
    assert.equal(parseRuleDefinition({ appliesToAll: true, actions: { markAsRead: true } }).ok, true);
    assert.equal(parseRuleDefinition({ appliesToAll: true, conditions: { hasAttachment: true }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { hasAttachment: true }, actions: {} }).ok, false);
  });

  it('rejects unknown fields, tests and actions so typos never widen a rule', () => {
    assert.equal(parseRuleDefinition({ conditions: { fromm: ['a@b.example'] }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { hasAttachment: true }, actions: { forwardTo: 'x@evil.example' } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { hasAttachment: true }, actions: { moveTo: 'inbox' } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { hasAttachment: true }, actions: { star: true }, extra: 1 }).ok, false);
    assert.equal(parseRuleDefinition({ version: 2, conditions: { hasAttachment: true }, actions: { star: true } }).ok, false);
  });

  it('bounds list lengths, entry lengths, sizes and the stored size', () => {
    const many = Array.from({ length: MAX_VALUES_PER_CONDITION + 1 }, (_, i) => `word${i}`);
    assert.equal(parseRuleDefinition({ conditions: { subjectContains: many }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { subjectContains: ['x'.repeat(201)] }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { sizeAtLeastKb: 0 }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { sizeAtLeastKb: 1.5 }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { sizeAtLeastKb: 500, sizeAtMostKb: 100 }, actions: { star: true } }).ok, false);
    assert.equal(parseRuleDefinition({ conditions: { sizeAtLeastKb: '250' }, actions: { star: true } }).ok, true);
    const wide = Array.from({ length: 20 }, (_, i) => `${'w'.repeat(190)}${i}`);
    const huge = parseRuleDefinition({
      conditions: { subjectContains: wide, bodyContains: wide, headerContains: wide, senderContains: wide },
      exceptions: { subjectContains: wide },
      actions: { star: true },
    });
    assert.equal(huge.ok, false);
    assert.match(huge.ok ? '' : huge.error, /too large/);
    assert.ok(MAX_RULE_DEFINITION_CHARS < 5 * 20 * 200);
  });

  it('strips control characters from text values', () => {
    const parsed = parseRuleDefinition({ conditions: { subjectContains: ['in\u0000voice\u001f'] }, actions: { star: true } });
    assert.deepEqual(parsed.ok && parsed.value.conditions.subjectContains, ['in voice']);
  });
});

describe('parseRuleName and stored definitions', () => {
  it('requires a bounded, single-line name', () => {
    assert.deepEqual(parseRuleName('  Newsletters\n to Archive '), { ok: true, value: 'Newsletters to Archive' });
    assert.equal(parseRuleName('   ').ok, false);
    assert.equal(parseRuleName('n'.repeat(121)).ok, false);
  });

  it('ignores stored rows that no longer validate instead of half-applying them', () => {
    assert.equal(ruleDefinitionFromStorage('{not json'), null);
    assert.equal(ruleDefinitionFromStorage(JSON.stringify({ conditions: {}, actions: { star: true } })), null);
    const rules = inboxRulesFromRows([
      { id: 'good', name: 'Good', is_enabled: 1, stop_processing: 0, definition: JSON.stringify({ appliesToAll: true, actions: { star: true } }) },
      { id: 'bad', name: 'Bad', is_enabled: 1, stop_processing: 0, definition: JSON.stringify({ appliesToAll: true, actions: { forwardTo: 'x@y.example' } }) },
    ]);
    assert.deepEqual(rules.map((item) => [item.id, item.enabled, item.stopProcessing]), [['good', true, false]]);
  });
});

describe('conditions', () => {
  const matches = (conditions: Record<string, unknown>, overrides: Partial<RuleMessageFacts> = {}) =>
    ruleApplies(definition({ conditions, actions: { star: true } }), facts(overrides));

  it('matches From by exact address, by domain and by subdomain', () => {
    assert.equal(matches({ from: ['ann@partner.example'] }), true);
    assert.equal(matches({ from: ['partner.example'] }), true);
    assert.equal(matches({ from: ['partner.example'] }, { from: 'ann@mail.partner.example' }), true);
    assert.equal(matches({ from: ['partner.example'] }, { from: 'ann@notpartner.example' }), false);
    assert.equal(matches({ from: ['bob@partner.example'] }), false);
    assert.equal(matches({ from: ['ann@partner.example'] }, { from: 'ANN@Partner.Example' }), true);
  });

  it('matches Sent to against To and Cc', () => {
    assert.equal(matches({ sentTo: ['team@clio.example'] }, { cc: ['team@clio.example'] }), true);
    assert.equal(matches({ sentTo: ['clio.example'] }), true);
    assert.equal(matches({ sentTo: ['other.example'] }), false);
  });

  it('matches text tests case- and width-insensitively, as alternatives', () => {
    assert.equal(matches({ subjectContains: ['INVOICE'] }), true);
    assert.equal(matches({ subjectContains: ['receipt', 'quarterly'] }), true);
    assert.equal(matches({ subjectContains: ['receipt'] }), false);
    assert.equal(matches({ subjectContains: ['ｉｎｖｏｉｃｅ'] }), true);
    assert.equal(matches({ subjectContains: ['quarterly  invoice'] }, { subject: 'Quarterly\n invoice' }), true);
    assert.equal(matches({ bodyContains: ['find the'] }), true);
    assert.equal(matches({ subjectOrBodyContains: ['attached'] }), true);
    assert.equal(matches({ senderContains: ['partner'] }), true);
    assert.equal(matches({ recipientContains: ['clio'] }), true);
    assert.equal(matches({ headerContains: ['list-id: <news.partner'] }), true);
  });

  it('never matches body or header tests when that part was not loaded', () => {
    assert.equal(matches({ bodyContains: ['invoice'] }, { body: null }), false);
    assert.equal(matches({ subjectOrBodyContains: ['attached'] }, { body: null }), false);
    assert.equal(matches({ subjectOrBodyContains: ['quarterly'] }, { body: null }), true);
    assert.equal(matches({ headerContains: ['list-id'] }, { headers: null }), false);
  });

  it("tests where I appear among the recipients", () => {
    const me = 'me@clio.example';
    assert.equal(matches({ myPosition: 'to' }), true);
    assert.equal(matches({ myPosition: 'cc' }, { to: ['x@y.example'], cc: [me] }), true);
    assert.equal(matches({ myPosition: 'to-or-cc' }, { to: ['x@y.example'], cc: [me] }), true);
    assert.equal(matches({ myPosition: 'to-or-cc' }, { to: ['list@y.example'], cc: [] }), false);
    assert.equal(matches({ myPosition: 'not-to' }, { to: ['list@y.example'] }), true);
    assert.equal(matches({ myPosition: 'only-recipient' }), true);
    assert.equal(matches({ myPosition: 'only-recipient' }, { to: [me, 'x@y.example'] }), false);
    assert.equal(matches({ myPosition: 'only-recipient' }, { to: [me], cc: ['x@y.example'] }), false);
    assert.equal(matches({ myPosition: 'only-recipient' }, { to: [], cc: [] }), false);
    assert.equal(matches({ myPosition: 'to' }, { mailboxAddress: 'ME@Clio.Example' }), true);
  });

  it('tests attachments, importance and size', () => {
    assert.equal(matches({ hasAttachment: true }), true);
    assert.equal(matches({ hasAttachment: true }, { hasAttachment: false }), false);
    assert.equal(matches({ importance: 'high' }, { importance: 'high' }), true);
    assert.equal(matches({ importance: 'high' }), false);
    assert.equal(matches({ sizeAtLeastKb: 39 }), true);
    assert.equal(matches({ sizeAtLeastKb: 40 }), false);
    assert.equal(matches({ sizeAtMostKb: 40 }), true);
    assert.equal(matches({ sizeAtLeastKb: 10, sizeAtMostKb: 20 }), false);
  });

  it('requires every condition (and), and skips the rule when any exception matches (or)', () => {
    assert.equal(matches({ from: ['partner.example'], subjectContains: ['invoice'] }), true);
    assert.equal(matches({ from: ['partner.example'], subjectContains: ['receipt'] }), false);
    const withExceptions = definition({
      conditions: { from: ['partner.example'] },
      exceptions: { subjectContains: ['urgent'], importance: 'high' },
      actions: { moveTo: 'archive' },
    });
    assert.equal(ruleApplies(withExceptions, facts()), true);
    assert.equal(ruleApplies(withExceptions, facts({ subject: 'URGENT invoice' })), false);
    assert.equal(ruleApplies(withExceptions, facts({ importance: 'high' })), false);
  });

  it('applies "Apply to all messages" rules unless an exception matches', () => {
    const all = definition({ appliesToAll: true, exceptions: { from: ['boss@clio.example'] }, actions: { markAsRead: true } });
    assert.equal(ruleApplies(all, facts()), true);
    assert.equal(ruleApplies(all, facts({ from: 'boss@clio.example' })), false);
  });
});

describe('evaluateInboxRules', () => {
  it('leaves a message alone when no rule applies', () => {
    const outcome = evaluateInboxRules([rule('a', { conditions: { from: ['x.example'] }, actions: { moveTo: 'trash' } })], facts());
    assert.deepEqual(outcome, { folder: 'inbox', isRead: false, isStarred: false, importance: 'normal', applied: [] });
    assert.equal(outcomeNotifies(outcome), true);
  });

  it('stops after the first rule that applies when it is set to stop processing', () => {
    const outcome = evaluateInboxRules([
      rule('a', { conditions: { from: ['partner.example'] }, actions: { moveTo: 'archive' } }),
      rule('b', { appliesToAll: true, actions: { star: true } }),
    ], facts());
    assert.equal(outcome.folder, 'archive');
    assert.equal(outcome.isStarred, false);
    assert.deepEqual(outcome.applied, [{ id: 'a', name: 'Rule a' }]);
    assert.equal(outcomeNotifies(outcome), false);
  });

  it('runs later rules when stop processing is off: first move and importance win, read and star add up', () => {
    const outcome = evaluateInboxRules([
      rule('a', { conditions: { hasAttachment: true }, actions: { moveTo: 'archive', setImportance: 'low' } }, { stopProcessing: false }),
      rule('b', { appliesToAll: true, actions: { moveTo: 'trash', setImportance: 'high', star: true } }, { stopProcessing: false }),
      rule('c', { conditions: { subjectContains: ['invoice'] }, actions: { markAsRead: true } }),
    ], facts());
    assert.deepEqual(outcome, {
      folder: 'archive',
      isRead: true,
      isStarred: true,
      importance: 'low',
      applied: [{ id: 'a', name: 'Rule a' }, { id: 'b', name: 'Rule b' }, { id: 'c', name: 'Rule c' }],
    });
  });

  it('skips disabled rules, which also cannot stop processing', () => {
    const outcome = evaluateInboxRules([
      rule('off', { appliesToAll: true, actions: { moveTo: 'trash' } }, { enabled: false }),
      rule('on', { appliesToAll: true, actions: { markAsRead: true } }),
    ], facts());
    assert.equal(outcome.folder, 'inbox');
    assert.equal(outcome.isRead, true);
    assert.equal(outcomeNotifies(outcome), false);
  });

  it('starts from the message importance when no rule sets one', () => {
    const outcome = evaluateInboxRules([rule('a', { appliesToAll: true, actions: { star: true } })], facts({ importance: 'high' }));
    assert.equal(outcome.importance, 'high');
  });
});

describe('helpers', () => {
  it('reports which rules need the body or headers', () => {
    assert.equal(ruleNeedsBody(definition({ conditions: { subjectOrBodyContains: ['x'] }, actions: { star: true } })), true);
    assert.equal(ruleNeedsBody(definition({ conditions: { from: ['x.example'] }, exceptions: { bodyContains: ['y'] }, actions: { star: true } })), true);
    assert.equal(ruleNeedsBody(definition({ conditions: { subjectContains: ['x'] }, actions: { star: true } })), false);
    assert.equal(ruleNeedsHeaders(definition({ appliesToAll: true, exceptions: { headerContains: ['List-Id'] }, actions: { star: true } })), true);
    assert.equal(ruleNeedsHeaders(definition({ appliesToAll: true, actions: { star: true } })), false);
  });

  it('builds header text from parsed headers within a bound', () => {
    assert.equal(ruleHeaderText([{ key: 'list-id', originalKey: 'List-Id', value: '<a.b>' }, { key: 'x', value: 'y' }]), 'List-Id: <a.b>\nx: y\n');
    assert.ok(ruleHeaderText(Array.from({ length: 2000 }, () => ({ key: 'x', value: 'y'.repeat(100) }))).length <= 65_536);
  });

  it('reads the text part, or the HTML without tags, scripts and styles', () => {
    assert.equal(ruleBodyText('plain', '<p>html</p>'), 'plain');
    assert.equal(ruleBodyText('', '<style>p{}</style><p>Fish &amp; chips</p><script>x()</script>').replace(/\s+/g, ' ').trim(), 'Fish & chips');
    assert.equal(ruleBodyText(null, null), '');
  });

  it('strips HTML in one pass, including unclosed and hostile markup', () => {
    const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
    assert.equal(squash(ruleBodyText('', '<SCRIPT type="x">if (a > b) go()</Script ><p>kept</p>')), 'kept');
    assert.equal(squash(ruleBodyText('', '<p>before</p><style>p { color: red }')), 'before');
    assert.equal(squash(ruleBodyText('', '<p>Fish &lt; chips</p> <unterminated')), 'Fish < chips <unterminated');
    assert.equal(squash(ruleBodyText('', '<p>Write &amp;lt; for &LT; &amp; &#39;quotes&#39;</p>')), "Write &lt; for < & 'quotes'");
    assert.equal(squash(ruleBodyText('', '<Style>p { color: red }</STYLE><SCRIPT>go()</script >kept')), 'kept');
    // Quadratic under the old tag regex: about a minute for this input.
    assert.equal(ruleBodyText('', '<'.repeat(200_000)).length, 200_000);
    assert.equal(squash(ruleBodyText('', '<script>'.repeat(30_000))), '');
  });

  it('describes rules in plain language', () => {
    const described = definition({
      conditions: { from: ['partner.example'], subjectContains: ['invoice', 'receipt'], myPosition: 'cc', sizeAtLeastKb: 100 },
      actions: { moveTo: 'spam', markAsRead: true, star: true, setImportance: 'low' },
    });
    assert.deepEqual(describeConditions(described.conditions), [
      'From partner.example',
      'Subject includes "invoice" or "receipt"',
      "I'm on the Cc line",
      'Size is at least 100 KB',
    ]);
    assert.deepEqual(describeActions(described.actions), ['Move to Junk', 'Mark as read', 'Star it', 'Set importance to low']);
  });
});
