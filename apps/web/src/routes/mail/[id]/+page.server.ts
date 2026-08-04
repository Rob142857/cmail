import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Message, Attachment } from '@cmail/shared/types';
import { sanitizeEmailHtmlWithLinkGuard, type RiskyLink } from '$lib/server/sanitize-email';
import { resolveInlineImages } from '$lib/server/inline-images';
import { replyAllAddsRecipients } from '$lib/server/reply-recipients';

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Fetch message — verify user has access via mailbox assignment
  const message = await env.DB.prepare(
    `SELECT m.*, ma.permissions AS mailbox_permissions,
            mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
     FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(params.id, locals.user.id, locals.user.id).first<Message & {
    mailbox_permissions: 'read' | 'send-as' | 'full';
    mailbox_address: string;
    mailbox_display_name: string;
  }>();

  if (!message) throw error(404, 'Message not found');

  // Fetch body from R2
  let body = '';
  let bodyUnavailable = false;
  // Link risk is assessed at render time rather than at delivery, so sharpening
  // the heuristics immediately covers mail already sitting in the mailbox.
  let riskyLinks: RiskyLink[] = [];
  if (message.body_r2_key) {
    try {
      const object = await env.STORAGE.get(message.body_r2_key);
      if (object) {
        const guarded = sanitizeEmailHtmlWithLinkGuard(
          await object.text(),
          new URL('/link', url.origin).toString(),
        );
        body = guarded.html;
        riskyLinks = guarded.riskyLinks;
      } else {
        bodyUnavailable = true;
      }
    } catch {
      // A temporary object-store failure should not hide the message metadata
      // or attachments behind a generic 500 page.
      bodyUnavailable = true;
    }
  }

  // Fetch attachments before resolving MIME cid: image references.
  const attachments = await env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?',
  ).bind(message.id).all<Attachment>();
  const allAttachments = attachments.results || [];
  const inlineImages = resolveInlineImages(body, allAttachments, url.origin);
  body = inlineImages.html;
  const resolvedInlineIds = new Set(inlineImages.resolvedAttachmentIds);
  const assignments = await env.DB.prepare(
    `SELECT mb.address FROM mailbox_assignments ma
     INNER JOIN mailboxes mb ON mb.id = ma.mailbox_id
     WHERE ma.user_id = ? AND mb.status = 'active'`,
  ).bind(locals.user.id).all<{ address: string }>();
  const assignedAddresses = (assignments.results || []).map((row) => row.address);
  const canReplyAll = replyAllAddsRecipients(message, assignedAddresses);

  return {
    message,
    body,
    bodyUnavailable,
    // Distinct hosts, so ten disguised links to one destination read as one
    // finding rather than ten. Only risk and host cross to the client; the
    // hrefs are already in the body and do not need a second copy.
    riskyLinks: [...new Map(riskyLinks.map((link) => [`${link.risk}:${link.host}`, link])).values()]
      .slice(0, 20)
      .map((link) => ({ risk: link.risk, host: link.host })),
    // Embedded images resolved in the body stay out of the download list.
    // Orphaned, unsafe, or ambiguous inline MIME parts remain downloadable so
    // message content never silently disappears.
    attachments: allAttachments.filter((attachment) => attachment.disposition !== 'inline' || !resolvedInlineIds.has(attachment.id)),
    inlineImageOrigin: inlineImages.imageOrigin,
    canReplyAll,
    returnFolder: ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'].includes(url.searchParams.get('folder') || '')
      ? url.searchParams.get('folder') || ''
      : message.folder === 'inbox' ? '' : message.folder,
    returnMailbox: url.searchParams.get('mailbox') || '',
    returnSearch: (url.searchParams.get('q') || '').slice(0, 200),
    returnPage: Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)),
  };
};
