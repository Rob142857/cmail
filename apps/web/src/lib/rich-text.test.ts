import { describe, expect, it } from 'vitest';
import { normaliseLinkInput, plainTextToRichHtml, richDocToPlainText } from './rich-text';

describe('compose editor mode switch helpers', () => {
  it('turns plain text into escaped paragraphs and line breaks', () => {
    expect(plainTextToRichHtml('Hi <Bob> & co\nline two\n\n\nNext para')).toBe(
      '<p>Hi &lt;Bob&gt; &amp; co<br>line two</p><p>Next para</p>',
    );
    expect(plainTextToRichHtml('  \n ')).toBe('');
  });

  it('turns editor JSON into readable plain text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 2 },
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] },
            { type: 'text', text: ' or ' },
            { type: 'text', text: 'desk@example.org', marks: [{ type: 'link', attrs: { href: 'mailto:desk@example.org' } }] },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe([
      'Hello world',
      '',
      'a',
      'b',
      '',
      '- one',
      '- two',
      '',
      '2. second',
      '',
      '> quoted',
      '',
      'see docs (https://example.org) or desk@example.org',
    ].join('\n'));
  });

  it('accepts web and email links and refuses script-capable schemes', () => {
    expect(normaliseLinkInput('example.org/page')).toBe('https://example.org/page');
    expect(normaliseLinkInput('https://example.org')).toBe('https://example.org');
    expect(normaliseLinkInput('desk@example.org')).toBe('mailto:desk@example.org');
    expect(normaliseLinkInput('mailto:desk@example.org')).toBe('mailto:desk@example.org');
    expect(normaliseLinkInput('javascript:alert(1)')).toBeNull();
    expect(normaliseLinkInput('JAVASCRIPT:alert(1)')).toBeNull();
    expect(normaliseLinkInput('data:text/html,hi')).toBeNull();
    // Built at runtime so the repository secret scanner never sees a credential-shaped URL.
    expect(normaliseLinkInput(['https://user', 'pass@example.org'].join(':'))).toBeNull();
    expect(normaliseLinkInput('not a link')).toBeNull();
  });
});
