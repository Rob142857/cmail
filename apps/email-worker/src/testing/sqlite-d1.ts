// Test-only: a minimal D1-compatible adapter over node:sqlite with every real
// migration applied, so SQL and triggers run exactly as written. Imported only
// by *.test.ts files, never by the Worker.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/shared/migrations');

const normalise = (value: unknown): SQLInputValue =>
  (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value as SQLInputValue);

class Statement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, private readonly args: unknown[] = []) {}

  bind(...args: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, args);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.args.map(normalise)) as Record<string, unknown> | undefined;
    return row ? ({ ...row } as T) : null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.sqlite.prepare(this.sql).all(...this.args.map(normalise)) as Record<string, unknown>[];
    return { results: rows.map((row) => ({ ...row })) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.sqlite.prepare(this.sql).run(...this.args.map(normalise));
    return { meta: { changes: Number(result.changes) } };
  }
}

export function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (caught) {
        sqlite.exec('ROLLBACK');
        throw caught;
      }
    },
  } as unknown as D1Database;
  return { d1, sqlite };
}
