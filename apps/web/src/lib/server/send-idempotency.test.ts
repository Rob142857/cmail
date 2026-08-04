import { describe, expect, it } from 'vitest';
import { sendIdempotencyKey } from './send-idempotency';

describe('sendIdempotencyKey', () => {
  it('uses the claimed draft generation across browser tabs', () => {
    expect(sendIdempotencyKey('draft-123', 'page-token-a', 4)).toBe('draft:draft-123:version:4');
    expect(sendIdempotencyKey('draft-123', 'page-token-b', 4)).toBe('draft:draft-123:version:4');
  });

  it('rotates the key after the draft advances to a newer generation', () => {
    expect(sendIdempotencyKey('draft-123', 'page-token-a', 4))
      .not.toBe(sendIdempotencyKey('draft-123', 'page-token-a', 5));
  });

  it('uses the page token when the no-JavaScript path has no saved draft', () => {
    expect(sendIdempotencyKey(null, 'page-token-a')).toBe('compose:page-token-a');
  });

  it('rejects a draft key without a validated generation', () => {
    expect(() => sendIdempotencyKey('draft-123', 'page-token-a')).toThrow('claimed draft version');
  });
});
