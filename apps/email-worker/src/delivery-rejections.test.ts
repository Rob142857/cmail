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
  it('refuses an invalid envelope address without writing a trace', async () => {
    const { reason, trace } = await refuse(mail(), {}, { to: 'not an address' });
    expect(reason).toBe('Invalid envelope address');
    expect(trace).toBeNull();
  });

  it('refuses a message larger than the configured limit', async () => {
    const { reason, trace } = await refuse(mail(), { MAX_INBOUND_BYTES: '4096' }, { rawSize: 4097 });
    expect(reason).toBe('Message exceeds the configured size limit');
    expect(trace).toBeNull();
  });

  it('refuses an unknown or inactive recipient with the neutral response', async () => {
    const { reason, trace } = await refuse(mail(), {}, {}, false);
    expect(reason).toBe(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
    expect(trace).toBeNull();
  });

  it('refuses a Message-ID over 998 characters', async () => {
    const longId = `<${'a'.repeat(990)}@partner.example>`;
    const { reason } = await refuse(mail().replace('<check-1@partner.example>', longId));
    expect(reason).toBe('Message metadata exceeds the configured limit');
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

  it.each(['setup.exe', 'SETUP.EXE', 'invoice.pdf.js', 'run.ps1 '])('refuses a blocked attachment type (%j) without echoing the name', async (name) => {
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
