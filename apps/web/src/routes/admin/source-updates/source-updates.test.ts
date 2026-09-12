import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

vi.mock('$lib/server/source-updates', () => ({
  checkSourceUpdates: vi.fn().mockResolvedValue({ status: 'unknown' }),
}));

describe('manager update endpoint access', () => {
  it('rejects unsigned requests before checking upstream', async () => {
    await expect(GET({ locals: { user: null } } as unknown as Parameters<typeof GET>[0]))
      .rejects.toMatchObject({ status: 401 });
  });
  it('rejects standard users before checking upstream', async () => {
    await expect(GET({ locals: { user: { role: 'standard' } } } as unknown as Parameters<typeof GET>[0]))
      .rejects.toMatchObject({ status: 403 });
  });
});
