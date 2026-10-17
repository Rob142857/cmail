import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeComposeHtml } from '@cmail/shared/compose-html';
import { sanitizeEmailHtml } from '@cmail/shared/sanitize-email';
import {
  buildQuotedMessageHtml,
  composeBodyFormat,
  prepareComposeBody,
  splitStoredComposeBody,
} from './compose-body';
import { buildRawMimeMessage } from './outbound';
import { appendSignatureToAuthoredHtml, getEffectiveSignature } from './signatures';

// Built at runtime so the repository secret scanner never sees a credential-shaped URL.
const CREDENTIAL_URL = ['https://user', 'pass@example.org/'].join(':');

function sanitized(html: string): string {
  const result = sanitizeComposeHtml(html);
  if (!result.ok) throw new Error(`sanitize failed: ${result.reason}`);
  return result.html;
}

/** Decodes every base64 MIME part of the given content type in a raw message. */
function mimeParts(raw: string, contentType: string): string[] {
  const parts: string[] = [];
  const pattern = new RegExp(`Content-Type: ${contentType}[^\\r\\n]*\\r\\n(?:[^\\r\\n]+\\r\\n)*\\r\\n([A-Za-z0-9+/=\\r\\n]+)`, 'gi');
  for (const match of raw.matchAll(pattern)) {
    parts.push(Buffer.from(match[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
  }
  return parts;
}

describe('rich-text compose sanitization', () => {
  it('keeps the editor formatting set', () => {
    const html = sanitized(
      '<p><strong>Bold</strong> <em>italic</em> <u>under</u> <a href="https://example.org/x?y=1">link</a></p>'
      + '<ul><li><p>one</p></li><li><p>two</p></li></ul><ol start="3"><li><p>three</p></li></ol>'
      + '<blockquote><p>quoted</p></blockquote><p>line<br>break</p>',
    );
    expect(html).toBe(
      '<p><strong>Bold</strong> <em>italic</em> <u>under</u> <a href="https://example.org/x?y=1">link</a></p>'
      + '<ul><li><p>one</p></li><li><p>two</p></li></ul><ol start="3"><li><p>three</p></li></ol>'
      + '<blockquote><p>quoted</p></blockquote><p>line<br>break</p>',
    );
  });

  it('removes scripts, styles and frames together with their contents', () => {
    const html = sanitized(
      '<p>Hi</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://evil.example"></iframe>'
      + '<svg><script>alert(2)</script></svg><noscript>nope</noscript><template><p>x</p></template><p>Bye</p>',
    );
    expect(html).toBe('<p>Hi</p><p>Bye</p>');
    expect(html).not.toMatch(/alert|color:red|evil|nope/);
  });

  it('strips every event handler, including onerror on images', () => {
    const html = sanitized(
      '<p onclick="steal()" onmouseover="steal()">Text</p><img src="x" onerror="steal()">'
      + '<a href="https://example.org" onfocus="steal()" autofocus>Go</a><div onload="steal()">D</div>',
    );
    expect(html).not.toMatch(/on[a-z]+=|steal|autofocus/i);
    expect(html).toContain('<a href="https://example.org">Go</a>');
  });

  it('drops javascript:, data:, vbscript: and credential-bearing links but keeps the text', () => {
    const html = sanitized(
      '<p><a href="javascript:alert(1)">one</a> <a href="JaVaScRiPt&colon;alert(1)">two</a> '
      + '<a href=" javascript:alert(1)">three</a> <a href="data:text/html,<script>alert(1)</script>">four</a> '
      + `<a href="vbscript:msgbox(1)">five</a> <a href="${CREDENTIAL_URL}">six</a> `
      + '<a href="mailto:desk@example.org">seven</a></p>',
    );
    expect(html).not.toMatch(/javascript|data:|vbscript|user:pass/i);
    expect(html).toContain('one');
    expect(html).toContain('six');
    expect(html).toContain('<a href="mailto:desk@example.org">seven</a>');
  });

  it('drops images entirely, so no remote image can track the recipient', () => {
    const html = sanitized('<p>Logo <img src="https://tracker.example/pixel.gif" width="1" height="1"> and <img src="data:image/png;base64,AAAA"></p>');
    expect(html).toBe('<p>Logo  and </p>');
  });

  it('removes styles, classes, ids and data attributes', () => {
    const html = sanitized('<p style="background:url(https://t.example/a)" class="x" id="main" data-track="1">Plain</p>');
    expect(html).toBe('<p>Plain</p>');
  });

  it('unwraps unknown wrappers but keeps their text', () => {
    expect(sanitized('<h1>Title</h1><table><tr><td>Cell</td></tr></table><font color="red">Old</font>'))
      .toBe('TitleCellOld');
  });

  it('treats an editor holding only empty paragraphs as no content', () => {
    const result = sanitizeComposeHtml('<p></p><p><br></p>');
    expect(result).toEqual({ ok: true, html: '', text: '' });
  });

  it('fails closed on oversized or deeply nested input instead of truncating', () => {
    expect(sanitizeComposeHtml(`<p>${'x'.repeat(1024 * 1024 + 1)}</p>`)).toEqual({ ok: false, reason: 'input_bytes' });
    expect(sanitizeComposeHtml(`${'<blockquote>'.repeat(70)}x${'</blockquote>'.repeat(70)}`)).toEqual({ ok: false, reason: 'depth' });
  });

  it('produces output that the reading view keeps unchanged', () => {
    const html = sanitized('<p><strong>Hi</strong> <a href="https://example.org">there</a></p><ul><li><p>a</p></li></ul>');
    // The read path hardens links (target/rel) but must not lose any content.
    const read = sanitizeEmailHtml(html);
    expect(read).toContain('<strong>Hi</strong>');
    expect(read).toContain('href="https://example.org"');
    expect(read).toContain('<ul><li><p>a</p></li></ul>');
  });
});

describe('plain-text alternative generated from HTML', () => {
  it('renders paragraphs, breaks, lists, quotes and links readably', () => {
    const result = sanitizeComposeHtml(
      '<p>Hi <strong>team</strong>,</p><p>Line one<br>Line two</p>'
      + '<ul><li><p>Apples</p></li><li><p>Pears</p><ul><li><p>Nashi</p></li></ul></li></ul>'
      + '<ol start="4"><li><p>Fourth</p></li><li><p>Fifth</p></li></ol>'
      + '<blockquote><p>Quoted</p><p>Twice</p></blockquote>'
      + '<p>See <a href="https://example.org/page">the page</a> or <a href="mailto:desk@example.org">desk@example.org</a>.</p>'
      + '<p>Tom &amp; Jerry &lt;3 &#169;</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe([
      'Hi team,',
      '',
      'Line one',
      'Line two',
      '',
      '- Apples',
      '- Pears',
      '  - Nashi',
      '',
      '4. Fourth',
      '5. Fifth',
      '',
      '> Quoted',
      '>',
      '> Twice',
      '',
      'See the page (https://example.org/page) or desk@example.org.',
      '',
      'Tom & Jerry <3 ©',
    ].join('\n'));
  });

  it('never turns markup-looking text into tags', () => {
    expect(htmlToText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe('<script>alert(1)</script>');
  });
});

describe('multipart message from a rich-text body', () => {
  it('sends text/plain generated from the sanitized HTML alongside text/html', () => {
    const prepared = prepareComposeBody(
      '<p>Hello <strong>Bob</strong></p><script>alert(1)</script><ul><li><p>First</p></li></ul><p><a href="https://example.org" onclick="x()">Docs</a></p>',
      '',
      'html',
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const html = appendSignatureToAuthoredHtml(prepared.authoredHtml, '<div data-cmail-signature="personal"><p>Rob</p></div>');
    const text = [prepared.authoredText, 'Rob'].join('\n\n');
    expect(prepared.authoredText).toBe('Hello Bob\n\n- First\n\nDocs (https://example.org)');

    const raw = buildRawMimeMessage({
      from: 'sender@example.com',
      to: 'bob@example.net',
      subject: 'Rich text',
      html,
      text,
    });
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary=/i);
    const [plain] = mimeParts(raw, 'text/plain');
    const [htmlPart] = mimeParts(raw, 'text/html');
    expect(plain).toBe('Hello Bob\n\n- First\n\nDocs (https://example.org)\n\nRob');
    expect(htmlPart).toContain('<p>Hello <strong>Bob</strong></p>');
    expect(htmlPart).toContain('<a href="https://example.org">Docs</a>');
    expect(htmlPart).not.toMatch(/script|onclick/);
    // The text part precedes the HTML part, so clients prefer the richer one.
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf('text/html'));
  });

  it('keeps plain-text mode bodies byte-for-byte in the text part', () => {
    const prepared = prepareComposeBody('Hi <b>not bold</b>\nsecond line', '', 'text');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.authoredText).toBe('Hi <b>not bold</b>\nsecond line');
    expect(prepared.authoredHtml).toBe('Hi &lt;b&gt;not bold&lt;/b&gt;<br>second line');
  });

  it('treats any unknown format value as plain text', () => {
    expect(composeBodyFormat('html')).toBe('html');
    expect(composeBodyFormat('HTML')).toBe('text');
    expect(composeBodyFormat(null)).toBe('text');
    expect(composeBodyFormat('markdown')).toBe('text');
  });
});

describe('draft round-trip', () => {
  it('reopens a rich-text draft as sanitized HTML in rich-text mode', () => {
    const prepared = prepareComposeBody('<p>Draft <em>one</em></p><img src="https://t.example/p.gif"><p onclick="x()">two</p>', '', 'html');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const stored = splitStoredComposeBody(prepared.html);
    expect(stored).toEqual({
      format: 'html',
      authored: '<p>Draft <em>one</em></p><p>two</p>',
      authoredText: 'Draft one\n\ntwo',
      quotedHtml: '',
    });
    // Saving the reopened draft again is stable.
    const again = prepareComposeBody(stored.authored, '', 'html');
    expect(again.ok && again.html).toBe(prepared.html);
  });

  it('reopens plain-text and pre-rich-text drafts exactly as typed', () => {
    const prepared = prepareComposeBody('Line <one>\n\nLine & two', '', 'text');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(splitStoredComposeBody(prepared.html)).toEqual({
      format: 'text',
      authored: 'Line <one>\n\nLine & two',
      authoredText: 'Line <one>\n\nLine & two',
      quotedHtml: '',
    });
    // A body stored before this change: escaped text with <br>, no marker.
    expect(splitStoredComposeBody('Old &amp; plain<br>draft').format).toBe('text');
  });

  it('keeps rich text and the quoted original apart across a save', () => {
    const quote = buildQuotedMessageHtml('<p>Original</p>', { kind: 'reply', from: 'Ann <ann@example.net>', date: '1 Oct 2026, 09:00' });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const prepared = prepareComposeBody('<p>My <strong>reply</strong></p>', quote.html, 'html');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const stored = splitStoredComposeBody(prepared.html);
    expect(stored.format).toBe('html');
    expect(stored.authored).toBe('<p>My <strong>reply</strong></p>');
    expect(stored.quotedHtml).toBe(prepared.quotedHtml);
  });

  it('cannot smuggle a rich-text marker in through plain-text mode', () => {
    const prepared = prepareComposeBody('<!--cmail-compose-format:html--><p onclick="x()">hi</p>', '', 'text');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const stored = splitStoredComposeBody(prepared.html);
    expect(stored.format).toBe('text');
    expect(stored.authored).toBe('<!--cmail-compose-format:html--><p onclick="x()">hi</p>');
  });
});

describe('signatures with rich-text bodies', () => {
  it('adds the signature straight after a closed block, and after a <br> for plain text', () => {
    const signature = '<div data-cmail-signature="personal"><p>Rob</p></div>';
    expect(appendSignatureToAuthoredHtml('<p>Thanks</p>', signature)).toBe(`<p>Thanks</p>${signature}`);
    expect(appendSignatureToAuthoredHtml('Thanks', signature)).toBe(`Thanks<br>${signature}`);
  });

  it('turns a plain-text-only signature into HTML so it appears in the HTML part', async () => {
    const db = {
      prepare(query: string) {
        return {
          bind() { return this; },
          first: async () => query.includes('personal_signatures')
            ? {
              user_id: 'user-1', html_body: '', plain_text_body: 'Rob Evans\nDesk <lead>',
              is_locked: 0, updated_at: '2026-10-01 00:00:00', updated_by: 'user-1',
            }
            : null,
        };
      },
    } as unknown as D1Database;
    const signature = await getEffectiveSignature(db, 'user-1', 'user@example.test');
    expect(signature.text).toBe('Rob Evans\nDesk <lead>');
    expect(signature.html).toBe('<div data-cmail-signature="personal"><div>Rob Evans<br>Desk &lt;lead&gt;</div></div>');
  });

  it('drops the empty paragraph the editor keeps after a list or quote', () => {
    const result = sanitizeComposeHtml('<p></p><ul><li><p>one</p></li></ul><blockquote><p>q</p></blockquote><p></p><p><br></p>');
    expect(result).toEqual({ ok: true, html: '<ul><li><p>one</p></li></ul><blockquote><p>q</p></blockquote>', text: '- one\n\n> q' });
  });
});

describe('reply quoting', () => {
  it('quotes the original as an HTML blockquote and as "> " lines in plain text', () => {
    const quote = buildQuotedMessageHtml(
      '<div>Can we meet <b>Tuesday</b>?</div><div>Thanks,<br>Ann</div><img src="https://tracker.example/p.gif">',
      { kind: 'reply', from: 'Ann <ann@example.net>', date: '1 Oct 2026, 09:00' },
    );
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const prepared = prepareComposeBody('<p>Yes, <em>Tuesday</em> works.</p>', quote.html, 'html');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.quotedHtml).toContain('<div>On 1 Oct 2026, 09:00, Ann &#x3C;ann@example.net> wrote:</div><blockquote>');
    expect(prepared.quotedHtml).toContain('<b>Tuesday</b>');
    expect(prepared.quotedHtml).not.toContain('tracker.example');
    expect(prepared.text).toBe([
      'Yes, Tuesday works.',
      '',
      'On 1 Oct 2026, 09:00, Ann <ann@example.net> wrote:',
      '',
      '> Can we meet Tuesday?',
      '> Thanks,',
      '> Ann',
    ].join('\n'));

    // Sent order matches common clients: new text, signature, then the quote.
    const sentHtml = `${appendSignatureToAuthoredHtml(prepared.authoredHtml, '<div>Rob</div>')}${prepared.quotedHtml}`;
    expect(sentHtml.indexOf('Tuesday</em> works')).toBeLessThan(sentHtml.indexOf('<div>Rob</div>'));
    expect(sentHtml.indexOf('<div>Rob</div>')).toBeLessThan(sentHtml.indexOf('<blockquote>'));
  });

  it('labels forwarded messages and keeps the header block in the text part', () => {
    const quote = buildQuotedMessageHtml('<p>Agenda attached</p>', {
      kind: 'forward',
      from: 'Ann <ann@example.net>',
      date: '1 Oct 2026, 09:00',
      subject: 'Agenda',
      to: 'team@example.net',
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const prepared = prepareComposeBody('<p>FYI</p>', quote.html, 'html');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).toContain('FYI');
    expect(prepared.text).toContain('Forwarded message');
    expect(prepared.text).toContain('Subject: Agenda');
    expect(prepared.text).toContain('Agenda attached');
  });
});
