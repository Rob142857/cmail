import { describe, expect, it } from 'vitest';
import { sendIdempotencyKey } from './send-idempotency';

describe('sendIdempotencyKey', () => {
  it('uses the durable draft identity across browser tabs and reloads', () => {
    expect(sendIdempotencyKey('draft-123', 'page-token-a')).toBe('draft:draft-123');
    expect(sendIdempotencyKey('draft-123', 'page-token-b')).toBe('draft:draft-123');
  });

  it('uses the page token when the no-JavaScript path has no saved draft', () => {
    expect(sendIdempotencyKey(null, 'page-token-a')).toBe('compose:page-token-a');
  });
});
