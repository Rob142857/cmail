export interface RetentionEnv {
  DB: D1Database;
  STORAGE: R2Bucket;
  /** Destructive retention stays disabled unless an operator explicitly opts in. */
  RETENTION_JOBS_ENABLED?: string | number | boolean;
}

export type RetentionEntity = 'deleted_messages' | 'attachments' | 'trace' | 'audit';

interface RetentionConfigRow {
  entity_type: RetentionEntity;
  retention_days: number;
}

export interface RetentionBatchResult {
  deleted: number;
  hasMore: boolean;
}

export interface RetentionEntitySummary {
  entity: RetentionEntity;
  retentionDays: number;
  deleted: number;
  batches: number;
  moreRemaining: boolean;
  stalled: boolean;
}

export type RetentionStopReason = 'complete' | 'batch_limit' | 'row_limit' | 'time_limit' | 'stalled';

export interface RetentionRunSummary {
  deleted: number;
  batches: number;
  durationMs: number;
  moreRemaining: boolean;
  stopReason: RetentionStopReason;
  entities: RetentionEntitySummary[];
}

export interface RetentionRunLimits {
  maxBatches: number;
  maxRows: number;
  maxRuntimeMs: number;
}

interface RetentionRunOptions extends Partial<RetentionRunLimits> {
  now?: () => number;
}

type RetentionBatchPurger = (
  entity: RetentionEntity,
  retentionDays: number,
  limit: number,
) => Promise<RetentionBatchResult>;

// These ceilings allow several catch-up batches while bounding each scheduled
// invocation. A remaining backlog is explicitly reported for the next run.
export const DEFAULT_RETENTION_RUN_LIMITS: Readonly<RetentionRunLimits> = Object.freeze({
  maxBatches: 32,
  maxRows: 10_000,
  maxRuntimeMs: 25_000,
});

const ENTITY_BATCH_SIZES: Readonly<Record<RetentionEntity, number>> = Object.freeze({
  deleted_messages: 100,
  attachments: 100,
  trace: 500,
  audit: 500,
});

const RETENTION_ENTITIES: readonly RetentionEntity[] = [
  'deleted_messages',
  'attachments',
  'trace',
  'audit',
];

const R2_DELETE_CONCURRENCY = 100;

export function retentionEnabled(env: Pick<RetentionEnv, 'RETENTION_JOBS_ENABLED'>): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.RETENTION_JOBS_ENABLED ?? '').toLowerCase());
}

export function retentionDays(config: ReadonlyMap<string, number>, entity: RetentionEntity): number | null {
  const value = config.get(entity);
  if (!Number.isSafeInteger(value) || !value || value < 1) return null;
  return Math.min(value, 3650);
}

function positiveSafeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

/**
 * Runs retention purges in fair rounds until every configured entity is
 * drained or a strict batch, row, or elapsed-time ceiling is reached.
 */
export async function runRetentionCatchUp(
  config: ReadonlyMap<string, number>,
  purgeBatch: RetentionBatchPurger,
  options: RetentionRunOptions = {},
): Promise<RetentionRunSummary> {
  const limits: RetentionRunLimits = {
    maxBatches: positiveSafeInteger(options.maxBatches, DEFAULT_RETENTION_RUN_LIMITS.maxBatches, 'maxBatches'),
    maxRows: positiveSafeInteger(options.maxRows, DEFAULT_RETENTION_RUN_LIMITS.maxRows, 'maxRows'),
    maxRuntimeMs: positiveSafeInteger(options.maxRuntimeMs, DEFAULT_RETENTION_RUN_LIMITS.maxRuntimeMs, 'maxRuntimeMs'),
  };
  const now = options.now ?? Date.now;
  const startedAt = now();
  const entities: RetentionEntitySummary[] = [];

  for (const entity of RETENTION_ENTITIES) {
    const days = retentionDays(config, entity);
    if (days !== null) {
      entities.push({
        entity,
        retentionDays: days,
        deleted: 0,
        batches: 0,
        moreRemaining: true,
        stalled: false,
      });
    }
  }

  let deleted = 0;
  let batches = 0;
  let stopReason: RetentionStopReason = 'complete';

  catchUp: while (entities.some((entity) => entity.moreRemaining)) {
    if (batches >= limits.maxBatches) {
      stopReason = 'batch_limit';
      break;
    }
    if (deleted >= limits.maxRows) {
      stopReason = 'row_limit';
      break;
    }
    if (now() - startedAt >= limits.maxRuntimeMs) {
      stopReason = 'time_limit';
      break;
    }

    const runnable = entities.filter((entity) => entity.moreRemaining && !entity.stalled);
    if (runnable.length === 0) {
      stopReason = 'stalled';
      break;
    }

    for (const entity of runnable) {
      if (batches >= limits.maxBatches) {
        stopReason = 'batch_limit';
        break catchUp;
      }
      const rowsRemaining = limits.maxRows - deleted;
      if (rowsRemaining <= 0) {
        stopReason = 'row_limit';
        break catchUp;
      }
      if (now() - startedAt >= limits.maxRuntimeMs) {
        stopReason = 'time_limit';
        break catchUp;
      }

      const limit = Math.min(ENTITY_BATCH_SIZES[entity.entity], rowsRemaining);
      const result = await purgeBatch(entity.entity, entity.retentionDays, limit);
      if (
        !Number.isSafeInteger(result.deleted) ||
        result.deleted < 0 ||
        result.deleted > limit ||
        typeof result.hasMore !== 'boolean'
      ) {
        throw new TypeError(`Invalid retention batch result for ${entity.entity}`);
      }

      batches += 1;
      deleted += result.deleted;
      entity.batches += 1;
      entity.deleted += result.deleted;
      entity.moreRemaining = result.hasMore;
      entity.stalled = result.hasMore && result.deleted === 0;

      if (!entities.some((candidate) => candidate.moreRemaining)) {
        stopReason = 'complete';
        break catchUp;
      }
    }
  }

  const moreRemaining = entities.some((entity) => entity.moreRemaining);
  return {
    deleted,
    batches,
    durationMs: Math.max(0, now() - startedAt),
    moreRemaining,
    stopReason: moreRemaining ? stopReason : 'complete',
    entities,
  };
}

async function deleteR2ObjectsStrict(storage: R2Bucket, keys: string[]): Promise<void> {
  // Bound concurrent R2 operations even when a message batch contains many
  // legacy attachments. Missing-object deletes are idempotent.
  for (let offset = 0; offset < keys.length; offset += R2_DELETE_CONCURRENCY) {
    await Promise.all(keys.slice(offset, offset + R2_DELETE_CONCURRENCY).map((key) => storage.delete(key)));
  }
}

async function purgeExpiredTrash(
  env: RetentionEnv,
  days: number,
  limit: number,
): Promise<RetentionBatchResult> {
  const messages = await env.DB.prepare(
    `SELECT id, body_r2_key FROM messages
     WHERE folder = 'trash'
       AND COALESCE(received_at, created_at) < datetime('now', '-' || ? || ' days')
     ORDER BY COALESCE(received_at, created_at), id
     LIMIT ?`,
  ).bind(days, limit + 1).all<{ id: string; body_r2_key: string | null }>();
  const selected = messages.results || [];
  const rows = selected.slice(0, limit);
  if (!rows.length) return { deleted: 0, hasMore: false };

  const placeholders = rows.map(() => '?').join(',');
  const attachments = await env.DB.prepare(
    `SELECT r2_key FROM attachments WHERE message_id IN (${placeholders})`,
  ).bind(...rows.map((row) => row.id)).all<{ r2_key: string }>();
  const keys = [
    ...rows.map((row) => row.body_r2_key),
    ...(attachments.results || []).map((row) => row.r2_key),
  ].filter((key): key is string => !!key);

  // R2 deletion is idempotent. If the following D1 batch fails, the same
  // relational rows are selected and reconciled on the next scheduled run.
  await deleteR2ObjectsStrict(env.STORAGE, keys);
  await env.DB.batch(rows.map((row) =>
    env.DB.prepare('DELETE FROM messages WHERE id = ? AND folder = \'trash\'').bind(row.id),
  ));
  return { deleted: rows.length, hasMore: selected.length > limit };
}

async function purgeExpiredTrashAttachments(
  env: RetentionEnv,
  days: number,
  limit: number,
): Promise<RetentionBatchResult> {
  const attachments = await env.DB.prepare(
    `SELECT a.id, a.message_id, a.r2_key
     FROM attachments a
     INNER JOIN messages m ON m.id = a.message_id
     WHERE m.folder = 'trash'
       AND COALESCE(m.received_at, m.created_at) < datetime('now', '-' || ? || ' days')
     ORDER BY COALESCE(m.received_at, m.created_at), a.id
     LIMIT ?`,
  ).bind(days, limit + 1).all<{ id: string; message_id: string; r2_key: string }>();
  const selected = attachments.results || [];
  const rows = selected.slice(0, limit);
  if (!rows.length) return { deleted: 0, hasMore: false };

  await deleteR2ObjectsStrict(env.STORAGE, rows.map((row) => row.r2_key));
  const messageIds = [...new Set(rows.map((row) => row.message_id))];
  await env.DB.batch([
    ...rows.map((row) => env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(row.id)),
    ...messageIds.map((id) => env.DB.prepare(
      `UPDATE messages SET has_attachments = CASE
         WHEN EXISTS (SELECT 1 FROM attachments WHERE message_id = ?) THEN 1 ELSE 0 END
       WHERE id = ?`,
    ).bind(id, id)),
  ]);
  return { deleted: rows.length, hasMore: selected.length > limit };
}

async function purgeSimpleTable(
  db: D1Database,
  entity: 'trace' | 'audit',
  days: number,
  limit: number,
): Promise<RetentionBatchResult> {
  const table = entity === 'trace' ? 'mail_trace' : 'audit_log';
  const idColumn = entity === 'trace' ? 'trace_id' : 'event_id';
  const count = await db.prepare(
    `SELECT COUNT(*) AS eligible_count FROM (
       SELECT 1 FROM ${table}
       WHERE timestamp < datetime('now', '-' || ? || ' days')
       ORDER BY timestamp LIMIT ?
     )`,
  ).bind(days, limit + 1).first<{ eligible_count: number }>();
  const eligible = Math.max(0, Number(count?.eligible_count || 0));
  if (eligible === 0) return { deleted: 0, hasMore: false };

  const result = await db.prepare(
    `DELETE FROM ${table} WHERE ${idColumn} IN (
       SELECT ${idColumn} FROM ${table}
       WHERE timestamp < datetime('now', '-' || ? || ' days')
       ORDER BY timestamp LIMIT ?
     )`,
  ).bind(days, limit).run();

  return {
    deleted: Math.min(limit, Math.max(0, Number(result.meta?.changes || 0))),
    hasMore: eligible > limit,
  };
}

async function purgeConfiguredBatch(
  env: RetentionEnv,
  entity: RetentionEntity,
  days: number,
  limit: number,
): Promise<RetentionBatchResult> {
  switch (entity) {
    case 'deleted_messages':
      return purgeExpiredTrash(env, days, limit);
    case 'attachments':
      return purgeExpiredTrashAttachments(env, days, limit);
    case 'trace':
    case 'audit':
      return purgeSimpleTable(env.DB, entity, days, limit);
  }
}

async function writeRetentionAudit(
  db: D1Database,
  eventType: 'retention.completed' | 'retention.backlog_remaining' | 'retention.failed',
  detail: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_log (event_id, actor_role, event_type, target, detail)
     VALUES (?, 'system', ?, 'retention', ?)`,
  ).bind(crypto.randomUUID(), eventType, detail).run();
}

function auditDetail(summary: RetentionRunSummary): string {
  return JSON.stringify({
    deleted: summary.deleted,
    batches: summary.batches,
    durationMs: summary.durationMs,
    moreRemaining: summary.moreRemaining,
    stopReason: summary.stopReason,
    entities: summary.entities.map((entity) => ({
      entity: entity.entity,
      deleted: entity.deleted,
      batches: entity.batches,
      moreRemaining: entity.moreRemaining,
      stalled: entity.stalled,
    })),
  });
}

/** Runs the opt-in destructive retention job and emits console plus audit telemetry. */
export async function runRetention(env: RetentionEnv): Promise<RetentionRunSummary | null> {
  if (!retentionEnabled(env)) return null;

  try {
    const result = await env.DB.prepare(
      'SELECT entity_type, retention_days FROM retention_config',
    ).all<RetentionConfigRow>();
    const config = new Map<string, number>(
      (result.results || []).map((row) => [row.entity_type, row.retention_days]),
    );
    const summary = await runRetentionCatchUp(
      config,
      (entity, days, limit) => purgeConfiguredBatch(env, entity, days, limit),
    );

    if (summary.moreRemaining) {
      console.warn('Retention run stopped with eligible backlog remaining', summary);
    } else {
      console.log('Retention run completed', summary);
    }

    try {
      await writeRetentionAudit(
        env.DB,
        summary.moreRemaining ? 'retention.backlog_remaining' : 'retention.completed',
        auditDetail(summary),
      );
    } catch (auditError) {
      console.error(
        'Retention audit logging failed:',
        auditError instanceof Error ? auditError.message : 'unknown error',
      );
    }

    return summary;
  } catch (error) {
    console.error('Retention run failed:', error instanceof Error ? error.message : 'unknown error');
    try {
      await writeRetentionAudit(
        env.DB,
        'retention.failed',
        JSON.stringify({ moreRemaining: true, status: 'failed; inspect Worker logs' }),
      );
    } catch {
      console.error('Retention failure audit logging also failed');
    }
    throw error;
  }
}
