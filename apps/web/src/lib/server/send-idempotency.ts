export function sendIdempotencyKey(draftId: string | null, composeToken: string): string {
  return draftId ? `draft:${draftId}` : `compose:${composeToken}`;
}
