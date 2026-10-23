import { describe, expect, it } from 'vitest';
import { actions as listActions, load as listLoad } from './+page.server';
import { actions as editorActions, load as editorLoad } from './edit/+page.server';
import { APP_URL, createFixture, type Fixture } from '#lib/server/mcp/testing/harness.js';

type Outcome = { value?: any; redirect?: { status: number; location: string } };

async function run(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await fn() };
  } catch (caught) {
    if (caught && typeof caught === 'object' && 'location' in caught) {
      return { redirect: caught as { status: number; location: string } };
    }
    throw caught;
  }
}

function locals(fixture: Fixture, userId: string) {
  const user = fixture.db.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return { user, sessionId: 'session-1' };
}

function post(fixture: Fixture, userId: string, action: (event: any) => Promise<unknown>, path: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return run(() => action({
    request: new Request(`${APP_URL}${path}`, { method: 'POST', body: form }),
    locals: locals(fixture, userId),
    platform: fixture.platform,
    url: new URL(`${APP_URL}${path}`),
  }));
}

function save(fixture: Fixture, userId: string, fields: Record<string, string>) {
  return post(fixture, userId, editorActions.save as any, '/mail/rules/edit?/save', fields);
}

function listAction(fixture: Fixture, userId: string, name: 'toggle' | 'move' | 'delete' | 'run', fields: Record<string, string>) {
  return post(fixture, userId, listActions[name] as any, `/mail/rules?/${name}`, fields);
}

const ARCHIVE_NEWS = JSON.stringify({ conditions: { from: ['news.example'] }, actions: { moveTo: 'archive', markAsRead: true } });

function rules(fixture: Fixture, mailboxId: string) {
  return fixture.db.sqlite.prepare(
    'SELECT id, name, position, is_enabled, stop_processing, definition, created_by FROM inbox_rules WHERE mailbox_id = ? ORDER BY position',
  ).all(mailboxId) as Array<{ id: string; name: string; position: number; is_enabled: number; stop_processing: number; definition: string; created_by: string }>;
}

function inbox(fixture: Fixture, id: string, mailboxId: string, from: string, folder = 'inbox') {
  fixture.db.sqlite.prepare(
    `INSERT INTO messages (id, mailbox_id, direction, from_address, to_addresses, subject, folder, received_at)
     VALUES (?, ?, 'inbound', ?, '["alice@example.test"]', 'Hello', ?, datetime('now'))`,
  ).run(id, mailboxId, from, folder);
}

function message(fixture: Fixture, id: string) {
  return fixture.db.sqlite.prepare('SELECT folder, is_read FROM messages WHERE id = ?').get(id) as { folder: string; is_read: number };
}

describe('/mail/rules access', () => {
  it('lists only mailboxes the user has full access to', async () => {
    const fixture = createFixture();
    const alice = await run(() => (listLoad as any)({ locals: locals(fixture, 'user-alice'), platform: fixture.platform, url: new URL(`${APP_URL}/mail/rules`) }));
    expect(alice.value.mailboxes.map((mailbox: { id: string }) => mailbox.id)).toEqual(['mb-alice', 'mb-desk']);
    const bob = await run(() => (listLoad as any)({ locals: locals(fixture, 'user-bob'), platform: fixture.platform, url: new URL(`${APP_URL}/mail/rules?mailbox=mb-desk`) }));
    expect(bob.value.mailboxes.map((mailbox: { id: string }) => mailbox.id)).toEqual(['mb-bob']);
    // A mailbox the user can only read falls back to one they manage.
    expect(bob.value.mailbox.id).toBe('mb-bob');
  });

  it('refuses to save a rule for a mailbox without full access', async () => {
    const fixture = createFixture();
    const result = await save(fixture, 'user-bob', { mailbox_id: 'mb-desk', name: 'Desk', definition: ARCHIVE_NEWS, enabled: 'on' });
    expect(result.value).toMatchObject({ status: 403 });
    expect(rules(fixture, 'mb-desk')).toEqual([]);
  });

  it("refuses list actions on another mailbox's rule", async () => {
    const fixture = createFixture();
    await save(fixture, 'user-bob', { mailbox_id: 'mb-bob', name: 'Bob news', definition: ARCHIVE_NEWS, enabled: 'on' });
    const bobRule = rules(fixture, 'mb-bob')[0];
    for (const action of ['toggle', 'delete', 'run'] as const) {
      const result = await listAction(fixture, 'user-alice', action, { mailbox_id: 'mb-alice', rule_id: bobRule.id });
      expect(result.value).toMatchObject({ status: 404 });
    }
    expect(rules(fixture, 'mb-bob')[0]).toMatchObject({ is_enabled: 1 });
  });
});

describe('/mail/rules/edit', () => {
  it('creates a rule, records who made it, and returns to the list', async () => {
    const fixture = createFixture();
    const result = await save(fixture, 'user-alice', {
      mailbox_id: 'mb-desk',
      name: '  Newsletters  ',
      definition: ARCHIVE_NEWS,
      stop_processing: 'on',
      enabled: 'on',
    });
    expect(result.redirect).toEqual(expect.objectContaining({ status: 303, location: '/mail/rules?mailbox=mb-desk&saved=created' }));
    expect(rules(fixture, 'mb-desk')).toEqual([expect.objectContaining({
      name: 'Newsletters', position: 0, is_enabled: 1, stop_processing: 1, created_by: 'user-alice',
    })]);
    const auditRow = fixture.db.sqlite.prepare("SELECT event_type, target, detail FROM audit_log WHERE event_type LIKE 'inbox_rule.%'").get();
    expect(auditRow).toEqual({ event_type: 'inbox_rule.create', target: 'mb-desk', detail: 'Created inbox rule "Newsletters"' });
  });

  it('rejects an invalid rule without saving it', async () => {
    const fixture = createFixture();
    for (const definition of [
      JSON.stringify({ conditions: { from: ['news.example'] }, actions: { forwardTo: 'x@evil.example' } }),
      JSON.stringify({ conditions: {}, actions: { star: true } }),
      '{broken',
    ]) {
      const result = await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name: 'Bad', definition });
      expect(result.value).toMatchObject({ status: 400 });
    }
    expect((await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name: ' ', definition: ARCHIVE_NEWS })).value).toMatchObject({ status: 400 });
    expect(rules(fixture, 'mb-alice')).toEqual([]);
  });

  it('runs the new rule on the Inbox when asked, and only there', async () => {
    const fixture = createFixture();
    inbox(fixture, 'news-1', 'mb-alice', 'weekly@news.example');
    inbox(fixture, 'news-2', 'mb-alice', 'daily@mail.news.example');
    inbox(fixture, 'other', 'mb-alice', 'friend@example.test');
    inbox(fixture, 'news-junk', 'mb-alice', 'weekly@news.example', 'spam');
    inbox(fixture, 'news-desk', 'mb-desk', 'weekly@news.example');
    const result = await save(fixture, 'user-alice', {
      mailbox_id: 'mb-alice', name: 'News', definition: ARCHIVE_NEWS, enabled: 'on', run_now: 'on',
    });
    expect(result.redirect?.location).toBe('/mail/rules?mailbox=mb-alice&saved=created&ran=2');
    expect(message(fixture, 'news-1')).toEqual({ folder: 'archive', is_read: 1 });
    expect(message(fixture, 'news-2')).toEqual({ folder: 'archive', is_read: 1 });
    expect(message(fixture, 'other')).toEqual({ folder: 'inbox', is_read: 0 });
    expect(message(fixture, 'news-junk')).toEqual({ folder: 'spam', is_read: 0 });
    expect(message(fixture, 'news-desk')).toEqual({ folder: 'inbox', is_read: 0 });
  });

  it('edits an existing rule in place and keeps its position', async () => {
    const fixture = createFixture();
    await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name: 'First', definition: ARCHIVE_NEWS, enabled: 'on' });
    await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name: 'Second', definition: ARCHIVE_NEWS, enabled: 'on' });
    const [first] = rules(fixture, 'mb-alice');
    const result = await save(fixture, 'user-alice', {
      mailbox_id: 'mb-alice', rule_id: first.id, name: 'First, renamed', definition: JSON.stringify({ appliesToAll: true, actions: { star: true } }),
    });
    expect(result.redirect?.location).toBe('/mail/rules?mailbox=mb-alice&saved=updated');
    expect(rules(fixture, 'mb-alice').map((rule) => [rule.name, rule.position, rule.is_enabled, rule.stop_processing])).toEqual([
      ['First, renamed', 0, 0, 0],
      ['Second', 1, 1, 0],
    ]);
  });

  it('loads a rule for editing only from a mailbox the user manages', async () => {
    const fixture = createFixture();
    await save(fixture, 'user-bob', { mailbox_id: 'mb-bob', name: 'Bob news', definition: ARCHIVE_NEWS, enabled: 'on' });
    const bobRule = rules(fixture, 'mb-bob')[0];
    const load = (userId: string, query: string) => run(() => (editorLoad as any)({
      locals: locals(fixture, userId), platform: fixture.platform, url: new URL(`${APP_URL}/mail/rules/edit?${query}`),
    }));
    const own = await load('user-bob', `mailbox=mb-bob&rule=${bobRule.id}`);
    expect(own.value.rule).toMatchObject({ id: bobRule.id, name: 'Bob news', definition: { conditions: { from: ['news.example'] } } });
    await expect(load('user-alice', `mailbox=mb-bob&rule=${bobRule.id}`)).rejects.toMatchObject({ status: 404 });
    const prefilled = await load('user-alice', 'from=weekly%40news.example%0AInjected');
    expect(prefilled.value).toMatchObject({ mailbox: { id: 'mb-alice' }, rule: null, prefill: { from: 'weekly@news.example Injected' } });
  });

  it('stops at the per-mailbox limit', async () => {
    const fixture = createFixture();
    for (let index = 0; index < 50; index += 1) {
      fixture.db.sqlite.prepare(
        "INSERT INTO inbox_rules (id, mailbox_id, name, position, definition) VALUES (?, 'mb-alice', ?, ?, ?)",
      ).run(`seed-${index}`, `Rule ${index}`, index, ARCHIVE_NEWS);
    }
    const result = await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name: 'One more', definition: ARCHIVE_NEWS });
    expect(result.value).toMatchObject({ status: 400, data: { error: expect.stringContaining('up to 50 rules') } });
  });
});

describe('/mail/rules list actions', () => {
  async function threeRules(fixture: Fixture) {
    for (const name of ['A', 'B', 'C']) {
      await save(fixture, 'user-alice', { mailbox_id: 'mb-alice', name, definition: ARCHIVE_NEWS, enabled: 'on' });
    }
    return rules(fixture, 'mb-alice');
  }

  it('turns a rule off and on', async () => {
    const fixture = createFixture();
    const [first] = await threeRules(fixture);
    expect((await listAction(fixture, 'user-alice', 'toggle', { mailbox_id: 'mb-alice', rule_id: first.id })).value).toEqual({ success: '"A" is off.' });
    expect(rules(fixture, 'mb-alice')[0].is_enabled).toBe(0);
    expect((await listAction(fixture, 'user-alice', 'toggle', { mailbox_id: 'mb-alice', rule_id: first.id })).value).toEqual({ success: '"A" is on.' });
  });

  it('reorders rules, renumbering past gaps, and refuses to move past either end', async () => {
    const fixture = createFixture();
    const [first, second, third] = await threeRules(fixture);
    await listAction(fixture, 'user-alice', 'delete', { mailbox_id: 'mb-alice', rule_id: second.id });
    expect((await listAction(fixture, 'user-alice', 'move', { mailbox_id: 'mb-alice', rule_id: third.id, direction: 'up' })).value)
      .toEqual({ success: 'Moved "C" up.' });
    expect(rules(fixture, 'mb-alice').map((rule) => [rule.name, rule.position])).toEqual([['C', 0], ['A', 1]]);
    expect((await listAction(fixture, 'user-alice', 'move', { mailbox_id: 'mb-alice', rule_id: third.id, direction: 'up' })).value)
      .toMatchObject({ status: 400 });
    expect((await listAction(fixture, 'user-alice', 'move', { mailbox_id: 'mb-alice', rule_id: first.id, direction: 'sideways' })).value)
      .toMatchObject({ status: 400 });
  });

  it('runs a rule now, but not one that tests the body', async () => {
    const fixture = createFixture();
    inbox(fixture, 'news-1', 'mb-alice', 'weekly@news.example');
    const [first] = await threeRules(fixture);
    expect((await listAction(fixture, 'user-alice', 'run', { mailbox_id: 'mb-alice', rule_id: first.id })).value)
      .toEqual({ success: '"A" applied to 1 message in the Inbox.' });
    expect(message(fixture, 'news-1').folder).toBe('archive');

    await save(fixture, 'user-alice', {
      mailbox_id: 'mb-alice', name: 'Body', enabled: 'on',
      definition: JSON.stringify({ conditions: { bodyContains: ['unsubscribe'] }, actions: { star: true } }),
    });
    const bodyRule = rules(fixture, 'mb-alice').find((rule) => rule.name === 'Body');
    expect((await listAction(fixture, 'user-alice', 'run', { mailbox_id: 'mb-alice', rule_id: bodyRule!.id })).value)
      .toMatchObject({ status: 400, data: { error: 'Rules that look at the message body or header only apply to new mail.' } });
  });

  it('deletes a rule and records it', async () => {
    const fixture = createFixture();
    const [first] = await threeRules(fixture);
    expect((await listAction(fixture, 'user-alice', 'delete', { mailbox_id: 'mb-alice', rule_id: first.id })).value).toEqual({ success: 'Deleted "A".' });
    expect(rules(fixture, 'mb-alice').map((rule) => rule.name)).toEqual(['B', 'C']);
    expect(fixture.db.sqlite.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event_type = 'inbox_rule.delete'").get()).toEqual({ total: 1 });
  });
});
