import { describe, expect, it } from 'vitest';
import { GET as downloadAttachment } from '../api/attachment/[id]/+server';
import { PATCH as mutateMessages } from '../api/messages/bulk/+server';
import { DELETE as deleteMessage, PATCH as mutateMessage } from '../api/messages/[id]/+server';
import { load as listMessages } from './+page.server';
import { actions as composeActions, load as loadCompose } from './compose/+page.server';
import { load as loadMessage } from './[id]/+page.server';

interface CapturedDatabase {
  db: D1Database;
  queries: string[];
}

function capturedDatabase(): CapturedDatabase {
  const queries: string[] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      const statement = {
        bind() {
          return statement;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, queries };
}

function platform(db: D1Database): App.Platform {
  return {
    env: {
      DB: db,
      STORAGE: {} as R2Bucket,
    } as App.Platform['env'],
    context: {} as ExecutionContext,
    caches: {},
  } as unknown as App.Platform;
}

function locals(role: 'standard' | 'manager' = 'standard'): App.Locals {
  return {
    user: {
      id: 'user-1',
      email: 'person@example.com',
      display_name: 'Example Person',
      role,
      status: 'active',
      auth_provider: 'google',
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      last_sign_in: null,
    },
    sessionId: 'session-1',
  };
}

function expectActiveMailboxFilter(query: string | undefined, alias = 'mb'): void {
  expect(query).toMatch(new RegExp(`\\b${alias}\\.status\\s*=\\s*'active'`));
}

describe('disabled mailbox access boundaries', () => {
  it('omits disabled mailboxes from global and mailbox-filtered message lists', async () => {
    const global = capturedDatabase();
    const globalResult = await (listMessages as any)({
      locals: locals(),
      platform: platform(global.db),
      url: new URL('https://mail.example.com/mail'),
    });
    expect(globalResult.messages).toEqual([]);
    expectActiveMailboxFilter(global.queries[0]);

    const specific = capturedDatabase();
    const specificResult = await (listMessages as any)({
      locals: locals(),
      platform: platform(specific.db),
      url: new URL('https://mail.example.com/mail?mailbox=disabled-mailbox'),
    });
    expect(specificResult.messages).toEqual([]);
    expect(specificResult.mailboxId).toBeNull();
    expectActiveMailboxFilter(specific.queries[0]);
    expectActiveMailboxFilter(specific.queries[1], 'm');
  });

  it.each(['standard', 'manager'] as const)(
    'returns the same non-disclosing 404 for direct message access by a %s user',
    async (role) => {
      const captured = capturedDatabase();
      await expect((loadMessage as any)({
        locals: locals(role),
        platform: platform(captured.db),
        params: { id: 'disabled-message' },
        url: new URL('https://mail.example.com/mail/disabled-message'),
      })).rejects.toMatchObject({ status: 404 });
      expectActiveMailboxFilter(captured.queries[0]);
    },
  );

  it('returns 404 before single, bulk, delete, or attachment operations can reach disabled mailbox data', async () => {
    const single = capturedDatabase();
    await expect((mutateMessage as any)({
      locals: locals(),
      platform: platform(single.db),
      params: { id: 'disabled-message' },
      request: new Request('https://mail.example.com/api/messages/disabled-message', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }),
    })).rejects.toMatchObject({ status: 404 });
    expectActiveMailboxFilter(single.queries[0]);

    const deletion = capturedDatabase();
    await expect((deleteMessage as any)({
      locals: locals(),
      platform: platform(deletion.db),
      params: { id: 'disabled-message' },
    })).rejects.toMatchObject({ status: 404 });
    expectActiveMailboxFilter(deletion.queries[0]);

    const bulk = capturedDatabase();
    await expect((mutateMessages as any)({
      locals: locals(),
      platform: platform(bulk.db),
      request: new Request('https://mail.example.com/api/messages/bulk', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['disabled-message'], action: 'read' }),
      }),
    })).rejects.toMatchObject({ status: 404 });
    expectActiveMailboxFilter(bulk.queries[0]);

    const attachment = capturedDatabase();
    await expect((downloadAttachment as any)({
      locals: locals(),
      platform: platform(attachment.db),
      params: { id: 'disabled-attachment' },
    })).rejects.toMatchObject({ status: 404 });
    expectActiveMailboxFilter(attachment.queries[0]);
  });

  it('does not load disabled draft, reply, forward, or discard resources', async () => {
    const compose = capturedDatabase();
    const result = await (loadCompose as any)({
      locals: locals(),
      platform: platform(compose.db),
      url: new URL('https://mail.example.com/mail/compose?draft=disabled-draft&reply=disabled-message'),
    });
    expect(result.draft).toBeNull();
    expect(result.replyTo).toBeNull();
    expectActiveMailboxFilter(compose.queries[0], 'm');
    expectActiveMailboxFilter(compose.queries[1]);
    expectActiveMailboxFilter(compose.queries[2]);

    const discard = capturedDatabase();
    const formData = new FormData();
    formData.set('draft_id', 'disabled-draft');
    const discardResult = await (composeActions.discard as any)({
      locals: locals(),
      platform: platform(discard.db),
      request: new Request('https://mail.example.com/mail/compose?/discard', {
        method: 'POST',
        body: formData,
      }),
    });
    expect(discardResult).toMatchObject({ status: 404, data: { error: 'Draft not found' } });
    expectActiveMailboxFilter(discard.queries[0]);
  });
});
