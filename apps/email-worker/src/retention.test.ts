import { describe, expect, it, vi } from 'vitest';

import {
  runRetentionCatchUp,
  type RetentionBatchResult,
  type RetentionEntity,
} from './retention';

function backlogPurger(initialRows: number) {
  let remaining = initialRows;
  const purge = vi.fn(async (
    _entity: RetentionEntity,
    _days: number,
    limit: number,
  ): Promise<RetentionBatchResult> => {
    const deleted = Math.min(limit, remaining);
    remaining -= deleted;
    return { deleted, hasMore: remaining > 0 };
  });

  return { purge, remaining: () => remaining };
}

describe('retention catch-up batching', () => {
  it('keeps taking bounded batches until the eligible backlog is drained', async () => {
    const backlog = backlogPurger(1_250);

    const summary = await runRetentionCatchUp(
      new Map([['trace', 90]]),
      backlog.purge,
    );

    expect(backlog.purge.mock.calls.map((call) => call[2])).toEqual([500, 500, 500]);
    expect(backlog.remaining()).toBe(0);
    expect(summary).toMatchObject({
      deleted: 1_250,
      batches: 3,
      moreRemaining: false,
      stopReason: 'complete',
    });
  });

  it('stops at the strict batch ceiling and reports that more remains', async () => {
    const backlog = backlogPurger(5_000);

    const summary = await runRetentionCatchUp(
      new Map([['trace', 90]]),
      backlog.purge,
      { maxBatches: 2 },
    );

    expect(backlog.purge).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      deleted: 1_000,
      batches: 2,
      moreRemaining: true,
      stopReason: 'batch_limit',
    });
    expect(summary.entities[0]).toMatchObject({
      entity: 'trace',
      moreRemaining: true,
    });
  });

  it('shrinks the final batch to enforce the row ceiling exactly', async () => {
    const backlog = backlogPurger(5_000);

    const summary = await runRetentionCatchUp(
      new Map([['trace', 90]]),
      backlog.purge,
      { maxRows: 750 },
    );

    expect(backlog.purge.mock.calls.map((call) => call[2])).toEqual([500, 250]);
    expect(summary).toMatchObject({
      deleted: 750,
      batches: 2,
      moreRemaining: true,
      stopReason: 'row_limit',
    });
  });

  it('services configured entities in fair rounds before repeating one', async () => {
    const calls: RetentionEntity[] = [];
    const purge = async (entity: RetentionEntity): Promise<RetentionBatchResult> => {
      calls.push(entity);
      return { deleted: 1, hasMore: true };
    };

    const summary = await runRetentionCatchUp(
      new Map([
        ['deleted_messages', 90],
        ['attachments', 90],
        ['trace', 90],
        ['audit', 730],
      ]),
      purge,
      { maxBatches: 4 },
    );

    expect(calls).toEqual(['deleted_messages', 'attachments', 'trace', 'audit']);
    expect(summary.stopReason).toBe('batch_limit');
    expect(summary.moreRemaining).toBe(true);
  });

  it('stops stalled work instead of spinning through the remaining allowance', async () => {
    const purge = vi.fn(async (): Promise<RetentionBatchResult> => ({
      deleted: 0,
      hasMore: true,
    }));

    const summary = await runRetentionCatchUp(
      new Map([['audit', 730]]),
      purge,
    );

    expect(purge).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      deleted: 0,
      batches: 1,
      moreRemaining: true,
      stopReason: 'stalled',
    });
  });

  it('checks the elapsed-time ceiling between batches', async () => {
    let clock = 0;
    const purge = vi.fn(async (): Promise<RetentionBatchResult> => {
      clock = 30;
      return { deleted: 100, hasMore: true };
    });

    const summary = await runRetentionCatchUp(
      new Map([['trace', 90]]),
      purge,
      { maxRuntimeMs: 25, now: () => clock },
    );

    expect(purge).toHaveBeenCalledTimes(1);
    expect(summary.stopReason).toBe('time_limit');
    expect(summary.moreRemaining).toBe(true);
  });
});
