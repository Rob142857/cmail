const SAFE_INLINE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface InlineImageAttachment {
  id: string;
  content_id: string | null;
  content_type: string;
  disposition: 'attachment' | 'inline';
}

function normalizedContentId(value: string): string {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* retain the bounded literal */ }
  const trimmed = decoded.trim().replace(/^<|>$/g, '');
  return /^[^<>\s]{1,255}$/.test(trimmed) ? trimmed : '';
}

export function safeInlineImageOrigin(value: string): string {
  try {
    const url = new URL(value);
    const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || localDevelopment ? url.origin : '';
  } catch {
    return '';
  }
}

/** Replace sanitised cid: image sources with authenticated same-origin URLs. */
export function resolveInlineImages(
  html: string,
  attachments: readonly InlineImageAttachment[],
  requestOrigin: string,
): { html: string; imageOrigin: string; resolved: number; resolvedAttachmentIds: string[] } {
  const imageOrigin = safeInlineImageOrigin(requestOrigin);
  if (!html || !imageOrigin) return { html, imageOrigin: '', resolved: 0, resolvedAttachmentIds: [] };

  const byContentId = new Map<string, InlineImageAttachment>();
  const byFoldedContentId = new Map<string, InlineImageAttachment | null>();
  for (const attachment of attachments) {
    const contentId = normalizedContentId(attachment.content_id || '');
    const contentType = attachment.content_type.split(';', 1)[0].trim().toLowerCase();
    if (
      contentId
      && attachment.disposition === 'inline'
      && SAFE_INLINE_IMAGE_TYPES.has(contentType)
      && !byContentId.has(contentId)
    ) {
      byContentId.set(contentId, attachment);
      const folded = contentId.toLowerCase();
      const existing = byFoldedContentId.get(folded);
      if (existing === undefined) byFoldedContentId.set(folded, attachment);
      else if (normalizedContentId(existing?.content_id || '') !== contentId) byFoldedContentId.set(folded, null);
    }
  }

  let resolved = 0;
  const resolvedAttachmentIds = new Set<string>();
  const output = html.replace(/\s+src="cid:([^"]+)"/gi, (_attribute, rawContentId: string) => {
    const contentId = normalizedContentId(rawContentId);
    const attachment = byContentId.get(contentId) || byFoldedContentId.get(contentId.toLowerCase());
    if (!attachment) return '';
    resolved += 1;
    resolvedAttachmentIds.add(attachment.id);
    return ` src="${imageOrigin}/api/attachment/${encodeURIComponent(attachment.id)}?inline=1"`;
  });
  return {
    html: output,
    imageOrigin: resolved ? imageOrigin : '',
    resolved,
    resolvedAttachmentIds: [...resolvedAttachmentIds],
  };
}

export function canRenderAttachmentInline(contentType: string): boolean {
  return SAFE_INLINE_IMAGE_TYPES.has(contentType.split(';', 1)[0].trim().toLowerCase());
}
