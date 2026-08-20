import { describe, expect, it, vi } from 'vitest';
import {
  constantTimeEqualHex,
  countryAllowed,
  createOtpProof,
  generateOtpCode,
  hashOtpCode,
  issueOtp,
  requestCountry,
  verifyOtp,
  verifyOtpProof,
} from './email-otp';

const SESSION_SECRET = '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749';

function batchDb() {
  const captured: Array<{ sql: string; args: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        statement.args = args;
        return statement;
      },
    };
    captured.push(statement);
    return statement;
  });
  const batch = vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);
  return { db: { prepare, batch } as unknown as D1Database, captured };
}

/**
 * A stateful mock of the single `auth_otp_codes` row that verifyOtp's
 * UPDATE...RETURNING / DELETE statements act on, so tests can drive a
 * realistic sequence of verify attempts (attempts incrementing across calls,
 * the row disappearing after success/lock) without a real database.
 */
function rowDb(initial: { id: string; codeHash: string; attempts: number; expiresEpoch: number } | null) {
  let row = initial ? { ...initial } : null;
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      async first() {
        if (!row) return null;
        if (sql.includes('UPDATE auth_otp_codes') && sql.includes('RETURNING')) {
          row.attempts += 1;
          return { id: row.id, code_hash: row.codeHash, attempts: row.attempts, expires_epoch: row.expiresEpoch };
        }
        return null;
      },
      async run() {
        if (sql.startsWith('DELETE FROM auth_otp_codes')) row = null;
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  });
  return { db: { prepare } as unknown as D1Database, getRow: () => row };
}

describe('generateOtpCode', () => {
  it('produces exactly eight decimal digits', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{8}$/);
    }
  });

  it('draws each digit from a near-uniform distribution (rejection-sampling smoke test)', () => {
    const counts = new Array(10).fill(0);
    const trials = 1000;
    for (let i = 0; i < trials; i += 1) {
      for (const digit of generateOtpCode()) counts[Number(digit)] += 1;
    }
    const expected = (trials * 8) / 10; // 800
    for (const count of counts) {
      // ~7 standard deviations of slack (sd ~= 27) — astronomically unlikely
      // to fail from true randomness, but would catch a broken/biased draw.
      expect(count).toBeGreaterThan(expected - 200);
      expect(count).toBeLessThan(expected + 200);
    }
  });
});

describe('hashOtpCode', () => {
  it('is deterministic for identical inputs', async () => {
    const a = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const b = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates hashes by purpose', async () => {
    const signin = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const enroll = await hashOtpCode('enroll', 'person@example.com', '12345678', SESSION_SECRET);
    expect(signin).not.toBe(enroll);
  });

  it('separates hashes by address', async () => {
    const a = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const b = await hashOtpCode('signin', 'other@example.com', '12345678', SESSION_SECRET);
    expect(a).not.toBe(b);
  });

  it('separates hashes by code', async () => {
    const a = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const b = await hashOtpCode('signin', 'person@example.com', '87654321', SESSION_SECRET);
    expect(a).not.toBe(b);
  });
});

describe('constantTimeEqualHex', () => {
  it('accepts identical strings and rejects any single-character difference', () => {
    const value = 'a'.repeat(63) + 'b';
    expect(constantTimeEqualHex(value, value)).toBe(true);
    expect(constantTimeEqualHex(value, 'b' + 'a'.repeat(63))).toBe(false); // differs at index 0
    expect(constantTimeEqualHex(value, 'a'.repeat(63) + 'c')).toBe(false); // differs at the last index
  });

  it('rejects differing lengths', () => {
    expect(constantTimeEqualHex('abc', 'abcd')).toBe(false);
  });
});

describe('issueOtp', () => {
  it('deletes any prior code for the pair, then inserts one whose hash matches hashOtpCode', async () => {
    const { db, captured } = batchDb();
    const { code, requestId } = await issueOtp(
      db,
      { purpose: 'signin', address: 'Person@Example.COM', sessionSecret: SESSION_SECRET },
      1_000,
    );

    expect(code).toMatch(/^\d{8}$/);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(captured[0].sql).toContain('DELETE FROM auth_otp_codes WHERE address = ? AND purpose = ?');
    expect(captured[0].args).toEqual(['person@example.com', 'signin']);
    expect(captured[1].sql).toContain('INSERT INTO auth_otp_codes');

    // attempts is a literal 0 in the INSERT's VALUES list, not a bind parameter.
    const [, purpose, address, codeHash, insertedRequestId, createdEpoch, expiresEpoch] = captured[1].args;
    expect(purpose).toBe('signin');
    expect(address).toBe('person@example.com'); // lowercased, matching the DELETE key
    expect(insertedRequestId).toBe(requestId);
    expect(createdEpoch).toBe(1_000);
    expect(expiresEpoch).toBe(1_000 + 5 * 60);
    expect(codeHash).toBe(await hashOtpCode('signin', 'person@example.com', code, SESSION_SECRET));

    // The raw code must never appear anywhere bound to storage.
    expect(captured.flatMap((statement) => statement.args)).not.toContain(code);
  });
});

describe('verifyOtp', () => {
  it('returns unknown when no row matches address/purpose/requestId', async () => {
    const { db } = rowDb(null);
    await expect(verifyOtp(db, {
      purpose: 'signin', address: 'person@example.com', code: '12345678',
      requestId: 'missing', sessionSecret: SESSION_SECRET,
    }, 1_000)).resolves.toBe('unknown');
  });

  it('accepts the correct code and deletes the row', async () => {
    const codeHash = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const { db, getRow } = rowDb({ id: 'otp-1', codeHash, attempts: 0, expiresEpoch: 2_000 });

    await expect(verifyOtp(db, {
      purpose: 'signin', address: 'Person@Example.com', code: '12345678',
      requestId: 'request-1', sessionSecret: SESSION_SECRET,
    }, 1_000)).resolves.toBe('ok');
    expect(getRow()).toBeNull();
  });

  it('reports expired for a correct code past its expiry', async () => {
    const codeHash = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const { db } = rowDb({ id: 'otp-1', codeHash, attempts: 0, expiresEpoch: 500 });

    await expect(verifyOtp(db, {
      purpose: 'signin', address: 'person@example.com', code: '12345678',
      requestId: 'request-1', sessionSecret: SESSION_SECRET,
    }, 1_000)).resolves.toBe('expired');
  });

  it('locks out after five wrong attempts and then reports unknown once the row is gone', async () => {
    const codeHash = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const { db, getRow } = rowDb({ id: 'otp-1', codeHash, attempts: 0, expiresEpoch: 2_000 });
    const attempt = () => verifyOtp(db, {
      purpose: 'signin', address: 'person@example.com', code: '00000000',
      requestId: 'request-1', sessionSecret: SESSION_SECRET,
    }, 1_000);

    await expect(attempt()).resolves.toBe('mismatch'); // 1
    await expect(attempt()).resolves.toBe('mismatch'); // 2
    await expect(attempt()).resolves.toBe('mismatch'); // 3
    await expect(attempt()).resolves.toBe('mismatch'); // 4
    await expect(attempt()).resolves.toBe('locked');   // 5 — final attempt, still wrong
    expect(getRow()).toBeNull();

    await expect(attempt()).resolves.toBe('unknown'); // row is gone; a parallel storm can't retry
  });

  it('still succeeds on the fifth attempt when that final try is the correct code', async () => {
    const codeHash = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const { db } = rowDb({ id: 'otp-1', codeHash, attempts: 4, expiresEpoch: 2_000 });

    await expect(verifyOtp(db, {
      purpose: 'signin', address: 'person@example.com', code: '12345678',
      requestId: 'request-1', sessionSecret: SESSION_SECRET,
    }, 1_000)).resolves.toBe('ok');
  });

  it('locks a request that arrives after the attempt budget is already exhausted, without inspecting the code', async () => {
    const codeHash = await hashOtpCode('signin', 'person@example.com', '12345678', SESSION_SECRET);
    const { db } = rowDb({ id: 'otp-1', codeHash, attempts: 5, expiresEpoch: 2_000 });

    // Even the correct code is refused once every attempt is spent.
    await expect(verifyOtp(db, {
      purpose: 'signin', address: 'person@example.com', code: '12345678',
      requestId: 'request-1', sessionSecret: SESSION_SECRET,
    }, 1_000)).resolves.toBe('locked');
  });
});

describe('OTP proof cookie', () => {
  it('round-trips a valid proof and rejects expiry, tampering, and the wrong secret', async () => {
    const requestId = '11111111-1111-1111-1111-111111111111';
    const proof = await createOtpProof('signin', 'Person@Example.COM', requestId, SESSION_SECRET, 1_000);
    await expect(verifyOtpProof(proof, SESSION_SECRET, 1_001)).resolves.toMatchObject({
      v: 1, purpose: 'signin', address: 'person@example.com', requestId,
    });
    await expect(verifyOtpProof(proof, SESSION_SECRET, 1_000 + 10 * 60)).resolves.toBeNull(); // expired

    const [payload, signature] = proof.split('.');
    const flipped = signature.startsWith('A') ? 'B' : 'A';
    await expect(verifyOtpProof(`${payload}.${flipped}${signature.slice(1)}`, SESSION_SECRET, 1_001)).resolves.toBeNull();
    await expect(verifyOtpProof(proof, `${SESSION_SECRET}different`, 1_001)).resolves.toBeNull();
  });

  it('rejects malformed or incomplete proofs', async () => {
    await expect(verifyOtpProof(undefined, SESSION_SECRET)).resolves.toBeNull();
    await expect(verifyOtpProof('not-a-proof', SESSION_SECRET)).resolves.toBeNull();
    await expect(verifyOtpProof('a.b.c', SESSION_SECRET)).resolves.toBeNull();
  });
});

describe('geo helpers', () => {
  it('reads an uppercased CF-IPCountry header and falls back to XX', () => {
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'au' } }))).toBe('AU');
    expect(requestCountry(new Request('https://mail.example.com'))).toBe('XX');
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'XX' } }))).toBe('XX');
    expect(requestCountry(new Request('https://mail.example.com', { headers: { 'cf-ipcountry': 'nope' } }))).toBe('XX');
  });

  it('allows every country when unset, otherwise checks membership', () => {
    expect(countryAllowed('AU', null)).toBe(true);
    expect(countryAllowed('AU', ['AU', 'NZ'])).toBe(true);
    expect(countryAllowed('US', ['AU', 'NZ'])).toBe(false);
  });
});
