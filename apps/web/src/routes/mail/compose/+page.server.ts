import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Mailbox, Message } from '@cmail/shared/types';
import { sendEmail } from '$lib/server/outbound';
import { audit, generateId, traceEmail } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Get mailboxes user can send from
  const sendableMailboxes = await env.DB.prepare(
    `SELECT m.* FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
  ).bind(locals.user.id).all<Mailbox>();

  // If replying, load original message
  const replyId = url.searchParams.get('reply');
  const forwardId = url.searchParams.get('forward');
  let replyTo: Message | null = null;
  let replyBody = '';

  const sourceId = replyId || forwardId;
  if (sourceId) {
    replyTo = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       WHERE m.id = ? AND ma.user_id = ?`,
    ).bind(sourceId, locals.user.id).first<Message>();

    if (replyTo?.body_r2_key) {
      const obj = await env.STORAGE.get(replyTo.body_r2_key);
      if (obj) replyBody = await obj.text();
    }
  }

  // Get default signature
  const signature = await env.DB.prepare(
    'SELECT html_body, plain_text_body FROM signature_templates WHERE applies_to = \'*\' LIMIT 1',
  ).first<{ html_body: string; plain_text_body: string }>();

  return {
    mailboxes: sendableMailboxes.results || [],
    replyTo,
    replyBody,
    isForward: !!forwardId,
    signature: signature?.html_body || '',
  };
};

export const actions: Actions = {
  default: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const formData = await request.formData();
    const from = formData.get('from') as string;
    const to = formData.get('to') as string;
    const cc = formData.get('cc') as string;
    const subject = formData.get('subject') as string;
    const body = formData.get('body') as string;
    const inReplyTo = formData.get('in_reply_to') as string | null;

    if (!from || !to || !subject) {
      return { error: 'From, To, and Subject are required' };
    }

    // Verify user can send from this address
    const mailbox = await env.DB.prepare(
      `SELECT m.id FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')`,
    ).bind(from, locals.user.id).first<{ id: string }>();

    if (!mailbox) return { error: 'You do not have permission to send from this address' };

    // Fetch signature
    const sig = await env.DB.prepare(
      'SELECT html_body, plain_text_body FROM signature_templates WHERE applies_to = \'*\' OR applies_to = ? ORDER BY CASE WHEN applies_to = ? THEN 0 ELSE 1 END LIMIT 1',
    ).bind(from, from).first<{ html_body: string; plain_text_body: string }>();

    const htmlWithSignature = body + (sig?.html_body || '');
    const toRecipients = to.split(',').map(e => e.trim()).filter(Boolean);
    const ccRecipients = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [];

    // Determine if internal (all recipients have mailboxes in our system)
    const allRecipients = [...toRecipients, ...ccRecipients];
    const internalCheck = await env.DB.prepare(
      `SELECT address FROM mailboxes WHERE address IN (${allRecipients.map(() => '?').join(',')})`,
    ).bind(...allRecipients).all<{ address: string }>();
    const internalAddresses = new Set((internalCheck.results || []).map(r => r.address));
    const isFullyInternal = allRecipients.every(r => internalAddresses.has(r));

    const messageId = generateId();
    const messageIdHeader = `<${messageId}@${env.MAIL_DOMAIN}>`;

    if (!isFullyInternal) {
      // Send via outbound provider
      const result = await sendEmail({
        from,
        to: toRecipients,
        cc: ccRecipients,
        subject,
        html: htmlWithSignature,
        text: body.replace(/<[^>]+>/g, ''),
        headers: inReplyTo ? { 'In-Reply-To': inReplyTo } : undefined,
      }, env as unknown as Record<string, unknown>);

      if (!result.success) {
        return { error: result.error || 'Failed to send email' };
      }

      // Trace outbound
      await traceEmail(env.DB, {
        message_id_header: messageIdHeader,
        direction: 'outbound',
        envelope_from: from,
        envelope_to: toRecipients.join(', '),
        header_from: from,
        subject: subject.slice(0, 256),
        status: 'sent',
        status_detail: `via ${result.provider}`,
      });
    }

    // Store in sender's sent folder
    const bodyKey = `messages/${mailbox.id}/${messageId}/body.html`;
    await env.STORAGE.put(bodyKey, htmlWithSignature);

    await env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, folder, is_read, received_at, created_at, in_reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, datetime('now'), datetime('now'), ?)`,
    ).bind(
      messageId, mailbox.id, messageIdHeader,
      isFullyInternal ? 'internal' : 'outbound',
      from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients),
      subject, body.replace(/<[^>]+>/g, '').slice(0, 200),
      bodyKey, inReplyTo || null,
    ).run();

    // For internal recipients, deliver to their mailboxes
    for (const recipient of allRecipients) {
      if (internalAddresses.has(recipient)) {
        const recipientMailbox = await env.DB.prepare(
          'SELECT id FROM mailboxes WHERE address = ? AND status = \'active\'',
        ).bind(recipient).first<{ id: string }>();

        if (recipientMailbox) {
          const deliveryId = generateId();
          const recipientBodyKey = `messages/${recipientMailbox.id}/${deliveryId}/body.html`;
          await env.STORAGE.put(recipientBodyKey, htmlWithSignature);

          await env.DB.prepare(
            `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, folder, is_read, received_at, created_at, in_reply_to)
             VALUES (?, ?, ?, 'internal', ?, ?, ?, ?, ?, ?, 'inbox', 0, datetime('now'), datetime('now'), ?)`,
          ).bind(
            deliveryId, recipientMailbox.id, messageIdHeader,
            from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients),
            subject, body.replace(/<[^>]+>/g, '').slice(0, 200),
            recipientBodyKey, inReplyTo || null,
          ).run();
        }
      }
    }

    throw redirect(302, '/mail?folder=sent');
  },
};
