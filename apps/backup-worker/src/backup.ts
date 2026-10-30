// Nightly-style backup of one cmail deployment into a separate R2 bucket.
//
// - Mail bodies and attachments (the STORAGE bucket) are copied to
//   `objects/<key>` in BACKUP. Keys are immutable, so a copy only happens once.
// - A dated manifest of every source key is written each day, so a restore can
//   target the state of any retained day.
// - Objects that disappear from STORAGE (retention, offboarding, emptied
//   trash) are kept for the retention window, then removed, so the backup
//   never outlives the deployment's own deletion rules by more than that.
// - Once a day every D1 table is written as NDJSON plus the schema.
//
// Everything here is idempotent: a run that stops part-way (limits, errors)
// is completed by the next run. No mail content is ever logged.

export interface BackupEnv {
  SOURCE: R2Bucket;
  BACKUP: R2Bucket;
  DB: D1Database;
  /** Days to keep deleted objects, manifests and D1 dumps. Default 30, bounded 7-365. */
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
  manifestWritten: boolean;
  databaseTables: number | null;
}

const OBJECTS = 'objects/';
const MANIFESTS = 'manifests/';
const DATABASE = 'd1/';
const MISSING_STATE = 'state/missing.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROWS_PER_QUERY = 500;

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

async function copyObject(env: BackupEnv, source: R2Object): Promise<boolean> {
  const body = await env.SOURCE.get(source.key);
  if (!body) return false; // Deleted between list and copy; the next run sees it missing.
  await env.BACKUP.put(`${OBJECTS}${source.key}`, body.body, {
    httpMetadata: body.httpMetadata,
    customMetadata: { ...body.customMetadata, sourceEtag: source.etag },
  });
  return true;
}

/** Write every table as NDJSON plus the schema, once per day. Returns the table count. */
async function dumpDatabase(env: BackupEnv, day: string): Promise<number> {
  const schema = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
  ).all<{ type: string; name: string; sql: string }>();
  const tables = schema.results.filter((row) => row.type === 'table').map((row) => row.name);
  for (const table of tables) {
    const lines: string[] = [];
    for (let offset = 0; ; offset += ROWS_PER_QUERY) {
      const page = await env.DB.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ? OFFSET ?`)
        .bind(ROWS_PER_QUERY, offset).all<Record<string, unknown>>();
      for (const row of page.results) lines.push(JSON.stringify(row));
      if (page.results.length < ROWS_PER_QUERY) break;
    }
    await env.BACKUP.put(`${DATABASE}${day}/tables/${table}.ndjson`, lines.length ? `${lines.join('\n')}\n` : '', {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
  }
  await env.BACKUP.put(`${DATABASE}${day}/schema.sql`, schema.results.map((row) => `${row.sql};`).join('\n\n'), {
    httpMetadata: { contentType: 'application/sql' },
  });
  // Written last: its presence means the day's dump is complete.
  await env.BACKUP.put(`${DATABASE}${day}/complete.json`, JSON.stringify({ day, tables }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return tables.length;
}

/** Remove dated manifests and dumps older than the retention window. */
async function pruneDated(env: BackupEnv, now: Date, retentionDays: number): Promise<number> {
  const cutoff = dayOf(new Date(now.getTime() - retentionDays * DAY_MS));
  let removed = 0;
  for (const prefix of [MANIFESTS, DATABASE]) {
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

  const source = await listAll(env.SOURCE);
  const backedUp = await listAll(env.BACKUP, OBJECTS);

  // 1. Copy what is new (or changed, should a key ever be rewritten).
  const toCopy = [...source.values()].filter((object) => backedUp.get(`${OBJECTS}${object.key}`)?.customMetadata?.sourceEtag !== object.etag);
  let copied = 0;
  let copyFailures = 0;
  for (const object of toCopy.slice(0, maxCopies)) {
    try {
      if (await copyObject(env, object)) copied += 1;
    } catch {
      copyFailures += 1;
    }
  }

  // 2. Track objects gone from the source; remove them after the retention window.
  const missing = await readJson<Record<string, number>>(env.BACKUP, MISSING_STATE, {});
  let markedMissing = 0;
  const expired: string[] = [];
  for (const key of backedUp.keys()) {
    const sourceKey = key.slice(OBJECTS.length);
    if (source.has(sourceKey)) {
      delete missing[sourceKey];
      continue;
    }
    if (missing[sourceKey] === undefined) {
      missing[sourceKey] = nowEpoch;
      markedMissing += 1;
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

  // 3. Today's manifest, once every object is copied, so it never names a key the backup lacks.
  const pendingCopies = toCopy.length - copied;
  let manifestWritten = false;
  if (pendingCopies === 0) {
    const entries = [...source.values()].map((object) => ({ key: object.key, size: object.size, etag: object.etag }));
    await env.BACKUP.put(`${MANIFESTS}${day}.json`, JSON.stringify({ day, createdAt: now.toISOString(), objects: entries }), {
      httpMetadata: { contentType: 'application/json' },
    });
    manifestWritten = true;
  }

  // 4. Once a day, the database.
  let databaseTables: number | null = null;
  if (!(await env.BACKUP.head(`${DATABASE}${day}/complete.json`))) {
    databaseTables = await dumpDatabase(env, day);
  }

  const pruned = expired.length + (await pruneDated(env, now, retentionDays));

  return {
    day,
    sourceObjects: source.size,
    copied,
    copyFailures,
    pendingCopies,
    markedMissing,
    pruned,
    manifestWritten,
    databaseTables,
  };
}
