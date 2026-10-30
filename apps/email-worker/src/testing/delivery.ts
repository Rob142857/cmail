// Shared test harness for driving the inbound `email()` handler with an
// in-memory D1 and R2. Test-only: nothing here is imported by the Worker.
import { vi } from 'vitest';

export interface Statement {
  query: string;
  values: unknown[];
}

export interface DeliveryDatabaseHooks {
  /** Answer a `first()` query; return undefined to fall through to the default. */
  first?: (query: string) => unknown;
  /** Answer an `all()` query; return undefined to fall through to `{ results: [] }`. */
  all?: (query: string) => { results: unknown[] } | undefined;
  /** Answer a `run()`; return undefined for the default `{ meta: { changes: 1 } }`. Throw to fail it. */
  run?: (query: string) => { meta: { changes: number } } | undefined;
  /** Called with each D1 batch before it "commits"; throw to fail it. */
  batch?: (list: Statement[]) => void;
}

/** A D1 stand-in with one active mailbox ('mailbox-1'). Every query is recorded. */
export function deliveryDatabase(hooks: DeliveryDatabaseHooks = {}) {
  const statements: Statement[] = [];
  const batched: Statement[] = [];
  const database = {
    prepare(query: string) {
      const statement: Statement & Record<string, unknown> = {
        query,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first() {
          statements.push(statement);
          const answer = hooks.first?.(query);
          if (answer !== undefined) return answer;
          return query.includes('FROM mailboxes') ? { id: 'mailbox-1', status: 'active' } : null;
        },
        async all() {
          statements.push(statement);
          return hooks.all?.(query) ?? { results: [] };
        },
        async run() {
          statements.push(statement);
          return hooks.run?.(query) ?? { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(list: Statement[]) {
      batched.push(...list);
      hooks.batch?.(list);
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { database, statements, batched };
}

/** An R2 stand-in that records keys; `failPut` decides per key (in write order) whether a put throws. */
export function memoryStorage(failPut: (key: string, index: number) => boolean = () => false) {
  const putKeys: string[] = [];
  const deletedKeys: string[] = [];
  const storage = {
    put: vi.fn(async (key: string) => {
      putKeys.push(key);
      if (failPut(key, putKeys.length - 1)) throw new Error('R2 put failed');
    }),
    delete: vi.fn(async (key: string) => {
      deletedKeys.push(key);
    }),
  };
  return { storage, putKeys, deletedKeys };
}

/** Inbound guards off: no reservation, no quota. */
export const GUARDS_OFF = {
  INBOUND_MAILBOX_MESSAGES_PER_HOUR: '0',
  INBOUND_MAILBOX_BYTES_PER_HOUR: '0',
  INBOUND_SENDER_MESSAGES_PER_HOUR: '0',
  MAILBOX_STORAGE_QUOTA_BYTES: '0',
};

type EmailHandler = {
  email(value: unknown, environment: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
};

/**
 * Run one inbound delivery. Resolves (never rejects) with the handler's error,
 * if any, so a failing delivery is always observed by the test.
 */
export async function deliverInbound(
  worker: unknown,
  raw: string,
  environment: Record<string, unknown>,
  envelope: { from?: string; to?: string; rawSize?: number; rawStream?: ReadableStream } = {},
) {
  const messageIdHeader = /^Message-ID: (.*)$/im.exec(raw)?.[1] ?? '';
  const message = {
    from: envelope.from ?? 'bounce@partner.example',
    to: envelope.to ?? 'mailbox@example.test',
    rawSize: envelope.rawSize ?? raw.length,
    headers: new Headers(messageIdHeader ? { 'message-id': messageIdHeader } : {}),
    raw: envelope.rawStream ?? new Blob([raw]).stream(),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  };
  const error = await (worker as EmailHandler)
    .email(message, environment, { waitUntil: () => undefined })
    .then(() => null, (caught: unknown) => caught as Error);
  return { error, message };
}

/** Column name to value for an INSERT, matching literals as well as bound values. */
export function insertedRow(statements: Statement[], table: string): Record<string, unknown> {
  const insert = statements.find((statement) => statement.query.includes(`INSERT INTO ${table}`));
  if (!insert) throw new Error(`Nothing was inserted into ${table}`);
  const columns = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)`).exec(insert.query)?.[1].split(',').map((column) => column.trim()) ?? [];
  const tokens = /VALUES \(([\s\S]*)\)\s*$/.exec(insert.query.trim())?.[1].split(/,\s*/) ?? [];
  const values = [...insert.values];
  return Object.fromEntries(columns.map((column, index) => [column, tokens[index] === '?' ? values.shift() : tokens[index]]));
}
