import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@cmail/shared/types';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  loadOrgSettings: vi.fn(),
  detectProvider: vi.fn(),
  sendEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
}));
vi.mock('./db', () => ({ audit: mocks.audit }));
vi.mock('./org-settings', () => ({ loadOrgSettings: mocks.loadOrgSettings }));
vi.mock('./outbound', () => ({ detectProvider: mocks.detectProvider, sendEmail: mocks.sendEmail }));
vi.mock('./rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }));

import { notifyManagers } from './notify-managers';

afterEach(() => vi.restoreAllMocks());

function fakeDb(managers: Array<{ email: string }>): D1Database {
  const prepare = vi.fn(() => ({
    all: vi.fn().mockResolvedValue({ results: managers }),
  }));
  return { prepare } as unknown as D1Database;
}

const message = { subject: 'Test subject', html: '<p>hi</p>', text: 'hi' };

describe('notifyManagers', () => {
  beforeEach(() => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfter: 3600 });
    mocks.loadOrgSettings.mockResolvedValue({ systemEmail: 'system@example.com', systemFromName: 'Example Mail' });
    mocks.detectProvider.mockReturnValue('cloudflare');
    mocks.sendEmail.mockResolvedValue({ success: true, provider: 'cloudflare' });
    mocks.audit.mockResolvedValue(undefined);
  });

  it('skips sending and audits a rate-limit event when the global cap is exhausted', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 10 });
    const db = fakeDb([{ email: 'manager@example.com' }]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(db, expect.objectContaining({ event_type: 'security.rate_limit' }));
  });

  it('returns zero recipients and sends nothing when there are no active managers', async () => {
    const db = fakeDb([]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('audits email.failed and skips sending when no outbound provider is configured', async () => {
    mocks.detectProvider.mockReturnValue('none');
    const db = fakeDb([{ email: 'manager@example.com' }]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(db, expect.objectContaining({ event_type: 'email.failed' }));
  });

  it('sends exactly one email addressed to every active manager', async () => {
    const db = fakeDb([{ email: 'a@example.com' }, { email: 'b@example.com' }]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 2 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const [sentEmail] = mocks.sendEmail.mock.calls[0];
    expect(sentEmail.to).toEqual(['a@example.com', 'b@example.com']);
    expect(sentEmail.subject).toBe(message.subject);
    expect(sentEmail.from).toBe('system@example.com');
  });

  it('audits email.failed and reports zero recipients when delivery fails', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, provider: 'cloudflare', error: 'boom' });
    const db = fakeDb([{ email: 'a@example.com' }]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 0 });
    expect(mocks.audit).toHaveBeenCalledWith(db, expect.objectContaining({ event_type: 'email.failed' }));
  });

  it('audits email.failed when sendEmail throws', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('network down'));
    const db = fakeDb([{ email: 'a@example.com' }]);

    const result = await notifyManagers({ DB: db } as unknown as Env, message);

    expect(result).toEqual({ recipients: 0 });
    expect(mocks.audit).toHaveBeenCalledWith(db, expect.objectContaining({ event_type: 'email.failed' }));
  });
});
