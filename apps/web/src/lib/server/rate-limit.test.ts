import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeRateLimit } from './rate-limit';

afterEach(() => vi.restoreAllMocks());

describe('weighted rate limiting', () => {
  it('atomically increments a bucket by the requested cost', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const first = vi.fn().mockResolvedValue({ count: 7 });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await expect(consumeRateLimit(db, 'outbound-work', 'user-1', 10, 3600, 7)).resolves.toEqual({
      allowed: true,
      remaining: 3,
      retryAfter: 2800,
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('count = count + excluded.count'));
    expect(bind).toHaveBeenCalledWith('outbound-work:user-1:472222', 7, 1_700_002_800);
  });

  it('rejects invalid costs before touching storage', async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    await expect(consumeRateLimit(db, 'scope', 'subject', 10, 60, 0)).rejects.toThrow(RangeError);
    expect(prepare).not.toHaveBeenCalled();
  });
});
