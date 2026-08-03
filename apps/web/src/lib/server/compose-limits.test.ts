import { describe, expect, it } from 'vitest';
import {
  calculateComposeWorkload,
  draftStorageReservationBytes,
  MAX_DELIVERY_BYTES_PER_SEND,
  MAX_PERSISTED_BYTES_PER_SEND,
  MAX_PERSISTED_OBJECTS_PER_SEND,
} from './compose-limits';

const MIB = 1024 * 1024;

describe('compose workload guardrails', () => {
  it('charges at least one unit for every recipient', () => {
    expect(calculateComposeWorkload(1024, 2048, 50, 0, 0)).toEqual({
      deliveryBytes: 50 * 2048,
      persistedBytes: 1024,
      persistedObjects: 1,
      workUnits: 50,
    });
  });

  it('weights larger payloads across all recipients', () => {
    const workload = calculateComposeWorkload(5 * MIB, 6 * MIB, 10, 3, 2);
    expect(workload.deliveryBytes).toBe(57 * MIB);
    expect(workload.persistedBytes).toBe(20 * MIB);
    expect(workload.persistedObjects).toBe(12);
    expect(workload.workUnits).toBe(62);
  });

  it('exposes finite per-send caps for bytes and R2 writes', () => {
    expect(MAX_DELIVERY_BYTES_PER_SEND).toBe(250 * MIB);
    expect(MAX_PERSISTED_BYTES_PER_SEND).toBe(100 * MIB);
    expect(MAX_PERSISTED_OBJECTS_PER_SEND).toBe(250);
  });

  it('charges object-heavy internal fan-out even when files are tiny', () => {
    expect(calculateComposeWorkload(100, 100, 5, 4, 24).workUnits).toBe(125);
  });

  it('rejects inconsistent or unsafe inputs', () => {
    expect(() => calculateComposeWorkload(1, 1, 0, 0, 0)).toThrow(RangeError);
    expect(() => calculateComposeWorkload(1, 1, 1, 2, 0)).toThrow(RangeError);
    expect(() => calculateComposeWorkload(Number.MAX_SAFE_INTEGER, 1, 2, 1, 0)).toThrow(RangeError);
  });

  it('reserves only a same-mailbox draft growth delta and the full size on a move', () => {
    expect(draftStorageReservationBytes('mailbox-a', 100, 'mailbox-a', 140)).toBe(40);
    expect(draftStorageReservationBytes('mailbox-a', 100, 'mailbox-a', 60)).toBe(0);
    expect(draftStorageReservationBytes('mailbox-a', 100, 'mailbox-b', 140)).toBe(140);
    expect(draftStorageReservationBytes('mailbox-a', Number.NaN, 'mailbox-a', 40)).toBe(40);
  });
});
