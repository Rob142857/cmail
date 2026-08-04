import { describe, expect, it } from 'vitest';
import { resolveInlineImages, safeInlineImageOrigin } from './inline-images';

describe('inline MIME images', () => {
  it('resolves only matching safe inline image attachments', () => {
    const result = resolveInlineImages(
      '<p><img src="cid:Logo%40example.test"><img src="cid:missing@example.test"></p>',
      [{
        id: 'attachment-1',
        content_id: 'logo@example.test',
        content_type: 'image/png',
        disposition: 'inline',
      }],
      'https://mail.example.test',
    );
    expect(result.resolved).toBe(1);
    expect(result.resolvedAttachmentIds).toEqual(['attachment-1']);
    expect(result.imageOrigin).toBe('https://mail.example.test');
    expect(result.html).toContain('https://mail.example.test/api/attachment/attachment-1?inline=1');
    expect(result.html).not.toContain('cid:');
  });

  it('does not inline SVG, ordinary attachments, or untrusted origins', () => {
    expect(resolveInlineImages(
      '<img src="cid:logo@example.test">',
      [{ id: 'one', content_id: 'logo@example.test', content_type: 'image/svg+xml', disposition: 'inline' }],
      'https://mail.example.test',
    ).html).toBe('<img>');
    expect(resolveInlineImages(
      '<img src="cid:logo@example.test">',
      [{ id: 'one', content_id: 'logo@example.test', content_type: 'image/png', disposition: 'attachment' }],
      'https://mail.example.test',
    ).html).toBe('<img>');
    expect(safeInlineImageOrigin('http://attacker.example')).toBe('');
    expect(safeInlineImageOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('uses exact Content-ID case and does not guess across an ambiguous folded match', () => {
    const attachments = [
      { id: 'upper', content_id: 'Logo@example.test', content_type: 'image/png', disposition: 'inline' as const },
      { id: 'lower', content_id: 'logo@example.test', content_type: 'image/png', disposition: 'inline' as const },
    ];
    expect(resolveInlineImages('<img src="cid:Logo@example.test">', attachments, 'https://mail.example.test').html)
      .toContain('/upper?inline=1');
    expect(resolveInlineImages('<img src="cid:LOGO@example.test">', attachments, 'https://mail.example.test').html)
      .toBe('<img>');
  });
});
