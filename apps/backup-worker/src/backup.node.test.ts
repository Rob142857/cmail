import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { backupConfiguration, dayOf, runBackup, type BackupEnv } from './backup';

// An in-memory R2 bucket with the subset of the API the backup uses.
function memoryBucket(options: { failGet?: (key: string) => boolean } = {}) {
  const objects = new Map<string, { body: string; etag: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>();
  let version = 0;
  const asObject = (key: string) => {
    const value = objects.get(key)!;
    return { key, size: value.body.length, etag: value.etag, httpMetadata: value.httpMetadata, customMetadata: value.customMetadata ?? {} };
  };
  const bucket = {
    objects,
    async list({ prefix = '', cursor, limit = 1000 }: R2ListOptions = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return { objects: page.map(asObject), truncated, cursor: truncated ? String(start + limit) : undefined, delimitedPrefixes: [] };
    },
    async get(key: string) {
      if (options.failGet?.(key)) throw new Error('R2 get failed');
      if (!objects.has(key)) return null;
      const value = objects.get(key)!;
      return { ...asObject(key), body: value.body, text: async () => value.body };
    },
    async head(key: string) {
      return objects.has(key) ? asObject(key) : null;
    },
    async put(key: string, body: string | ReadableStream, putOptions: R2PutOptions = {}) {
      const text = typeof body === 'string' ? body : await new Response(body).text();
      version += 1;
      objects.set(key, { body: text, etag: `etag-${version}`, httpMetadata: putOptions.httpMetadata as R2HTTPMetadata, customMetadata: putOptions.customMetadata });
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return bucket;
}

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE mailboxes (id TEXT PRIMARY KEY, address TEXT NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, mailbox_id TEXT, subject TEXT);
    CREATE INDEX idx_messages_mailbox ON messages(mailbox_id);
    INSERT INTO mailboxes VALUES ('mb-1', 'team@example.test');
  `);
  const insert = sqlite.prepare('INSERT INTO messages VALUES (?, ?, ?)');
  for (let index = 0; index < 1203; index += 1) insert.run(`m-${index}`, 'mb-1', `Subject ${index}`);
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...(args as never[])) }),
  });
  return { d1: { prepare: (sql: string) => prepare(sql) } as unknown as D1Database, sqlite };
}

function setup(sourceKeys: string[] = ['messages/a/body', 'attachments/a/1']) {
  const source = memoryBucket();
  for (const key of sourceKeys) source.objects.set(key, { body: `content of ${key}`, etag: `src-${key}`, httpMetadata: { contentType: 'text/html' } });
  const backup = memoryBucket();
  const { d1 } = database();
  const env = { SOURCE: source, BACKUP: backup, DB: d1 } as unknown as BackupEnv;
  return { source, backup, env };
}

const DAY = new Date('2026-10-31T03:23:00Z');
const later = (days: number) => new Date(DAY.getTime() + days * 86_400_000);

describe('backup configuration', () => {
  it('uses safe defaults and bounds operator values', () => {
    expect(backupConfiguration({})).toEqual({ retentionDays: 30, maxCopies: 200 });
    expect(backupConfiguration({ BACKUP_RETENTION_DAYS: '1', BACKUP_MAX_COPIES_PER_RUN: '5000' })).toEqual({ retentionDays: 7, maxCopies: 1000 });
    expect(backupConfiguration({ BACKUP_RETENTION_DAYS: 'soon', BACKUP_MAX_COPIES_PER_RUN: '' })).toEqual({ retentionDays: 30, maxCopies: 200 });
    expect(dayOf(DAY)).toBe('2026-10-31');
  });
});

describe('mail object backup', () => {
  it('copies every object with its metadata, writes the manifest and dumps the database', async () => {
    const { backup, env } = setup();
    const summary = await runBackup(env, DAY);
    expect(summary).toMatchObject({ sourceObjects: 2, copied: 2, pendingCopies: 0, manifestWritten: true, databaseTables: 2 });
    expect(backup.objects.get('objects/messages/a/body')).toMatchObject({
      body: 'content of messages/a/body',
      httpMetadata: { contentType: 'text/html' },
      customMetadata: { sourceEtag: 'src-messages/a/body' },
    });
    const manifest = JSON.parse(backup.objects.get('manifests/2026-10-31.json')!.body);
    expect(manifest.objects.map((entry: { key: string }) => entry.key).sort()).toEqual(['attachments/a/1', 'messages/a/body']);
  });

  it('copies only what is new on the next run', async () => {
    const { source, env } = setup();
    await runBackup(env, DAY);
    source.objects.set('messages/b/body', { body: 'new', etag: 'src-new' });
    expect(await runBackup(env, later(0))).toMatchObject({ copied: 1, sourceObjects: 3 });
    expect(await runBackup(env, later(0))).toMatchObject({ copied: 0 });
  });

  it('spreads a large first backup over several runs, and writes the manifest only when complete', async () => {
    const { backup, env } = setup(Array.from({ length: 5 }, (_, index) => `messages/${index}/body`));
    (env as unknown as Record<string, string>).BACKUP_MAX_COPIES_PER_RUN = '2';
    expect(await runBackup(env, DAY)).toMatchObject({ copied: 2, pendingCopies: 3, manifestWritten: false });
    expect(backup.objects.has('manifests/2026-10-31.json')).toBe(false);
    await runBackup(env, DAY);
    expect(await runBackup(env, DAY)).toMatchObject({ copied: 1, pendingCopies: 0, manifestWritten: true });
  });

  it('counts a failed copy without stopping the others', async () => {
    const { env } = setup();
    const source = memoryBucket({ failGet: (key) => key === 'attachments/a/1' });
    source.objects.set('messages/a/body', { body: 'x', etag: 'e1' });
    source.objects.set('attachments/a/1', { body: 'y', etag: 'e2' });
    const summary = await runBackup({ ...env, SOURCE: source as unknown as R2Bucket }, DAY);
    expect(summary).toMatchObject({ copied: 1, copyFailures: 1, pendingCopies: 1, manifestWritten: false });
  });

  it('keeps an object deleted from the source for the retention window, then removes it', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    source.objects.delete('messages/a/body');

    expect(await runBackup(env, later(1))).toMatchObject({ markedMissing: 1 });
    await runBackup(env, later(29));
    expect(backup.objects.has('objects/messages/a/body')).toBe(true);

    await runBackup(env, later(31));
    expect(backup.objects.has('objects/messages/a/body')).toBe(false);
    expect(backup.objects.has('objects/attachments/a/1')).toBe(true);
  });

  it('forgets a missing mark if the object comes back', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    const saved = source.objects.get('messages/a/body')!;
    source.objects.delete('messages/a/body');
    await runBackup(env, later(1));
    source.objects.set('messages/a/body', saved);
    await runBackup(env, later(2));
    expect(JSON.parse(backup.objects.get('state/missing.json')!.body)).toEqual({});
    await runBackup(env, later(40));
    expect(backup.objects.has('objects/messages/a/body')).toBe(true);
  });
});

describe('database dump', () => {
  it('writes every table as NDJSON, paging past 500 rows, plus the schema, once per day', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    const messages = backup.objects.get('d1/2026-10-31/tables/messages.ndjson')!.body.trim().split('\n');
    expect(messages).toHaveLength(1203);
    expect(JSON.parse(messages[1202])).toEqual({ id: 'm-1202', mailbox_id: 'mb-1', subject: 'Subject 1202' });
    expect(backup.objects.get('d1/2026-10-31/schema.sql')!.body).toContain('CREATE INDEX idx_messages_mailbox');
    expect(JSON.parse(backup.objects.get('d1/2026-10-31/complete.json')!.body).tables).toEqual(['mailboxes', 'messages']);

    expect((await runBackup(env, DAY)).databaseTables).toBeNull();
    expect((await runBackup(env, later(1))).databaseTables).toBe(2);
  });

  it('removes manifests and dumps older than the retention window', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    await runBackup(env, later(31));
    expect(backup.objects.has('manifests/2026-10-31.json')).toBe(false);
    expect([...backup.objects.keys()].some((key) => key.startsWith('d1/2026-10-31/'))).toBe(false);
    expect(backup.objects.has('manifests/2026-12-01.json')).toBe(true);
  });
});
