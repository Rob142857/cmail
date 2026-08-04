const MIB = 1024 * 1024;

/** Aggregate payload delivered to recipients, including provider fan-out. */
export const MAX_DELIVERY_BYTES_PER_SEND = 250 * MIB;
/** Actual immutable body/attachment bytes persisted across sender and internal copies. */
export const MAX_PERSISTED_BYTES_PER_SEND = 100 * MIB;
/** Bounds sequential R2 writes until the schema supports reference-counted shared blobs. */
export const MAX_PERSISTED_OBJECTS_PER_SEND = 250;
export const WORK_UNIT_BYTES = MIB;

export interface ComposeWorkload {
  deliveryBytes: number;
  persistedBytes: number;
  persistedObjects: number;
  workUnits: number;
}

/** Bytes that must be temporarily reserved before replacing or moving a draft. */
export function draftStorageReservationBytes(
  existingMailboxId: string,
  existingSizeBytes: number,
  targetMailboxId: string,
  nextSizeBytes: number,
): number {
  if (!Number.isSafeInteger(nextSizeBytes) || nextSizeBytes < 0) return 0;
  if (existingMailboxId !== targetMailboxId) return nextSizeBytes;
  const current = Number.isSafeInteger(existingSizeBytes) && existingSizeBytes > 0 ? existingSizeBytes : 0;
  return Math.max(0, nextSizeBytes - current);
}

/**
 * Models the current storage layout: one sent copy plus a separate immutable R2
 * body and attachment set for every internal delivery. Shared keys are unsafe
 * because deleting one message currently deletes its R2 objects immediately.
 */
export function calculateComposeWorkload(
  persistedPayloadBytes: number,
  providerPayloadBytes: number,
  recipientCount: number,
  providerRecipientCount: number,
  directInternalRecipientCount: number,
  expectedInternalRecipientCount: number,
  attachmentCount: number,
): ComposeWorkload {
  for (const value of [
    persistedPayloadBytes,
    providerPayloadBytes,
    recipientCount,
    providerRecipientCount,
    directInternalRecipientCount,
    expectedInternalRecipientCount,
    attachmentCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Compose workload inputs must be non-negative integers');
  }
  if (
    recipientCount < 1
    || providerRecipientCount > recipientCount
    || directInternalRecipientCount > expectedInternalRecipientCount
    || expectedInternalRecipientCount > recipientCount
  ) {
    throw new RangeError('Compose workload recipient counts are inconsistent');
  }

  // Mixed local/external mail goes through one provider path for every
  // recipient so its visible To/Cc headers remain identical. Count eventual
  // inbound local copies as persisted work even though they arrive later.
  const persistedCopies = expectedInternalRecipientCount + 1;
  const deliveryBytes = (persistedPayloadBytes * directInternalRecipientCount)
    + (providerPayloadBytes * providerRecipientCount);
  const persistedBytes = persistedPayloadBytes * persistedCopies;
  const persistedObjects = (attachmentCount + 1) * persistedCopies;
  if (![deliveryBytes, persistedBytes, persistedObjects].every(Number.isSafeInteger)) {
    throw new RangeError('Compose workload exceeds safe integer bounds');
  }

  return {
    deliveryBytes,
    persistedBytes,
    persistedObjects,
    // Charge at least one unit per recipient. Aggregate bytes and R2 object
    // fan-out become the dominant dimension for heavier messages.
    workUnits: Math.max(
      recipientCount,
      persistedObjects,
      Math.ceil((deliveryBytes + persistedPayloadBytes) / WORK_UNIT_BYTES),
    ),
  };
}
