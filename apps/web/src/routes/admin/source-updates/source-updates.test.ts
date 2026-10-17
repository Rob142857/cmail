import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSourceUpdates } from '$lib/server/source-updates';

vi.mock('$lib/server/source-updates', async (original) => ({
  ...(await original<typeof import('$lib/server/source-updates')>()),
  checkSourceUpdates: vi.fn(),
}));
vi.stubGlobal('__CMAIL_BUILD__', { revision: 'a'.repeat(40), modified: false });

const manager = { role: 'manager' };
type Event = Parameters<typeof import('./+server').GET>[0];
const call = async (env: Record<string, string> = {}) => {
  const { GET } = await import('./+server');
  return GET({ locals: { user: manager }, platform: { env } } as unknown as Event);
};

describe('manager update endpoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(checkSourceUpdates).mockReset().mockResolvedValue({ status: 'current', checkedAt: 'now' } as never);
  });

  it('rejects unsigned requests before checking upstream', async () => {
    const { GET } = await import('./+server');
    await expect(GET({ locals: { user: null } } as unknown as Event)).rejects.toMatchObject({ status: 401 });
    expect(checkSourceUpdates).not.toHaveBeenCalled();
  });

  it('rejects standard users before checking upstream', async () => {
    const { GET } = await import('./+server');
    await expect(GET({ locals: { user: { role: 'standard' } } } as unknown as Event)).rejects.toMatchObject({ status: 403 });
    expect(checkSourceUpdates).not.toHaveBeenCalled();
  });

  it('defaults to the public repository and caches the result', async () => {
    const { GET } = await import('./+server');
    const event = { locals: { user: manager }, platform: { env: {} } } as unknown as Event;
    await GET(event);
    await GET(event);
    expect(checkSourceUpdates).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkSourceUpdates).mock.calls[0][1]).toBe('https://github.com/Rob142857/cmail');
  });

  it('uses a configured fork', async () => {
    await call({ REPO_URL: ' https://github.com/example/fork ' });
    expect(vi.mocked(checkSourceUpdates).mock.calls[0][1]).toBe('https://github.com/example/fork');
  });

  it('can be turned off without contacting upstream', async () => {
    const response = await call({ UPDATE_CHECK: 'off', REPO_URL: 'https://github.com/example/fork' });
    expect(await response.json()).toMatchObject({
      status: 'disabled', procedureUrl: 'https://github.com/example/fork/blob/main/docs/deployment.md#updating-an-existing-instance',
    });
    expect(checkSourceUpdates).not.toHaveBeenCalled();
  });
});
