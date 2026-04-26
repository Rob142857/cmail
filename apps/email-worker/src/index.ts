// cmail inbound email worker
// Receives email via Cloudflare Email Routing, parses, stores in D1/R2.
// Outbound is handled directly by the web app (Resend or Postmark) —
// this worker is inbound-only.
import PostalMime from 'postal-mime';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

// Blocked attachment extensions
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1', '.msi',
  '.com', '.pif', '.hta', '.cpl', '.reg', '.inf', '.wsf',
]);

function generateId(): string {
  return crypto.randomUUID();
}

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function extractSnippet(text: string | undefined, maxLen = 200): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function getAuthResults(headers: Headers): { spf: string | null; dkim: string | null; dmarc: string | null } {
  const authResults = headers.get('authentication-results') || '';
  const spfMatch = authResults.match(/spf=(\w+)/);
  const dkimMatch = authResults.match(/dkim=(\w+)/);
  const dmarcMatch = authResults.match(/dmarc=(\w+)/);
  return {
    spf: spfMatch ? spfMatch[1] : null,
    dkim: dkimMatch ? dkimMatch[1] : null,
    dmarc: dmarcMatch ? dmarcMatch[1] : null,
  };
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('cmail inbound email worker (no HTTP API)', { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const recipientAddress = message.to.toLowerCase();
    const senderAddress = message.from.toLowerCase();
    const messageSize = message.rawSize;

    // Look up recipient mailbox
    const mailbox = await env.DB.prepare(
      'SELECT id, status FROM mailboxes WHERE address = ? AND status = ?',
    ).bind(recipientAddress, 'active').first<{ id: string; status: string }>();

    if (!mailbox) {
      // Reject — address doesn't exist
      message.setReject('550 User not found');
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        status: 'rejected',
        status_detail: '550 User not found',
        size_bytes: messageSize,
        source_ip: message.headers.get('x-real-ip') || null,
      });
      return;
    }

    // Parse the email
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // Check auth results
    const auth = getAuthResults(message.headers);

    // Check for blocked attachments
    const blockedAttachment = parsed.attachments?.find(
      a => BLOCKED_EXTENSIONS.has(extractExtension(a.filename || '')),
    );
    if (blockedAttachment) {
      message.setReject(`550 Attachment type not allowed: ${extractExtension(blockedAttachment.filename || '')}`);
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        header_from: parsed.from?.address || senderAddress,
        subject: parsed.subject || '',
        status: 'rejected',
        status_detail: `Blocked attachment: ${blockedAttachment.filename}`,
        size_bytes: messageSize,
        spf_result: auth.spf,
        dkim_result: auth.dkim,
        dmarc_result: auth.dmarc,
        source_ip: message.headers.get('x-real-ip') || null,
      });
      return;
    }

    // Store email body in R2
    const messageId = generateId();
    const bodyKey = `messages/${mailbox.id}/${messageId}/body.html`;
    const bodyContent = parsed.html || parsed.text || '';
    await env.STORAGE.put(bodyKey, bodyContent);

    // Determine folder (basic spam check)
    let folder = 'inbox';
    if (auth.dmarc === 'fail') {
      folder = 'spam';
    }

    // Build address arrays
    const toAddresses = parsed.to?.map(a => a.address) || [recipientAddress];
    const ccAddresses = parsed.cc?.map(a => a.address) || [];

    // Thread ID from References/In-Reply-To
    const inReplyTo = parsed.headers?.find(h => h.key === 'in-reply-to')?.value || null;
    const messageIdHeader = parsed.messageId || null;

    // Insert message into D1
    await env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, is_starred, in_reply_to, thread_id, received_at, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
      messageId,
      mailbox.id,
      messageIdHeader,
      parsed.from?.address || senderAddress,
      JSON.stringify(toAddresses),
      JSON.stringify(ccAddresses),
      parsed.subject || '(no subject)',
      extractSnippet(parsed.text),
      bodyKey,
      parsed.attachments?.length ? 1 : 0,
      messageSize,
      folder,
      inReplyTo,
      inReplyTo || messageIdHeader, // simple thread grouping
    ).run();

    // Store attachments
    if (parsed.attachments?.length) {
      for (const att of parsed.attachments) {
        const attId = generateId();
        const attKey = `attachments/${messageId}/${attId}/${att.filename || 'unnamed'}`;
        await env.STORAGE.put(attKey, att.content);
        const size = typeof att.content === 'string'
          ? new TextEncoder().encode(att.content).byteLength
          : att.content.byteLength;
        await env.DB.prepare(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(attId, messageId, att.filename || 'unnamed', att.mimeType || 'application/octet-stream', size, attKey).run();
      }
    }

    // Log trace
    await logTrace(env.DB, {
      message_id_header: messageIdHeader,
      direction: 'inbound',
      envelope_from: senderAddress,
      envelope_to: recipientAddress,
      header_from: parsed.from?.address || senderAddress,
      subject: (parsed.subject || '').slice(0, 256),
      size_bytes: messageSize,
      status: folder === 'spam' ? 'quarantined' : 'delivered',
      status_detail: folder === 'spam' ? `DMARC ${auth.dmarc}` : 'OK',
      spf_result: auth.spf,
      dkim_result: auth.dkim,
      dmarc_result: auth.dmarc,
      source_ip: message.headers.get('x-real-ip') || null,
    });
  },
};

async function logTrace(db: D1Database, trace: Record<string, unknown>): Promise<void> {
  await db.prepare(
    `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
     VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(),
    (trace.message_id_header as string) ?? null,
    trace.direction as string,
    (trace.envelope_from as string) ?? null,
    (trace.envelope_to as string) ?? null,
    (trace.header_from as string) ?? null,
    (trace.subject as string) ?? null,
    (trace.size_bytes as number) ?? null,
    trace.status as string,
    (trace.status_detail as string) ?? null,
    (trace.spf_result as string) ?? null,
    (trace.dkim_result as string) ?? null,
    (trace.dmarc_result as string) ?? null,
    (trace.spam_score as number) ?? null,
    (trace.source_ip as string) ?? null,
  ).run();
}

// Type declarations for Cloudflare Email Workers
interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: unknown): Promise<void>;
}
