import { describe, expect, it, vi } from 'vitest';
import { GUARDS_OFF, deliverInbound, deliveryDatabase, insertedRow, memoryStorage } from './testing/delivery';

// Inbound mail the Worker must refuse: each refusal gives the sender a fixed,
// non-diagnostic reason and stores nothing in R2 or the messages table.

vi.mock('@cmail/shared/push', async (original) => ({
  ...(await original<typeof import('@cmail/shared/push')>()),
  sendNewMailNotifications: vi.fn(async () => ({})),
}));

const { default: worker, RECIPIENT_UNAVAILABLE_SMTP_RESPONSE } = await import('./index');

function mail(options: { headers?: string[]; body?: string[]; contentType?: string } = {}): string {
  return [
    'From: Ann Partner <ann@partner.example>',
    'To: mailbox@example.test',
    'Subject: Delivery check',
    'Message-ID: <check-1@partner.example>',
    ...(options.headers ?? []),
    `Content-Type: ${options.contentType ?? 'text/plain; charset=utf-8'}`,
    '',
    ...(options.body ?? ['A short note.']),
    '',
  ].join('\r\n');
}

function withAttachments(files: Array<{ name: string; content: string }>): string {
  return mail({
    headers: ['MIME-Version: 1.0'],
    contentType: 'multipart/mixed; boundary="b1"',
    body: [
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'See attached.',
      ...files.flatMap((file) => [
        '--b1',
        `Content-Type: application/octet-stream; name="${file.name}"`,
        `Content-Disposition: attachment; filename="${file.name}"`,
        '',
        file.content,
      ]),
      '--b1--',
    ],
  });
}

async function accept(raw: string, extraEnv: Record<string, unknown> = {}, envelope: Parameters<typeof deliverInbound>[3] = {}) {
  const db = deliveryDatabase();
  const { storage } = memoryStorage();
  const { error, message } = await deliverInbound(worker, raw, { DB: db.database, STORAGE: storage, ...GUARDS_OFF, ...extraEnv }, envelope);
  expect(error).toBeNull();
  expect(message.setReject).not.toHaveBeenCalled();
  return { db, storage };
}

async function refuse(raw: string, extraEnv: Record<string, unknown> = {}, envelope: Parameters<typeof deliverInbound>[3] = {}, mailboxFound = true) {
  const db = deliveryDatabase({ first: (query) => (query.includes('FROM mailboxes') && !mailboxFound ? null : undefined) });
  const { storage } = memoryStorage();
  const { error, message } = await deliverInbound(worker, raw, { DB: db.database, STORAGE: storage, ...GUARDS_OFF, ...extraEnv }, envelope);
  expect(error).toBeNull();
  expect(storage.put).not.toHaveBeenCalled();
  expect(db.batched.some((statement) => statement.query.includes('INSERT INTO messages'))).toBe(false);
  const reason = message.setReject.mock.calls[0]?.[0];
  const trace = db.statements.some((statement) => statement.query.includes('INSERT INTO mail_trace'))
    ? insertedRow(db.statements, 'mail_trace')
    : null;
  return { reason, trace };
}

describe('inbound refusals before the message is read', () => {
  it.each([['recipient', { to: 'not an address' }], ['sender', { from: 'not an address' }]])('refuses an invalid envelope %s without writing a trace', async (_label, envelope) => {
    const { reason, trace } = await refuse(mail(), {}, envelope);
    expect(reason).toBe('Invalid envelope address');
    expect(trace).toBeNull();
  });

  it('refuses a message one byte over the configured limit, and accepts one exactly at it', async () => {
    const { reason, trace } = await refuse(mail(), { MAX_INBOUND_BYTES: '4096' }, { rawSize: 4097 });
    expect(reason).toBe('Message exceeds the configured size limit');
    expect(trace).toBeNull();
    await accept(mail(), { MAX_INBOUND_BYTES: '4096' }, { rawSize: 4096 });
  });

  it('refuses a recipient with no active mailbox with the neutral response', async () => {
    const { reason, trace } = await refuse(mail(), {}, {}, false);
    expect(reason).toBe(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(trace).toBeNull();
  });

  it('looks the recipient up among active mailboxes only', async () => {
    const { db } = await accept(mail());
    const lookup = db.statements.find((statement) => statement.query.includes('FROM mailboxes'));
    expect(lookup?.values).toEqual(['mailbox@example.test', 'active']);
  });

  it('refuses a Message-ID over 998 characters, and accepts one of exactly 998', async () => {
    const idOfLength = (length: number) => `<${'a'.repeat(length - '<@partner.example>'.length)}@partner.example>`;
    expect(idOfLength(999)).toHaveLength(999);
    const { reason } = await refuse(mail().replace('<check-1@partner.example>', idOfLength(999)));
    expect(reason).toBe('Message metadata exceeds the configured limit');
    await accept(mail().replace('<check-1@partner.example>', idOfLength(998)));
  });
});

describe('inbound refusals after parsing', () => {
  it('refuses a message whose content cannot be read, and traces it', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('stream reset'));
      },
    });
    const { reason, trace } = await refuse(mail(), {}, { rawStream: broken });
    expect(reason).toBe('Message could not be parsed');
    expect(trace).toMatchObject({ status: 'rejected', status_detail: 'Message parsing failed' });
  });

  it('refuses a body over the decoded processing limit', async () => {
    const { reason, trace } = await refuse(mail({ body: ['x'.repeat(200)] }), { MAX_INBOUND_DECODED_BODY_BYTES: '64' });
    expect(reason).toBe('Message body exceeds the configured processing limit');
    expect(trace).toMatchObject({ status: 'rejected', status_detail: 'Decoded body complexity limit exceeded' });
  });

  it('refuses more attachments than the configured count', async () => {
    const raw = withAttachments([{ name: 'a.txt', content: 'one' }, { name: 'b.txt', content: 'two' }]);
    const { reason, trace } = await refuse(raw, { MAX_ATTACHMENTS_PER_MESSAGE: '1' });
    expect(reason).toBe('Message exceeds the attachment count limit');
    expect(trace).toMatchObject({ status_detail: 'Attachment count limit exceeded' });
  });

  it('refuses attachments larger in total than the message limit', async () => {
    // The envelope size passes the early check; the decoded attachments do not.
    const raw = withAttachments([{ name: 'big.txt', content: 'y'.repeat(5000) }]);
    const { reason, trace } = await refuse(raw, { MAX_INBOUND_BYTES: '4096' }, { rawSize: 1000 });
    expect(reason).toBe('Message exceeds the attachment size limit');
    expect(trace).toMatchObject({ status_detail: 'Attachment byte limit exceeded' });
  });

  it.each(['setup.exe', 'SETUP.EXE', 'invoice.pdf.js', 'Run.Ps1'])('refuses a blocked attachment type (%j) without echoing the name', async (name) => {
    const { reason, trace } = await refuse(withAttachments([{ name: 'notes.txt', content: 'fine' }, { name, content: 'MZ' }]));
    expect(reason).toBe('Attachment type not allowed');
    expect(trace).toMatchObject({ status_detail: 'Blocked attachment type' });
  });

  const addresses = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}@partner.example`).join(', ');

  it('refuses more than 100 To, Cc and Reply-To addresses combined', async () => {
    const raw = mail({ headers: [`Cc: ${addresses(41, 'cc')}`] }).replace('To: mailbox@example.test', `To: ${addresses(60, 'to')}`);
    const { reason, trace } = await refuse(raw);
    expect(reason).toBe('Message exceeds the recipient metadata limit');
    expect(trace).toMatchObject({ status_detail: 'Recipient metadata limit exceeded' });
  });

  it('keeps the first 100 addresses of a single over-long list rather than refusing', async () => {
    // normalizeParticipants caps each list at 100, so one list alone never trips the combined limit.
    const db = deliveryDatabase();
    const { storage } = memoryStorage();
    const raw = mail().replace('To: mailbox@example.test', `To: ${addresses(150, 'to')}`);
    const { error, message } = await deliverInbound(worker, raw, { DB: db.database, STORAGE: storage, ...GUARDS_OFF });
    expect(error).toBeNull();
    expect(message.setReject).not.toHaveBeenCalled();
    expect(JSON.parse(String(insertedRow(db.batched, 'messages').to_addresses))).toHaveLength(100);
  });

  it('accepts the same message shapes inside the limits (control)', async () => {
    const db = deliveryDatabase();
    const { storage } = memoryStorage();
    const raw = withAttachments([{ name: 'notes.txt', content: 'fine' }]);
    const { error, message } = await deliverInbound(worker, raw, { DB: db.database, STORAGE: storage, ...GUARDS_OFF, MAX_ATTACHMENTS_PER_MESSAGE: '1' });
    expect(error).toBeNull();
    expect(message.setReject).not.toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledTimes(2);
  });
});

describe('inbound protection outcomes at delivery', () => {
  const PROTECTED = { ...GUARDS_OFF, INBOUND_MAILBOX_MESSAGES_PER_HOUR: '100' };

  async function deliverWith(hooks: Parameters<typeof deliveryDatabase>[0]) {
    const db = deliveryDatabase(hooks);
    const { storage } = memoryStorage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { error, message } = await deliverInbound(worker, mail(), { DB: db.database, STORAGE: storage, ...PROTECTED });
      return { error, message, storage, warnings: warn.mock.calls.map((call) => call[0]), db };
    } finally {
      warn.mockRestore();
    }
  }
  const refusedWrite = (query: string) => (query.includes('INSERT OR IGNORE INTO mailbox_reservations') ? { meta: { changes: 0 } } : undefined);

  it('refuses generically when a configured limit is reached', async () => {
    const result = await deliverWith({ run: refusedWrite });
    expect(result.error).toBeNull();
    expect(result.message.setReject).toHaveBeenCalledWith('Message cannot be accepted at this time');
    expect(result.warnings).toEqual(['Inbound delivery rejected by configured protection policy']);
    expect(result.storage.put).not.toHaveBeenCalled();
    expect(result.db.statements.some((statement) => statement.query.includes('INSERT INTO mail_trace'))).toBe(false);
  });

  it('refuses generically, and says the protection was unavailable, when the check cannot run', async () => {
    const result = await deliverWith({
      run: refusedWrite,
      first: (query) => {
        if (query.includes('FROM mailbox_reservations')) throw new Error('D1_ERROR: network connection lost');
        return undefined;
      },
    });
    expect(result.message.setReject).toHaveBeenCalledWith('Message cannot be accepted at this time');
    expect(result.warnings).toEqual(['Inbound protection unavailable; delivery failed closed']);
    expect(result.storage.put).not.toHaveBeenCalled();
    expect(result.db.statements.some((statement) => statement.query.includes('INSERT INTO mail_trace'))).toBe(false);
  });

  it('drops a concurrent duplicate quietly: no refusal, nothing stored, no trace', async () => {
    const result = await deliverWith({
      run: refusedWrite,
      first: (query) => (query.includes('FROM mailbox_reservations') ? { id: 'earlier-delivery', delivery_key: 'held' } : undefined),
    });
    expect(result.error).toBeNull();
    expect(result.message.setReject).not.toHaveBeenCalled();
    expect(result.storage.put).not.toHaveBeenCalled();
    expect(result.db.statements.some((statement) => statement.query.includes('INSERT INTO mail_trace'))).toBe(false);
  });
});
