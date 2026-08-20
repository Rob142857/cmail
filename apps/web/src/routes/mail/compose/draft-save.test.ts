import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

interface QueryCall {
  sql: string;
  values: unknown[];
}

function draftDatabase(): { db: D1Database; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, values: [] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.values = values;
          return statement;
        },
        async first() {
          if (sql.includes('SELECT m.id, m.display_name FROM mailboxes')) {
            return { id: 'mailbox-1', display_name: 'Robert Evans' };
          }
          if (sql.includes('INSERT INTO rate_limits')) return { count: 1 };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO messages')) {
            const placeholderCount = (sql.match(/\?/g) || []).length;
            if (placeholderCount !== call.values.length) {
              throw new Error(`D1 bind arity mismatch: ${placeholderCount} placeholders for ${call.values.length} values`);
            }
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('compose draft persistence', () => {
  it('persists a new draft with one D1 placeholder for every bound value', async () => {
    const { db, calls } = draftDatabase();
    const storage = {
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } as unknown as R2Bucket;
    const formData = new FormData();
    formData.set('from', 'robert.evans@cliomuseum.org');
    formData.set('to', 'recipient@example.net');
    formData.set('subject', 'Draft persistence regression');
    formData.set('body', 'Hello from the draft-save regression test.');
    formData.set('importance', 'normal');
    formData.set('draft_create_token', '11111111-1111-4111-8111-111111111111');

    const result = await (actions.save as any)({
      request: new Request('https://mail.cliomuseum.org/mail/compose?/save', {
        method: 'POST',
        body: formData,
      }),
      locals: {
        user: {
          id: 'user-1',
          email: 'robert.evans@cliomuseum.org',
          display_name: 'Robert Evans',
          role: 'manager',
          status: 'active',
          auth_provider: 'google',
          created_at: '2026-08-17 00:00:00',
          updated_at: '2026-08-17 00:00:00',
          last_sign_in: null,
          last_auth_country: null,
        },
        sessionId: 'session-1',
      },
      platform: {
        env: {
          DB: db,
          STORAGE: storage,
          MAIL_DOMAIN: 'cliomuseum.org',
        },
      },
    });

    expect(result).toMatchObject({
      savedDraftId: '11111111-1111-4111-8111-111111111111',
      draftVersion: 1,
    });
    expect(storage.put).toHaveBeenCalledOnce();

    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO messages'));
    expect(insert).toBeDefined();
    expect((insert!.sql.match(/\?/g) || []).length).toBe(18);
    expect(insert!.values).toHaveLength(18);
    expect(insert!.sql).toMatch(/body_r2_key, size_bytes, folder[\s\S]+\?, \?, 'drafts'/);
    expect(insert!.values[12]).toEqual(expect.any(Number));
  });
});
