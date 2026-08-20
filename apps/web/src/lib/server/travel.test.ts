import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env, User } from '@cmail/shared/types';

const mocks = vi.hoisted(() => ({
  notifyManagers: vi.fn(),
}));
vi.mock('./notify-managers', () => ({ notifyManagers: mocks.notifyManagers }));

import {
  COUNTRY_PENDING_MESSAGE,
  countryAllowed,
  formatUtcTimestamp,
  recordTravelRequest,
  requestCountry,
  signInCountryGate,
} from './travel';

// notifyManagers is a plain vi.fn() (not vi.spyOn), so restoreAllMocks
// wouldn't clear its call history between tests — clearAllMocks does.
afterEach(() => vi.clearAllMocks());

const user: User = {
  id: 'user-1',
  email: 'person@example.com',
  display_name: 'Person Example',
  role: 'standard',
  status: 'active',
  auth_provider: 'google',
  created_at: '2026-08-01 00:00:00',
  updated_at: '2026-08-01 00:00:00',
  last_sign_in: null,
  last_auth_country: null,
};

describe('requestCountry', () => {
  it('reads an uppercased CF-IPCountry header and falls back to XX', () => {
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'au' } }))).toBe('AU');
    expect(requestCountry(new Request('https://mail.example.com'))).toBe('XX');
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'XX' } }))).toBe('XX');
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'nope' } }))).toBe('XX');
  });
});

describe('countryAllowed', () => {
  it('allows every country when the list is empty (feature off)', () => {
    expect(countryAllowed('US', [])).toBe(true);
    expect(countryAllowed('XX', [])).toBe(true);
  });

  it('checks plain membership otherwise', () => {
    expect(countryAllowed('AU', ['AU', 'NZ'])).toBe(true);
    expect(countryAllowed('US', ['AU', 'NZ'])).toBe(false);
  });
});

/** A stub `signin_country_exceptions` lookup returning a fixed row or null. */
function exceptionDb(row: { id: string } | null): D1Database {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(row),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

describe('signInCountryGate', () => {
  it('allows every country when the feature is off, without querying the database', async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    await expect(signInCountryGate(db, { signInCountries: [] }, { userId: 'u1', country: 'US' })).resolves.toEqual({ allowed: true });
    await expect(signInCountryGate(db, { signInCountries: [] }, { userId: 'u1', country: 'XX' })).resolves.toEqual({ allowed: true });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('allows a country on the approved list without querying exceptions', async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    await expect(signInCountryGate(db, { signInCountries: ['AU', 'NZ'] }, { userId: 'u1', country: 'AU' })).resolves.toEqual({ allowed: true });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('denies a country outside the list when no exception exists', async () => {
    const db = exceptionDb(null);
    await expect(signInCountryGate(db, { signInCountries: ['AU'] }, { userId: 'u1', country: 'US', nowEpoch: 1_000 }))
      .resolves.toEqual({ allowed: false });
  });

  it('allows a country outside the list when an unexpired exception exists', async () => {
    const db = exceptionDb({ id: 'exception-1' });
    await expect(signInCountryGate(db, { signInCountries: ['AU'] }, { userId: 'u1', country: 'US', nowEpoch: 1_000 }))
      .resolves.toEqual({ allowed: true });
  });

  it('denies once the exception has expired (the expiry check lives in the SQL, so an expired row simply is not returned)', async () => {
    const db = exceptionDb(null);
    await expect(signInCountryGate(db, { signInCountries: ['AU'] }, { userId: 'u1', country: 'US', nowEpoch: 2_000 }))
      .resolves.toEqual({ allowed: false });
  });

  it("fails closed on 'XX' once the feature is on, with no special-casing needed", async () => {
    const db = exceptionDb(null);
    await expect(signInCountryGate(db, { signInCountries: ['AU'] }, { userId: 'u1', country: 'XX', nowEpoch: 1_000 }))
      .resolves.toEqual({ allowed: false });
  });
});

describe('formatUtcTimestamp', () => {
  it('formats an epoch as a UTC date/time string', () => {
    const epoch = Date.UTC(2026, 7, 20, 14, 32, 0) / 1000;
    expect(formatUtcTimestamp(epoch)).toBe('20 Aug 2026, 14:32 UTC');
  });
});

describe('COUNTRY_PENDING_MESSAGE', () => {
  it('is the sentence documented for +page.svelte to mirror', () => {
    expect(COUNTRY_PENDING_MESSAGE).toBe(
      "This sign-in came from outside your organisation's approved countries. Your managers have been notified — try again once a manager approves it.",
    );
  });
});

/**
 * A stateful stub of `signin_country_requests` covering exactly the three
 * statements recordTravelRequest issues: the upsert INSERT, the pending-row
 * SELECT, and the throttle UPDATE...RETURNING. The throttle branch has no
 * internal `await`, so — like the real UPDATE...RETURNING in D1 — whichever
 * caller's synchronous check-and-set runs first is the only one that can win
 * under concurrent calls.
 */
function requestDb(initialLastNotified: number | null): { db: D1Database; getLastNotified: () => number | null } {
  const pendingId = 'request-1';
  let lastNotified = initialLastNotified;
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      first: vi.fn(async () => {
        if (sql.includes('SELECT id FROM signin_country_requests')) {
          return { id: pendingId };
        }
        if (sql.includes('UPDATE signin_country_requests') && sql.includes('RETURNING')) {
          const [nowEpoch, id, cutoff] = args as [number, string, number];
          if (id !== pendingId) return null;
          if (lastNotified === null || lastNotified < cutoff) {
            lastNotified = nowEpoch;
            return { id };
          }
          return null;
        }
        return null;
      }),
    })),
  }));
  return { db: { prepare } as unknown as D1Database, getLastNotified: () => lastNotified };
}

describe('recordTravelRequest', () => {
  const env = {} as Env;
  const baseOptions = { user, country: 'US', appUrl: 'https://mail.example.com' };

  it('notifies managers with the expected content when never notified before', async () => {
    const { db } = requestDb(null);
    await recordTravelRequest(db, env, { ...baseOptions, nowEpoch: 1_000 });

    expect(mocks.notifyManagers).toHaveBeenCalledTimes(1);
    const [calledEnv, message] = mocks.notifyManagers.mock.calls[0];
    expect(calledEnv).toBe(env);
    expect(message.subject).toBe('Sign-in approval needed: Person Example from United States');
    expect(message.html).toContain('https://mail.example.com/admin/travel');
    expect(message.text).toContain('https://mail.example.com/admin/travel');
  });

  it('does not re-notify inside the six-hour throttle window', async () => {
    const { db } = requestDb(1_000);
    await recordTravelRequest(db, env, { ...baseOptions, nowEpoch: 1_000 + 60 * 60 }); // +1h
    expect(mocks.notifyManagers).not.toHaveBeenCalled();
  });

  it('re-notifies once the throttle window has fully elapsed', async () => {
    const { db } = requestDb(1_000);
    await recordTravelRequest(db, env, { ...baseOptions, nowEpoch: 1_000 + 6 * 60 * 60 + 1 }); // +6h and 1s
    expect(mocks.notifyManagers).toHaveBeenCalledTimes(1);
  });

  it('lets only the winner of a concurrent throttle race notify', async () => {
    const { db, getLastNotified } = requestDb(null);
    await Promise.all([
      recordTravelRequest(db, env, { ...baseOptions, nowEpoch: 5_000 }),
      recordTravelRequest(db, env, { ...baseOptions, nowEpoch: 5_000 }),
    ]);
    expect(mocks.notifyManagers).toHaveBeenCalledTimes(1);
    expect(getLastNotified()).toBe(5_000);
  });
});
