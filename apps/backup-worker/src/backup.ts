// Scheduled backup of one cmail deployment into a separate R2 bucket.
//
// - Mail bodies and attachments (the SOURCE bucket) are copied to
//   `objects/<key>` in BACKUP. Keys are immutable in cmail, so a copy normally
//   happens once; if a key's content ever changes, the previous copy is kept
//   under `versions/<day>/<key>` for the retention window.
// - A dated manifest of every source key is written each day, flagged
//   `complete` only once every object is copied.
// - Objects that disappear from SOURCE (retention, offboarding, emptied trash)
//   are kept for the retention window, then removed, so the backup never holds
//   deleted mail longer than that.
// - Once a day every D1 table is written as NDJSON parts plus the schema.
//
// Safety: a run refuses to change anything if SOURCE looks empty or wrong
// while the backup holds data, if too many objects vanish at once, or if
// SOURCE and BACKUP are the same bucket. Every step is idempotent, so a run
// that stops part-way is completed by the next. No keys or content are logged.

export interface BackupEnv {
  SOURCE: R2Bucket;
  BACKUP: R2Bucket;
  DB: D1Database;
  /** Days to keep deleted objects, old versions, manifests and D1 dumps. Default 30, bounded 7-365. */
  BACKUP_RETENTION_DAYS?: string | number;
  /** Most objects copied in one run. Default 200, bounded 1-1000. */
  BACKUP_MAX_COPIES_PER_RUN?: string | number;
}

export interface BackupSummary {
  day: string;
  sourceObjects: number;
  copied: number;
  copyFailures: number;
  pendingCopies: number;
  markedMissing: number;
  pruned: number;
  manifestComplete: boolean;
  databaseTables: number | null;
  databaseError: string | null;
}

export class BackupRefused extends Error {}

const OBJECTS = 'objects/';
const VERSIONS = 'versions/';
const MANIFESTS = 'manifests/';
const DATABASE = 'd1/';
const MISSING_STATE = 'state/missing.json';
const IDENTITY = 'state/backup-identity.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROWS_PER_QUERY = 500;
const ROWS_PER_PART = 10_000;
// A single run may newly mark at most this share of the backup as deleted
// (and never fewer than this many objects) before it stops as suspicious.
const MAX_MISSING_SHARE = 0.05;
const MIN_MISSING_ALLOWANCE = 25;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim() || NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function backupConfiguration(env: Pick<BackupEnv, 'BACKUP_RETENTION_DAYS' | 'BACKUP_MAX_COPIES_PER_RUN'>) {
  return {
    retentionDays: bounded(env.BACKUP_RETENTION_DAYS, 30, 7, 365),
    maxCopies: bounded(env.BACKUP_MAX_COPIES_PER_RUN, 200, 1, 1000),
  };
}

/** UTC calendar day, YYYY-MM-DD. */
export function dayOf(time: Date): string {
  return time.toISOString().slice(0, 10);
}

const errorName = (caught: unknown) => (caught instanceof Error ? caught.name : 'UnknownError');

async function listAll(bucket: R2Bucket, prefix = ''): Promise<Map<string, R2Object>> {
  const objects = new Map<string, R2Object>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000, include: ['customMetadata'] });
    for (const object of page.objects) objects.set(object.key, object);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

/** R2 deletes at most 1000 keys per call. */
async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += 1000) await bucket.delete(keys.slice(index, index + 1000));
}

async function readJson<T>(bucket: R2Bucket, key: string, fallback: T): Promise<T> {
  const object = await bucket.get(key);
  if (!object) return fallback;
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return fallback;
  }
}

/**
 * The backup bucket carries a random identity object. If SOURCE can see it,
 * both bindings point at the same bucket, and the backup must not run.
 */
async function assertSeparateBuckets(env: BackupEnv): Promise<void> {
  let identity = await env.BACKUP.head(IDENTITY);
  if (!identity) {
    await env.BACKUP.put(IDENTITY, JSON.stringify({ id: crypto.randomUUID() }), { httpMetadata: { contentType: 'application/json' } });
    identity = await env.BACKUP.head(IDENTITY);
  }
  if (identity && await env.SOURCE.head(IDENTITY)) {
    throw new BackupRefused('SOURCE and BACKUP are the same bucket');
  }
}

async function copyObject(env: BackupEnv, source: R2Object, previous: R2Object | undefined, day: string): Promise<boolean> {
  const body = await env.SOURCE.get(source.key);
  if (!body) return false; // Deleted between list and copy; the next run sees it missing.
  if (previous) {
    // The content changed: keep the old copy for the retention window.
    const old = await env.BACKUP.get(previous.key);
    if (old) await env.BACKUP.put(`${VERSIONS}${day}/${source.key}`, old.body, { httpMetadata: old.httpMetadata, customMetadata: old.customMetadata });
  }
  await env.BACKUP.put(`${OBJECTS}${source.key}`, body.body, {
    httpMetadata: body.httpMetadata,
    customMetadata: { ...body.customMetadata, sourceEtag: source.etag },
  });
  return true;
}

/** Write every table as NDJSON parts (paged by rowid) plus the schema. Returns the table count. */
async function dumpDatabase(env: BackupEnv, day: string): Promise<number> {
  const schema = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
  ).all<{ type: string; name: string; sql: string }>();
  const tables = schema.results.filter((row) => row.type === 'table').map((row) => row.name);
  const parts: Record<string, number> = {};
  for (const table of tables) {
    const quoted = `"${table.replace(/"/g, '""')}"`;
    let lastRowid = -Infinity;
    let part = 0;
    let lines: string[] = [];
    const flush = async () => {
      part += 1;
      await env.BACKUP.put(`${DATABASE}${day}/tables/${table}/part-${String(part).padStart(5, '0')}.ndjson`, lines.length ? `${lines.join('\n')}\n` : '', {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
      lines = [];
    };
    for (;;) {
      // rowid paging stays correct even if rows are deleted mid-dump; every cmail table has a rowid.
      const page = await env.DB.prepare(`SELECT rowid AS "__cmail_rowid", * FROM ${quoted} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .bind(Number.isFinite(lastRowid) ? lastRowid : -9007199254740991, ROWS_PER_QUERY).all<Record<string, unknown>>();
      for (const row of page.results) {
        lastRowid = Number(row.__cmail_rowid);
        const { __cmail_rowid: _rowid, ...values } = row;
        lines.push(JSON.stringify(values));
        if (lines.length >= ROWS_PER_PART) await flush();
      }
      if (page.results.length < ROWS_PER_QUERY) break;
    }
    if (lines.length || part === 0) await flush();
    parts[table] = part;
  }
  await env.BACKUP.put(`${DATABASE}${day}/schema.sql`, schema.results.map((row) => `${row.sql};`).join('\n\n'), {
    httpMetadata: { contentType: 'application/sql' },
  });
  // Written last: its presence means the day's dump is complete.
  await env.BACKUP.put(`${DATABASE}${day}/complete.json`, JSON.stringify({ day, tables, parts }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return tables.length;
}

/** Remove dated manifests, versions and dumps older than the retention window. */
async function pruneDated(env: BackupEnv, now: Date, retentionDays: number): Promise<number> {
  const cutoff = dayOf(new Date(now.getTime() - retentionDays * DAY_MS));
  let removed = 0;
  for (const prefix of [MANIFESTS, VERSIONS, DATABASE]) {
    const keys = [...(await listAll(env.BACKUP, prefix)).keys()].filter((key) => key.slice(prefix.length, prefix.length + 10) < cutoff);
    await deleteKeys(env.BACKUP, keys);
    removed += keys.length;
  }
  return removed;
}

export async function runBackup(env: BackupEnv, now = new Date()): Promise<BackupSummary> {
  const { retentionDays, maxCopies } = backupConfiguration(env);
  const day = dayOf(now);
  const nowEpoch = Math.floor(now.getTime() / 1000);

  await assertSeparateBuckets(env);
  const source = await listAll(env.SOURCE);
  const backedUp = await listAll(env.BACKUP, OBJECTS);

  // Guard against a wrong or empty SOURCE binding wiping the backup over time.
  if (source.size === 0 && backedUp.size > 0) {
    throw new BackupRefused('SOURCE is empty but the backup holds objects; check the SOURCE binding');
  }
  const missing = await readJson<Record<string, number>>(env.BACKUP, MISSING_STATE, {});
  const newlyMissing = [...backedUp.keys()].filter((key) => !source.has(key.slice(OBJECTS.length)) && missing[key.slice(OBJECTS.length)] === undefined);
  const allowance = Math.max(MIN_MISSING_ALLOWANCE, Math.ceil(backedUp.size * MAX_MISSING_SHARE));
  if (newlyMissing.length > allowance) {
    throw new BackupRefused(`${newlyMissing.length} objects vanished from SOURCE in one run (limit ${allowance}); check the SOURCE binding`);
  }

  // 1. Copy what is new or changed. Rotate the start so keys that keep failing
  //    can't block everything behind them.
  const toCopy = [...source.values()]
    .filter((object) => backedUp.get(`${OBJECTS}${object.key}`)?.customMetadata?.sourceEtag !== object.etag)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const start = toCopy.length ? Math.floor(nowEpoch / 3600) % toCopy.length : 0;
  const batch = [...toCopy.slice(start), ...toCopy.slice(0, start)].slice(0, maxCopies);
  let copied = 0;
  let copyFailures = 0;
  for (const object of batch) {
    try {
      if (await copyObject(env, object, backedUp.get(`${OBJECTS}${object.key}`), day)) copied += 1;
    } catch (caught) {
      copyFailures += 1;
      console.error('cmail backup: object copy failed', { error: errorName(caught) });
    }
  }

  // 2. Track objects gone from the source; remove them after the retention window.
  const expired: string[] = [];
  for (const key of backedUp.keys()) {
    const sourceKey = key.slice(OBJECTS.length);
    if (source.has(sourceKey)) {
      delete missing[sourceKey];
    } else if (missing[sourceKey] === undefined) {
      missing[sourceKey] = nowEpoch;
    } else if (nowEpoch - missing[sourceKey] >= retentionDays * 86_400) {
      expired.push(key);
      delete missing[sourceKey];
    }
  }
  for (const sourceKey of Object.keys(missing)) {
    if (!backedUp.has(`${OBJECTS}${sourceKey}`)) delete missing[sourceKey];
  }
  await deleteKeys(env.BACKUP, expired);
  await env.BACKUP.put(MISSING_STATE, JSON.stringify(missing), { httpMetadata: { contentType: 'application/json' } });

  // 3. Today's manifest, always written; `complete` says whether every listed key is in the backup.
  const pendingCopies = toCopy.length - copied;
  const manifestComplete = pendingCopies === 0;
  const entries = [...source.values()].map((object) => ({ key: object.key, size: object.size, etag: object.etag }));
  await env.BACKUP.put(`${MANIFESTS}${day}.json`, JSON.stringify({ day, createdAt: now.toISOString(), complete: manifestComplete, objects: entries }), {
    httpMetadata: { contentType: 'application/json' },
  });

  // 4. Prune before the dump, so a failing dump can't stop retention.
  const pruned = expired.length + (await pruneDated(env, now, retentionDays));

  // 5. Once a day, the database.
  let databaseTables: number | null = null;
  let databaseError: string | null = null;
  if (!(await env.BACKUP.head(`${DATABASE}${day}/complete.json`))) {
    try {
      databaseTables = await dumpDatabase(env, day);
    } catch (caught) {
      databaseError = errorName(caught);
    }
  }

  return {
    day,
    sourceObjects: source.size,
    copied,
    copyFailures,
    pendingCopies,
    markedMissing: newlyMissing.length,
    pruned,
    manifestComplete,
    databaseTables,
    databaseError,
  };
}
