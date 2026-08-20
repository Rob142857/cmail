import { describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';
import {
  BootstrapConflictError,
  bootstrapConfiguration,
  createBootstrapProof,
  provisionBootstrapManager,
  secretsEqual,
  verifyBootstrapProof,
} from './bootstrap';

const SESSION_SECRET = '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749';
const BOOTSTRAP_TOKEN = 'f066c28498cc274be34e35d4a36ce10e72bc62f5f7674cd5';

function managerUser(overrides: Partial<User> = {}): User {
  return {
    id: 'manager-1',
    email: 'admin@example.com',
    display_name: 'First Manager',
    role: 'manager',
    status: 'active',
    auth_provider: 'google',
    created_at: '2026-08-03 00:00:00',
    updated_at: '2026-08-03 00:00:00',
    last_sign_in: null,
    last_auth_country: null,
    ...overrides,
  };
}

function provisioningDb(options: {
  existing?: (User & { identity_bound: number }) | null;
  changes: number[];
  finalUser?: User | null;
}) {
  const statements: Array<{ sql: string; args: unknown[]; first: ReturnType<typeof vi.fn> }> = [];
  const prepare = vi.fn((sql: string) => {
    const first = vi.fn(async () => {
      if (sql.includes('FROM users u WHERE lower(u.email)')) return options.existing ?? null;
      if (sql.includes('SELECT * FROM users WHERE id = ?')) return options.finalUser ?? null;
      return null;
    });
    const statement = {
      sql,
      args: [] as unknown[],
      first,
      bind(...args: unknown[]) {
        statement.args = args;
        return statement;
      },
    };
    statements.push(statement);
    return statement;
  });
  const batch = vi.fn().mockResolvedValue(options.changes.map((changes) => ({ meta: { changes } })));
  return { db: { prepare, batch } as unknown as D1Database, statements, batch };
}

describe('bootstrap proof', () => {
  it('requires both a valid email and independent strong secrets', () => {
    expect(bootstrapConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: ' Admin@Example.COM ',
      BOOTSTRAP_ADMIN_TOKEN: BOOTSTRAP_TOKEN,
      SESSION_SECRET,
    })).toEqual({
      email: 'admin@example.com',
      token: BOOTSTRAP_TOKEN,
      sessionSecret: SESSION_SECRET,
    });
    expect(bootstrapConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_TOKEN: 'short',
      SESSION_SECRET,
    })).toBeNull();
    expect(bootstrapConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_TOKEN: BOOTSTRAP_TOKEN,
      SESSION_SECRET: 'short',
    })).toBeNull();
    expect(bootstrapConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_TOKEN: BOOTSTRAP_TOKEN,
      SESSION_SECRET: BOOTSTRAP_TOKEN,
    })).toBeNull();
  });

  it('verifies a valid proof and rejects expiry, signature tampering, and the wrong secret', async () => {
    const proof = await createBootstrapProof('Admin@Example.COM', SESSION_SECRET, 1_000);
    await expect(verifyBootstrapProof(proof, SESSION_SECRET, 1_001)).resolves.toMatchObject({
      version: 1,
      email: 'admin@example.com',
      expiresAt: 1_600,
    });
    await expect(verifyBootstrapProof(proof, SESSION_SECRET, 1_600)).resolves.toBeNull();

    const [payload, signature] = proof.split('.');
    const replacement = signature.startsWith('A') ? 'B' : 'A';
    await expect(verifyBootstrapProof(
      `${payload}.${replacement}${signature.slice(1)}`,
      SESSION_SECRET,
      1_001,
    )).resolves.toBeNull();
    await expect(verifyBootstrapProof(proof, `${SESSION_SECRET}different`, 1_001)).resolves.toBeNull();
  });

  it('compares submitted setup tokens without an early string comparison', async () => {
    await expect(secretsEqual(BOOTSTRAP_TOKEN, BOOTSTRAP_TOKEN)).resolves.toBe(true);
    await expect(secretsEqual(`${BOOTSTRAP_TOKEN}x`, BOOTSTRAP_TOKEN)).resolves.toBe(false);
  });
});

describe('atomic first-manager provisioning', () => {
  it('gates manager creation and identity binding inside the same batch', async () => {
    const finalUser = managerUser();
    const { db, statements, batch } = provisioningDb({ changes: [1, 1], finalUser });
    await expect(provisionBootstrapManager(db, {
      email: finalUser.email,
      displayName: finalUser.display_name,
      provider: 'google',
      subject: 'immutable-subject',
      mailDomain: '',
    })).resolves.toEqual(finalUser);

    const batched = batch.mock.calls[0][0] as Array<{ sql: string }>;
    expect(batched[0].sql).toContain("NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager')");
    expect(batched[1].sql).toContain('WHERE changes() = 1');
    expect(statements.flatMap((statement) => statement.args)).toContain('immutable-subject');
  });

  it('fails closed when another request wins the single-manager race', async () => {
    const { db } = provisioningDb({ changes: [0, 0], finalUser: null });
    await expect(provisionBootstrapManager(db, {
      email: 'admin@example.com',
      displayName: 'First Manager',
      provider: 'microsoft',
      subject: 'immutable-subject',
      mailDomain: '',
    })).rejects.toBeInstanceOf(BootstrapConflictError);
  });

  it('never rebinds an existing email-selected user that already has an identity', async () => {
    const existing = { ...managerUser({ role: 'standard', status: 'pending' }), identity_bound: 1 };
    const { db, batch } = provisioningDb({ existing, changes: [] });
    await expect(provisionBootstrapManager(db, {
      email: existing.email,
      displayName: existing.display_name,
      provider: 'google',
      subject: 'different-subject',
      mailDomain: '',
    })).rejects.toBeInstanceOf(BootstrapConflictError);
    expect(batch).not.toHaveBeenCalled();
  });
});
