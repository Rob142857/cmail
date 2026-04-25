import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

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
      'Content-Type': att.content_type,
      'Content-Disposition': `attachment; filename="${att.filename.replace(/"/g, '\\"')}"`,
      'Content-Length': att.size_bytes.toString(),
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
