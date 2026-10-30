import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupRefused, backupConfiguration, dayOf, largeDeletionsAllowed, runBackup, type BackupEnv } from './backup';

// An in-memory R2 bucket with the subset of the API the backup uses.
function memoryBucket(options: { failGet?: (key: string) => boolean; failList?: boolean } = {}) {
  const objects = new Map<string, { body: string; etag: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }>();
  let version = 0;
  const asObject = (key: string) => {
    const value = objects.get(key)!;
    return { key, size: value.body.length, etag: value.etag, httpMetadata: value.httpMetadata, customMetadata: value.customMetadata ?? {} };
  };
  const bucket = {
    objects,
    async list({ prefix = '', cursor, limit = 1000 }: R2ListOptions = {}) {
      if (options.failList) throw new Error('R2 list failed');
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
      return { ...asObject(key), body: new Blob([value.body]).stream(), text: async () => value.body };
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

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/migrations');

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
  sqlite.prepare("INSERT INTO mailboxes (id, address, type) VALUES ('mb-1', 'team@example.test', 'shared')").run();
  const insert = sqlite.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, 0)");
  for (let index = 0; index < 1203; index += 1) insert.run(`key-${String(index).padStart(5, '0')}`);
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
    expect(summary).toMatchObject({ sourceObjects: 2, copied: 2, pendingCopies: 0, manifestComplete: true });
    expect(backup.objects.get('objects/messages/a/body')).toMatchObject({
      body: 'content of messages/a/body',
      httpMetadata: { contentType: 'text/html' },
      customMetadata: { sourceEtag: 'src-messages/a/body' },
    });
    expect(summary.databaseTables).toBeGreaterThan(20);
    const manifest = JSON.parse(backup.objects.get('manifests/2026-10-31.json')!.body);
    expect(manifest.complete).toBe(true);
    expect(manifest.objects.map((entry: { key: string }) => entry.key).sort()).toEqual(['attachments/a/1', 'messages/a/body']);
  });

  it('copies only what is new on the next run', async () => {
    const { source, env } = setup();
    await runBackup(env, DAY);
    source.objects.set('messages/b/body', { body: 'new', etag: 'src-new' });
    expect(await runBackup(env, later(0))).toMatchObject({ copied: 1, sourceObjects: 3 });
    expect(await runBackup(env, later(0))).toMatchObject({ copied: 0 });
  });

  it('spreads a large first backup over several runs, flagging the manifest incomplete until done', async () => {
    const { backup, env } = setup(Array.from({ length: 5 }, (_, index) => `messages/${index}/body`));
    (env as unknown as Record<string, string>).BACKUP_MAX_COPIES_PER_RUN = '2';
    expect(await runBackup(env, DAY)).toMatchObject({ copied: 2, pendingCopies: 3, manifestComplete: false });
    expect(JSON.parse(backup.objects.get('manifests/2026-10-31.json')!.body).complete).toBe(false);
    await runBackup(env, DAY);
    expect(await runBackup(env, DAY)).toMatchObject({ copied: 1, pendingCopies: 0, manifestComplete: true });
    expect(JSON.parse(backup.objects.get('manifests/2026-10-31.json')!.body).complete).toBe(true);
  });

  it('takes turns, so an object that always fails cannot block the rest', async () => {
    const { env } = setup();
    const source = memoryBucket({ failGet: (key) => key === 'messages/0/body' });
    for (let index = 0; index < 4; index += 1) source.objects.set(`messages/${index}/body`, { body: `m${index}`, etag: `e${index}` });
    const runEnv = { ...env, SOURCE: source as unknown as R2Bucket, BACKUP_MAX_COPIES_PER_RUN: '1' } as BackupEnv;
    let copied = 0;
    for (let hour = 0; hour < 8; hour += 1) copied += (await runBackup(runEnv, new Date(DAY.getTime() + hour * 3_600_000))).copied;
    expect(copied).toBe(3);
  });

  it('counts a failed copy without stopping the others', async () => {
    const { env } = setup();
    const source = memoryBucket({ failGet: (key) => key === 'attachments/a/1' });
    source.objects.set('messages/a/body', { body: 'x', etag: 'e1' });
    source.objects.set('attachments/a/1', { body: 'y', etag: 'e2' });
    const summary = await runBackup({ ...env, SOURCE: source as unknown as R2Bucket }, DAY);
    expect(summary).toMatchObject({ copied: 1, copyFailures: 1, pendingCopies: 1, manifestComplete: false });
  });

  it('keeps the previous copy when an object\'s content changes', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    source.objects.set('messages/a/body', { body: 'rewritten', etag: 'src-changed', httpMetadata: { contentType: 'text/html' } });
    await runBackup(env, later(1));
    expect(backup.objects.get('objects/messages/a/body')!.body).toBe('rewritten');
    const versions = () => [...backup.objects.keys()].filter((key) => key.startsWith('versions/2026-11-01/') && key.endsWith('/messages/a/body'));
    expect(versions()).toHaveLength(1);
    expect(backup.objects.get(versions()[0])!.body).toBe('content of messages/a/body');
    // A second change the same day keeps both earlier versions.
    source.objects.set('messages/a/body', { body: 'again', etag: 'src-again' });
    await runBackup(env, later(1.01));
    expect(versions()).toHaveLength(2);
    await runBackup(env, later(32));
    expect(versions()).toHaveLength(0);
  });

  it('keeps an object deleted from the source for the retention window, then removes it', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    source.objects.delete('messages/a/body');

    expect(await runBackup(env, later(1))).toMatchObject({ markedMissing: 1 });
    await runBackup(env, later(30.99));
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
  it('writes every real table as NDJSON parts, paging by rowid, plus the schema, once per day', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    const complete = JSON.parse(backup.objects.get('d1/2026-10-31/complete.json')!.body);
    expect(complete.tables).toContain('messages');
    expect(complete.tables).toContain('mailbox_reservations');
    const limits = backup.objects.get('d1/2026-10-31/tables/rate_limits/part-00001.ndjson')!.body.trim().split('\n');
    expect(limits).toHaveLength(1203);
    expect(JSON.parse(limits[1202])).toMatchObject({ key: 'key-01202', count: 1 });
    expect(JSON.parse(limits[0])).not.toHaveProperty('__cmail_rowid');
    expect(backup.objects.get('d1/2026-10-31/tables/mailboxes/part-00001.ndjson')!.body).toContain('team@example.test');
    expect(backup.objects.get('d1/2026-10-31/schema.sql')!.body).toContain('CREATE TRIGGER');

    expect((await runBackup(env, DAY)).databaseTables).toBeNull();
    expect((await runBackup(env, later(1))).databaseTables).toBeGreaterThan(20);
  });

  it('still copies, prunes and writes the manifest when the dump fails, and reports it', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    const broken = { ...env, DB: { prepare: () => { throw new Error('D1_ERROR: overloaded'); } } as unknown as D1Database } as BackupEnv;
    const summary = await runBackup(broken, later(31));
    expect(summary).toMatchObject({ databaseTables: null, databaseError: 'Error', manifestComplete: true });
    expect(summary.pruned).toBeGreaterThan(0);
    expect(backup.objects.has('manifests/2026-10-31.json')).toBe(false);
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

describe('safety guards', () => {
  it('refuses, writing nothing, when BACKUP looks like the mail bucket (including the same bucket)', async () => {
    const { source, env } = setup();
    const same = { ...env, BACKUP: source as unknown as R2Bucket } as BackupEnv;
    await expect(runBackup(same, DAY)).rejects.toThrow(BackupRefused);
    expect([...source.objects.keys()].some((key) => /^(objects|state|manifests|d1)\//.test(key))).toBe(false);
  });

  it('refuses when SOURCE holds a backup identity (bindings swapped onto backup buckets)', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    const otherBackup = memoryBucket();
    otherBackup.objects.set('state/backup-identity.json', { body: JSON.stringify({ id: 'someone-else' }), etag: 'x' });
    otherBackup.objects.set('objects/messages/a/body', { body: 'copy', etag: 'y' });
    await expect(runBackup({ ...env, SOURCE: otherBackup as unknown as R2Bucket }, later(1))).rejects.toThrow('is it a backup bucket');
    expect(JSON.parse(backup.objects.get('state/missing.json')!.body)).toEqual({});
  });

  it('pauses deletions, but keeps backing up, when SOURCE suddenly looks empty', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    source.objects.clear();
    const summary = await runBackup(env, later(1));
    expect(summary.deletionsPaused).toBe('SOURCE is empty but the backup holds objects');
    expect(summary.databaseTables).toBeGreaterThan(20);
    await runBackup(env, later(40));
    expect(backup.objects.has('objects/messages/a/body')).toBe(true);
    expect(JSON.parse(backup.objects.get('state/missing.json')!.body)).toEqual({});
    expect(backup.objects.has('manifests/2026-11-01.json')).toBe(false);
  });

  it('pauses deletions when every object of a small backup vanishes', async () => {
    const { source, backup, env } = setup();
    await runBackup(env, DAY);
    source.objects.clear();
    source.objects.set('messages/preview-only/body', { body: 'p', etag: 'p' });
    const summary = await runBackup(env, later(1));
    expect(summary.deletionsPaused).toBe('every backed-up object vanished from SOURCE');
    expect(summary.copied).toBe(1);
    expect(JSON.parse(backup.objects.get('state/missing.json')!.body)).toEqual({});
  });

  it('pauses deletions when too many objects vanish at once, until an operator allows the purge', async () => {
    const keys = Array.from({ length: 100 }, (_, index) => `messages/${index}/body`);
    const { source, backup, env } = setup(keys);
    await runBackup(env, DAY);
    for (const key of keys.slice(0, 30)) source.objects.delete(key);
    source.objects.set('messages/new/body', { body: 'new mail', etag: 'new' });
    const paused = await runBackup(env, later(1));
    expect(paused).toMatchObject({ deletionsPaused: '30 objects vanished from SOURCE in one run (limit 25)', markedMissing: 0, copied: 1 });
    expect(JSON.parse(backup.objects.get('state/missing.json')!.body)).toEqual({});

    const allowed = await runBackup({ ...env, BACKUP_ALLOW_LARGE_DELETIONS_UNTIL: later(2).toISOString() } as BackupEnv, later(1.5));
    expect(allowed).toMatchObject({ deletionsPaused: null, markedMissing: 30 });
    // After the purge is tracked, ordinary runs carry on normally.
    expect(await runBackup(env, later(3))).toMatchObject({ deletionsPaused: null, markedMissing: 0 });
  });

  it('accepts an override only in the future and at most 7 days ahead', () => {
    expect(largeDeletionsAllowed(undefined, DAY)).toBe(false);
    expect(largeDeletionsAllowed('soon', DAY)).toBe(false);
    expect(largeDeletionsAllowed(later(-1).toISOString(), DAY)).toBe(false);
    expect(largeDeletionsAllowed(later(6).toISOString(), DAY)).toBe(true);
    expect(largeDeletionsAllowed(later(8).toISOString(), DAY)).toBe(false);
  });

  it('changes nothing when listing SOURCE fails', async () => {
    const { backup, env } = setup();
    await runBackup(env, DAY);
    const before = JSON.stringify([...backup.objects.entries()]);
    await expect(runBackup({ ...env, SOURCE: memoryBucket({ failList: true }) as unknown as R2Bucket }, later(1))).rejects.toThrow('R2 list failed');
    expect(JSON.stringify([...backup.objects.entries()])).toBe(before);
  });
});
