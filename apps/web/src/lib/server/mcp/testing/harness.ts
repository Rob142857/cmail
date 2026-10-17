// Test-only harness: a D1-compatible adapter over node:sqlite with every real
// migration applied, an in-memory R2 bucket, and seed helpers. Imported only
// by *.test.ts files, so it never reaches the production bundle.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../packages/shared/migrations');

function normalise(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SQLInputValue;
}

class Statement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly args: unknown[] = [],
  ) {}

  bind(...args: unknown[]): Statement {
    return new Statement(this.database, this.sql, args);
  }

  private prepared() {
    return this.database.prepare(this.sql);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.prepared().get(...this.args.map(normalise)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.prepared().all(...this.args.map(normalise)) as Record<string, unknown>[];
    return { results: rows.map((row) => ({ ...row })) as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const statement = this.prepared();
    if (/\bRETURNING\b/i.test(this.sql)) {
      const rows = statement.all(...this.args.map(normalise));
      return { success: true, meta: { changes: rows.length, last_row_id: 0 } };
    }
    const result = statement.run(...this.args.map(normalise));
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async raw(): Promise<unknown[][]> {
    const rows = this.prepared().all(...this.args.map(normalise)) as Record<string, unknown>[];
    return rows.map((row) => Object.values(row));
  }
}

export interface TestDatabase {
  d1: D1Database;
  sqlite: DatabaseSync;
}

export function createTestDatabase(): TestDatabase {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
  }
  const d1 = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (caught) {
        sqlite.exec('ROLLBACK');
        throw caught;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
  return { d1, sqlite };
}

export function createTestBucket(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const toBytes = async (value: unknown): Promise<Uint8Array> => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
    throw new Error('Unsupported R2 body in test bucket');
  };
  const objectFor = (key: string, bytes: Uint8Array) => ({
    key,
    size: bytes.byteLength,
    httpMetadata: {},
    customMetadata: {},
    async text() { return new TextDecoder().decode(bytes); },
    async arrayBuffer() { return bytes.slice().buffer; },
    async bytes() { return bytes.slice(); },
    get body() { return new Response(bytes.slice()).body; },
  });
  return {
    objects,
    async put(key: string, value: unknown) {
      const bytes = await toBytes(value);
      objects.set(key, bytes);
      return objectFor(key, bytes);
    },
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? objectFor(key, bytes) : null;
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? objectFor(key, bytes) : null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list(options: { prefix?: string } = {}) {
      const prefix = options.prefix ?? '';
      return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  } as unknown as R2Bucket & { objects: Map<string, Uint8Array> };
}

export const APP_URL = 'https://mail.example.test';
export const RESOURCE = `${APP_URL}/mcp`;

export interface Fixture {
  db: TestDatabase;
  bucket: ReturnType<typeof createTestBucket>;
  env: Record<string, unknown>;
  platform: App.Platform;
  waitUntil: Promise<unknown>[];
}

/**
 * Two users. Alice owns alice@example.test and has full access to the shared
 * desk@example.test; Bob owns bob@example.test and has read-only access to the
 * desk. AI app connections are switched on.
 */
export function createFixture(extraEnv: Record<string, unknown> = {}): Fixture {
  const db = createTestDatabase();
  const bucket = createTestBucket();
  const waitUntil: Promise<unknown>[] = [];
  db.sqlite.exec(`
    INSERT INTO users (id, email, display_name, role, status, auth_provider) VALUES
      ('user-alice', 'alice@example.test', 'Alice Example', 'standard', 'active', 'google'),
      ('user-bob', 'bob@example.test', 'Bob Example', 'standard', 'active', 'microsoft');
    INSERT INTO mailboxes (id, address, type, display_name, status, owner_user_id) VALUES
      ('mb-alice', 'alice@example.test', 'personal', 'Alice Example', 'active', 'user-alice'),
      ('mb-bob', 'bob@example.test', 'personal', 'Bob Example', 'active', 'user-bob'),
      ('mb-desk', 'desk@example.test', 'shared', 'Help Desk', 'active', NULL);
    INSERT INTO mailbox_assignments (user_id, mailbox_id, permissions) VALUES
      ('user-alice', 'mb-alice', 'full'),
      ('user-alice', 'mb-desk', 'full'),
      ('user-bob', 'mb-bob', 'full'),
      ('user-bob', 'mb-desk', 'read');
    INSERT INTO org_settings (key, value) VALUES ('mcp_enabled', 'true');
  `);
  const env: Record<string, unknown> = {
    DB: db.d1,
    STORAGE: bucket,
    APP_URL,
    APP_NAME: 'cmail',
    MAIL_DOMAIN: 'example.test',
    SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
    OUTBOUND_PROVIDER: 'none',
    ...extraEnv,
  };
  const platform = {
    env,
    context: { waitUntil(promise: Promise<unknown>) { waitUntil.push(promise.catch(() => undefined)); } },
    caches: {},
  } as unknown as App.Platform;
  return { db, bucket, env, platform, waitUntil };
}

export function seedMessage(
  fixture: Fixture,
  message: {
    id: string;
    mailboxId: string;
    folder?: string;
    subject?: string;
    from?: string;
    body?: string;
    threadId?: string;
    draftOwnerId?: string | null;
    receivedAt?: string;
    isRead?: number;
  },
): void {
  const key = `messages/${message.mailboxId}/${message.id}/body.html`;
  fixture.bucket.objects.set(key, new TextEncoder().encode(message.body ?? '<p>Hello there</p>'));
  fixture.db.sqlite.prepare(
    `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, subject, snippet,
       body_r2_key, size_bytes, folder, draft_owner_id, is_read, thread_id, received_at)
     VALUES (?, ?, ?, 'inbound', ?, '["alice@example.test"]', ?, ?, ?, 100, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.mailboxId,
    `<${message.id}@sender.example>`,
    message.from ?? 'sender@external.example',
    message.subject ?? 'Quarterly numbers',
    (message.body ?? 'Hello there').replace(/<[^>]+>/g, '').slice(0, 100),
    key,
    message.folder ?? 'inbox',
    message.draftOwnerId ?? null,
    message.isRead ?? 0,
    message.threadId ?? null,
    message.receivedAt ?? '2026-10-10 09:00:00',
  );
}
