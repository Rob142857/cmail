import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeComposeHtml } from '@cmail/shared/compose-html';
import { cleanComposePaste } from '@cmail/shared/compose-paste';
import {
  COMPOSE_FONTS,
  DEFAULT_COMPOSE_DEFAULTS,
  composeDefaultsStyle,
  filterComposeStyle,
  normaliseComposeDefaults,
  wrapWithComposeDefaults,
} from '@cmail/shared/compose-style';
import { sanitizeEmailHtml } from '@cmail/shared/sanitize-email';
import { prepareComposeBody, splitStoredComposeBody } from './compose-body';
import { getComposeDefaults, parseComposeDefaultsForm, saveComposeDefaults } from './compose-preferences';
import {
  fontNameFromFamily,
  fontSizePt,
  indentLevelFromMargin,
  indentMargin,
} from '../rich-text-format';

function clean(html: string): string {
  const result = sanitizeComposeHtml(html);
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result.html;
}

describe('compose style allowlist', () => {
  it('keeps the toolbar formatting, rebuilt in canonical form', () => {
    const html = clean([
      '<p style="text-align: center; margin-left: 80px">',
      '<span style="font-family: Georgia, \'Times New Roman\', serif; font-size: 14pt; color: rgb(192, 0, 0); background-color: #FF0">Styled</span>',
      '</p>',
    ].join(''));
    expect(html).toBe(
      '<p style="text-align: center; margin-left: 80px"><span style="font-family: Georgia, Times New Roman, serif; font-size: 14pt; color: #c00000; background-color: #ffff00">Styled</span></p>',
    );
  });

  it('maps any font from the fixed list to its stack, and drops other fonts', () => {
    expect(filterComposeStyle('span', 'font-family: "Calibri", sans-serif')).toBe('font-family: Calibri, Arial, sans-serif');
    expect(filterComposeStyle('span', 'font-family: courier new')).toBe("font-family: Courier New, Courier, monospace");
    expect(filterComposeStyle('span', 'font-family: "Comic Sans MS", cursive')).toBe('');
    expect(filterComposeStyle('span', 'font-family: x;color:red')).toBe('');
    for (const font of COMPOSE_FONTS) {
      expect(filterComposeStyle('span', `font-family: ${font.stack}`)).toBe(`font-family: ${font.stack}`);
    }
  });

  it('bounds sizes and indents and accepts only hex or rgb colours', () => {
    expect(filterComposeStyle('span', 'font-size: 11.0pt')).toBe('font-size: 11pt');
    expect(filterComposeStyle('span', 'font-size: 16px')).toBe('font-size: 16px');
    expect(filterComposeStyle('span', 'font-size: 400pt')).toBe('');
    expect(filterComposeStyle('span', 'font-size: 2px')).toBe('');
    expect(filterComposeStyle('span', 'font-size: 1em')).toBe('');
    expect(filterComposeStyle('p', 'margin-left: 36pt')).toBe('margin-left: 36pt');
    expect(filterComposeStyle('p', 'margin-left: 9999px')).toBe('');
    expect(filterComposeStyle('p', 'margin-left: -40px')).toBe('');
    expect(filterComposeStyle('span', 'color: red')).toBe('');
    expect(filterComposeStyle('span', 'color: rgb(300, 0, 0)')).toBe('');
    expect(filterComposeStyle('span', 'color: rgba(0, 0, 0, 0)')).toBe('');
    expect(filterComposeStyle('span', 'color: #12345')).toBe('');
    expect(filterComposeStyle('span', 'color: var(--x)')).toBe('');
    expect(filterComposeStyle('p', 'text-align: justify')).toBe('');
    expect(filterComposeStyle('span', 'text-decoration: underline line-through')).toBe('text-decoration: underline line-through');
    expect(filterComposeStyle('span', 'text-decoration: blink')).toBe('');
    expect(filterComposeStyle('span', 'font-weight: 700; font-style: italic')).toBe('font-weight: 700; font-style: italic');
  });

  it('allows a style only on span, p, li, blockquote and div', () => {
    expect(clean('<a href="https://example.org" style="color:#ff0000">x</a>')).toBe('<a href="https://example.org">x</a>');
    expect(clean('<ul style="color:#ff0000"><li style="color:#ff0000">x</li></ul>')).toBe('<ul><li style="color: #ff0000">x</li></ul>');
    expect(clean('<strong style="color:#ff0000">x</strong>')).toBe('<strong>x</strong>');
    expect(clean('<blockquote style="margin-left:40px"><div style="font-size:9pt">x</div></blockquote>'))
      .toBe('<blockquote style="margin-left: 40px"><div style="font-size: 9pt">x</div></blockquote>');
  });

  it('strips CSS injection: url(), expression(), position, behaviour, escapes and comments', () => {
    const attacks = [
      'background:url(https://tracker.example/p.gif)',
      'background-color:#fff;background-image:url("https://tracker.example/p.gif")',
      'color:#000;width:expression(alert(1))',
      'color:expression(alert(1))',
      'position:fixed;top:0;left:0;width:100%;height:100%',
      'behavior:url(x.htc)',
      'behaviour:url(x.htc)',
      '-moz-binding:url(x.xml#x)',
      'color:#000;font-family:\\61 ptos',
      'color:/**/red',
      'color:#ff0000;}</style><script>alert(1)</script>',
      'font-family:Aptos;@import url(x.css)',
      'color:#000 !important;background:javascript:alert(1)',
    ];
    for (const style of attacks) {
      const html = clean(`<p style="${style.replace(/"/g, '&quot;')}">text</p>`);
      expect(html, style).not.toMatch(/url|expression|position|behavio|binding|import|script|javascript/i);
    }
    expect(clean('<p style="background:url(https://tracker.example/p.gif);color:#ff0000">t</p>')).toBe('<p>t</p>');
    expect(clean('<span style="position:absolute;color:#ff0000">t</span>')).toBe('<span style="color: #ff0000">t</span>');
  });

  it('still removes scripts, handlers and javascript: links', () => {
    const html = clean([
      '<p style="color:#ff0000" onclick="alert(1)" onmouseover="alert(2)">Hi<script>alert(3)</script></p>',
      '<img src=x onerror="alert(4)">',
      '<span style="font-size:12pt" onerror="alert(5)">t</span>',
      '<a href="javascript:alert(6)" style="color:#0000ff">bad</a>',
      '<a href="JaVaScRiPt&colon;alert(7)">bad</a>',
      '<svg><script>alert(8)</script></svg>',
    ].join(''));
    expect(html).not.toMatch(/script|onerror|onclick|onmouseover|javascript|alert|<img|<svg/i);
    expect(html).toContain('<p style="color: #ff0000">Hi</p>');
    expect(html).toContain('<span style="font-size: 12pt">t</span>');
    expect(html).toContain('<a>bad</a>');
  });

  it('keeps styles through the reading sanitizer, so the Sent copy shows them', () => {
    const authored = clean('<p style="text-align: right"><span style="color: #c00000; font-size: 18pt">Big red</span></p>');
    const read = sanitizeEmailHtml(wrapWithComposeDefaults(authored, DEFAULT_COMPOSE_DEFAULTS));
    expect(read).toContain('text-align');
    expect(read).toContain('#c00000');
    expect(read).toContain('font-size');
    expect(read).toContain('Aptos');
  });

  it('still derives the text/plain part from styled HTML', () => {
    const prepared = prepareComposeBody(
      '<p style="font-size: 18pt"><span style="color: #ff0000">Hello</span> <strong>team</strong></p><ul><li><p style="margin-left: 40px">One</p></li></ul>',
      '',
      'html',
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).toBe('Hello team\n\n- One');
    expect(prepared.authoredHtml).toContain('style="color: #ff0000"');
    // A styled draft reopens with its formatting.
    const stored = splitStoredComposeBody(prepared.html);
    expect(stored.format).toBe('html');
    expect(stored.authored).toContain('font-size: 18pt');
  });

  it('plain-text mode still escapes and never takes on styles', () => {
    const prepared = prepareComposeBody('<span style="color:red">literal</span>', '', 'text');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.authoredHtml).not.toContain('<span');
    expect(prepared.text).toBe('<span style="color:red">literal</span>');
  });
});

describe('default-font wrapper', () => {
  it('starts like Outlook: Aptos 12 pt, falling back to Calibri, Arial, sans-serif, in black', () => {
    expect(DEFAULT_COMPOSE_DEFAULTS).toEqual({ fontFamily: 'Aptos', fontSizePt: 12 });
    expect(composeDefaultsStyle(DEFAULT_COMPOSE_DEFAULTS))
      .toBe('font-family: Aptos, Calibri, Arial, sans-serif; font-size: 12pt; color: #000000');
  });

  it('wraps the body in a container with the chosen font and size', () => {
    expect(wrapWithComposeDefaults('<p>Hi</p>', { fontFamily: 'Georgia', fontSizePt: 14 }))
      .toBe('<div style="font-family: Georgia, Times New Roman, serif; font-size: 14pt; color: #000000"><p>Hi</p></div>');
    expect(wrapWithComposeDefaults('', DEFAULT_COMPOSE_DEFAULTS)).toBe('');
  });

  it('never puts an unknown font or size into the wrapper', () => {
    const wrapped = wrapWithComposeDefaults('<p>x</p>', { fontFamily: 'x;background:url(y)', fontSizePt: 999 });
    expect(wrapped).toBe('<div style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 12pt; color: #000000"><p>x</p></div>');
  });

  it('wrapper output passes the compose sanitizer unchanged', () => {
    const wrapped = wrapWithComposeDefaults('<p>Hi</p>', { fontFamily: 'Times New Roman', fontSizePt: 10 });
    expect(clean(wrapped)).toBe(wrapped);
  });
});

describe('compose defaults setting', () => {
  function fakeDb(row: unknown, fail = false) {
    const writes: unknown[][] = [];
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              first: async () => {
                if (fail) throw new Error('no such table: compose_preferences');
                expect(query).toContain('FROM compose_preferences WHERE user_id = ?');
                return row;
              },
              run: async () => { writes.push([query, ...values]); return { success: true }; },
            };
          },
        };
      },
    } as unknown as D1Database;
    return { db, writes };
  }

  it('is Aptos 12 pt until the person chooses something else', async () => {
    expect(await getComposeDefaults(fakeDb(null).db, 'u1')).toEqual({ fontFamily: 'Aptos', fontSizePt: 12 });
  });

  it('returns the saved font and size', async () => {
    expect(await getComposeDefaults(fakeDb({ font_family: 'Verdana', font_size_pt: 10 }).db, 'u1'))
      .toEqual({ fontFamily: 'Verdana', fontSizePt: 10 });
  });

  it('falls back to the default for unknown stored values or before the migration', async () => {
    expect(await getComposeDefaults(fakeDb({ font_family: 'Papyrus', font_size_pt: 13 }).db, 'u1'))
      .toEqual({ fontFamily: 'Aptos', fontSizePt: 12 });
    expect(await getComposeDefaults(fakeDb(null, true).db, 'u1')).toEqual({ fontFamily: 'Aptos', fontSizePt: 12 });
  });

  it('accepts only fonts and sizes from the lists', () => {
    const form = (font: string, size: string) => {
      const data = new FormData();
      data.set('font_family', font);
      data.set('font_size_pt', size);
      return parseComposeDefaultsForm(data);
    };
    expect(form('Calibri', '11')).toEqual({ ok: true, defaults: { fontFamily: 'Calibri', fontSizePt: 11 } });
    expect(form('times new roman', '14')).toEqual({ ok: true, defaults: { fontFamily: 'Times New Roman', fontSizePt: 14 } });
    expect(form('Comic Sans MS', '12').ok).toBe(false);
    expect(form('Aptos', '13').ok).toBe(false);
    expect(form('Aptos', '12.5').ok).toBe(false);
    expect(form('Aptos', '').ok).toBe(false);
    expect(parseComposeDefaultsForm(new FormData()).ok).toBe(false);
  });

  it('saves one row per person with bound values', async () => {
    const { db, writes } = fakeDb(null);
    await saveComposeDefaults(db, 'u1', { fontFamily: 'Arial', fontSizePt: 16 });
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toContain('ON CONFLICT(user_id) DO UPDATE');
    expect(writes[0].slice(1)).toEqual(['u1', 'Arial', 16]);
  });

  it('normalises defaults defensively', () => {
    expect(normaliseComposeDefaults('ARIAL', '9')).toEqual({ fontFamily: 'Arial', fontSizePt: 9 });
    expect(normaliseComposeDefaults(undefined, undefined)).toEqual({ fontFamily: 'Aptos', fontSizePt: 12 });
  });
});

describe('paste from Word and Outlook', () => {
  const word = readFileSync(new URL('./fixtures/word-paste.html', import.meta.url), 'utf8');
  const html = cleanComposePaste(word);

  it('strips Office junk: mso- styles, classes, conditional comments, o:p, head and style blocks', () => {
    expect(html).not.toMatch(/mso-|class=|Mso|<o:p|<!--|\[if|endif|<style|@font-face|<meta|<xml|panose|lang=/i);
    expect(html).not.toContain('supportLists');
    expect(html).not.toContain('Symbol');
  });

  it('keeps bold, italic, underline, colours, sizes and fonts from the fixed list', () => {
    expect(html).toContain('<b><span style="font-size: 14pt; font-family: Aptos, Calibri, Arial, sans-serif; color: #c00000">Hall roster update</span></b>');
    expect(html).toContain('<i>new</i>');
    expect(html).toContain('<u>doors at 9 am</u>');
    expect(html).toContain('font-family: Georgia, Times New Roman, serif');
    expect(html).toContain('<span style="background-color: #ffff00">key change</span>');
  });

  it('turns Word list paragraphs into real bulleted, nested and numbered lists', () => {
    expect(html).toMatch(/<ul><li><p>Friday: set up from 5 pm<\/p><ul><li><p>Bring the urn<\/p><\/li><\/ul><\/li><li><p>Saturday: <u>doors at 9 am<\/u><\/p><\/li><\/ul>/);
    expect(html).toMatch(/<ol><li><p>Check the keys<\/p><\/li><li><p>Lock up<\/p><\/li><\/ol>/);
    // The typed bullet glyphs are gone.
    expect(html).not.toMatch(/·|>o</);
  });

  it('keeps safe links and indents, and drops unsafe links, images and dangerous styles', () => {
    expect(html).toContain('<p style="margin-left: 36pt">Details are on the <a href="https://wattle-creek.test/roster"><span style="color: #0563c1">roster page</span></a>');
    expect(html).toContain('<a>Not a link</a>');
    expect(html).not.toMatch(/onclick|javascript|<img|file:/i);
    // A style holding url() is dropped whole, alignment included.
    expect(html).toContain('<p><span style="font-size: 9pt">Wattle Creek Community Trust</span></p>');
    expect(html).not.toContain('Comic Sans');
  });

  it('is what the server would keep anyway', () => {
    expect(clean(html)).toBe(html);
  });

  it('handles Outlook on the web and plain web pages', () => {
    expect(cleanComposePaste('<div style="font-family: Calibri, sans-serif; font-size: 11pt; color: rgb(0, 0, 0);"><h2>Agenda</h2><ul><li>One</li></ul><mark>note</mark> <font face="Arial" color="red" size="4">old</font></div>'))
      .toBe('<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000"><p><strong>Agenda</strong></p><ul><li>One</li></ul><span style="background-color: #ffff00">note</span> <span style="font-family: Arial, Helvetica, sans-serif; color: #ff0000; font-size: 14pt">old</span></div>');
    expect(cleanComposePaste('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>')).toBe('<p>A B </p><p>C </p>');
    expect(cleanComposePaste('<p><img src="https://x.example/a.png"></p>')).toBe('');
    expect(cleanComposePaste('<p onclick="x()" style="color:#123456">ok</p><script>alert(1)</script>')).toBe('<p style="color: #123456">ok</p>');
  });

  it('fails closed on oversized clipboard HTML', () => {
    expect(cleanComposePaste(`<p>${'x'.repeat(1024 * 1024 + 1)}</p>`)).toBe('');
    expect(cleanComposePaste(`${'<div>'.repeat(200)}x${'</div>'.repeat(200)}`)).toBe('');
  });
});

describe('toolbar helpers', () => {
  it('reads the font menu name and pt size from stored marks', () => {
    expect(fontNameFromFamily('"Times New Roman", Times, serif')).toBe('Times New Roman');
    expect(fontNameFromFamily('Aptos, Calibri, Arial, sans-serif')).toBe('Aptos');
    expect(fontNameFromFamily('Papyrus')).toBe('');
    expect(fontSizePt('14pt')).toBe(14);
    expect(fontSizePt('16px')).toBe(12);
    expect(fontSizePt('large')).toBeNull();
  });

  it('maps indents to bounded 40px steps', () => {
    expect(indentLevelFromMargin('40px')).toBe(1);
    expect(indentLevelFromMargin('36pt')).toBe(1);
    expect(indentLevelFromMargin('72pt')).toBe(2);
    expect(indentLevelFromMargin('9999px')).toBe(8);
    expect(indentLevelFromMargin('')).toBe(0);
    expect(indentMargin(0)).toBeNull();
    expect(indentMargin(3)).toBe('120px');
    expect(indentMargin(20)).toBe('320px');
  });
});
