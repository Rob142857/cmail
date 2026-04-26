import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Mailbox, Message } from '@cmail/shared/types';
import { sendEmail, type OutboundAttachment } from '$lib/server/outbound';
import { audit, generateId, traceEmail } from '$lib/server/db';

// Same blocked-extension list as inbound worker (defense in depth on outbound).
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1', '.msi',
  '.com', '.pif', '.hta', '.cpl', '.reg', '.inf', '.wsf',
]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB total per message

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

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
  const draftId = url.searchParams.get('draft');
  let replyTo: Message | null = null;
  let replyBody = '';
  let draft: { id: string; from_address: string; to_addresses: string; cc_addresses: string; subject: string; body: string } | null = null;

  if (draftId) {
    const d = await env.DB.prepare(
      `SELECT m.* FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       WHERE m.id = ? AND ma.user_id = ? AND m.folder = 'drafts'`,
    ).bind(draftId, locals.user.id).first<Message>();
    if (d) {
      let body = '';
      if (d.body_r2_key) {
        const obj = await env.STORAGE.get(d.body_r2_key);
        if (obj) body = await obj.text();
      }
      draft = {
        id: d.id,
        from_address: d.from_address,
        to_addresses: d.to_addresses,
        cc_addresses: d.cc_addresses,
        subject: d.subject,
        body,
      };
    }
  }

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
    draft,
  };
};

export const actions: Actions = {
  send: async ({ request, locals, platform }) => {
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
    const draftId = formData.get('draft_id') as string | null;

    if (!from || !to || !subject) {
      return { error: 'From, To, and Subject are required' };
    }

    // Collect & validate attachments (multipart files)
    const rawAttachments = formData.getAll('attachments').filter((v): v is File => v instanceof File && v.size > 0);
    let totalAttachmentBytes = 0;
    const attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }> = [];
    for (const file of rawAttachments) {
      const ext = getExtension(file.name);
      if (BLOCKED_EXTENSIONS.has(ext)) {
        return { error: `Attachment type not allowed: ${ext} (${file.name})` };
      }
      totalAttachmentBytes += file.size;
      if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) {
        return { error: `Attachments exceed ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB total limit` };
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      attachments.push({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        bytes: buf,
      });
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
        attachments: attachments.map<OutboundAttachment>(a => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.bytes,
        })),
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
      `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, received_at, created_at, in_reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, datetime('now'), datetime('now'), ?)`,
    ).bind(
      messageId, mailbox.id, messageIdHeader,
      isFullyInternal ? 'internal' : 'outbound',
      from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients),
      subject, body.replace(/<[^>]+>/g, '').slice(0, 200),
      bodyKey,
      attachments.length ? 1 : 0,
      totalAttachmentBytes,
      inReplyTo || null,
    ).run();

    // Persist attachments for the sender's sent copy
    for (const a of attachments) {
      const attId = generateId();
      const attKey = `attachments/${messageId}/${attId}/${a.filename}`;
      await env.STORAGE.put(attKey, a.bytes);
      await env.DB.prepare(
        `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(attId, messageId, a.filename, a.contentType, a.bytes.byteLength, attKey).run();
    }

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
            `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, received_at, created_at, in_reply_to)
             VALUES (?, ?, ?, 'internal', ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', 0, datetime('now'), datetime('now'), ?)`,
          ).bind(
            deliveryId, recipientMailbox.id, messageIdHeader,
            from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients),
            subject, body.replace(/<[^>]+>/g, '').slice(0, 200),
            recipientBodyKey,
            attachments.length ? 1 : 0,
            totalAttachmentBytes,
            inReplyTo || null,
          ).run();

          for (const a of attachments) {
            const attId = generateId();
            const attKey = `attachments/${deliveryId}/${attId}/${a.filename}`;
            await env.STORAGE.put(attKey, a.bytes);
            await env.DB.prepare(
              `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(attId, deliveryId, a.filename, a.contentType, a.bytes.byteLength, attKey).run();
          }
        }
      }
    }

    // Clean up draft if this send originated from one
    if (draftId) {
      const draft = await env.DB.prepare(
        `SELECT m.body_r2_key FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND m.folder = 'drafts'`,
      ).bind(draftId, locals.user.id).first<{ body_r2_key: string }>();
      if (draft) {
        if (draft.body_r2_key) await env.STORAGE.delete(draft.body_r2_key);
        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(draftId).run();
      }
    }

    throw redirect(302, '/mail?folder=sent');
  },

  save: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const formData = await request.formData();
    const from = formData.get('from') as string;
    const to = (formData.get('to') as string) || '';
    const cc = (formData.get('cc') as string) || '';
    const subject = (formData.get('subject') as string) || '(no subject)';
    const body = (formData.get('body') as string) || '';
    const inReplyTo = formData.get('in_reply_to') as string | null;
    const existingDraftId = formData.get('draft_id') as string | null;

    if (!from) return { error: 'From address required to save draft' };

    // Verify user owns the mailbox they're drafting from
    const mailbox = await env.DB.prepare(
      `SELECT m.id FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full')`,
    ).bind(from, locals.user.id).first<{ id: string }>();
    if (!mailbox) return { error: 'You do not have permission to draft from this address' };

    const toRecipients = to.split(',').map(e => e.trim()).filter(Boolean);
    const ccRecipients = cc.split(',').map(e => e.trim()).filter(Boolean);
    const snippet = body.replace(/<[^>]+>/g, '').slice(0, 200);

    if (existingDraftId) {
      // Update existing
      const existing = await env.DB.prepare(
        `SELECT m.body_r2_key FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND m.folder = 'drafts'`,
      ).bind(existingDraftId, locals.user.id).first<{ body_r2_key: string }>();
      if (!existing) return { error: 'Draft not found' };

      const key = existing.body_r2_key || `messages/${mailbox.id}/${existingDraftId}/body.html`;
      await env.STORAGE.put(key, body);
      await env.DB.prepare(
        `UPDATE messages SET from_address = ?, to_addresses = ?, cc_addresses = ?, subject = ?, snippet = ?, body_r2_key = ?, in_reply_to = ?, received_at = datetime('now') WHERE id = ?`,
      ).bind(from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients), subject, snippet, key, inReplyTo || null, existingDraftId).run();
      return { savedDraftId: existingDraftId, savedAt: new Date().toISOString() };
    }

    // Create new
    const draftId = generateId();
    const messageIdHeader = `<${draftId}@${env.MAIL_DOMAIN}>`;
    const key = `messages/${mailbox.id}/${draftId}/body.html`;
    await env.STORAGE.put(key, body);
    await env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, folder, is_read, received_at, created_at, in_reply_to)
       VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, 'drafts', 1, datetime('now'), datetime('now'), ?)`,
    ).bind(
      draftId, mailbox.id, messageIdHeader,
      from, JSON.stringify(toRecipients), JSON.stringify(ccRecipients),
      subject, snippet, key, inReplyTo || null,
    ).run();

    return { savedDraftId: draftId, savedAt: new Date().toISOString() };
  },

  discard: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };
    const formData = await request.formData();
    const draftId = formData.get('draft_id') as string | null;
    if (draftId) {
      const draft = await env.DB.prepare(
        `SELECT m.body_r2_key FROM messages m
         INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
         WHERE m.id = ? AND ma.user_id = ? AND m.folder = 'drafts'`,
      ).bind(draftId, locals.user.id).first<{ body_r2_key: string }>();
      if (draft) {
        if (draft.body_r2_key) await env.STORAGE.delete(draft.body_r2_key);
        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(draftId).run();
      }
    }
    throw redirect(302, '/mail');
  },
};
