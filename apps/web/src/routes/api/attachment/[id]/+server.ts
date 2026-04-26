import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SAFE_CONTENT_TYPE_RX = /^[\w.+/-]+(?:;\s*[\w.+/-]+=[\w.+/"-]+)*$/;

function safeContentType(t: string | null | undefined): string {
  if (!t) return 'application/octet-stream';
  return SAFE_CONTENT_TYPE_RX.test(t) ? t : 'application/octet-stream';
}

function buildContentDisposition(filename: string): string {
  // Strip control chars + path separators that could enable header injection or
  // path traversal hints in clients.
  const sanitized = filename.replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0, 255) || 'download';
  // RFC 5987: encode unicode as filename* with UTF-8, plus an ASCII fallback.
  const ascii = sanitized.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  const encoded = encodeURIComponent(sanitized).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const GET: RequestHandler = async ({ locals, platform, params }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  // Verify user has access to this attachment via mailbox
  const att = await env.DB.prepare(
    `SELECT a.* FROM attachments a
     INNER JOIN messages m ON a.message_id = m.id
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE a.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<{
    id: string; filename: string; content_type: string; r2_key: string; size_bytes: number;
  }>();

  if (!att) throw error(404, 'Attachment not found');

  const object = await env.STORAGE.get(att.r2_key);
  if (!object) throw error(404, 'File not found');

  return new Response(object.body as ReadableStream, {
    headers: {
      'Content-Type': safeContentType(att.content_type),
      'Content-Disposition': buildContentDisposition(att.filename),
      'Content-Length': att.size_bytes.toString(),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
