export function sendIdempotencyKey(
  draftId: string | null,
  composeToken: string,
  claimedDraftVersion?: number,
): string {
  if (!draftId) return `compose:${composeToken}`;
  if (claimedDraftVersion === undefined
    || !Number.isSafeInteger(claimedDraftVersion)
    || claimedDraftVersion < 0) {
    throw new Error('A valid claimed draft version is required');
  }
  return `draft:${draftId}:version:${claimedDraftVersion}`;
}
