import { describe, expect, it } from 'vitest';
import {
  buildQuotedMessageHtml,
  prepareComposeBody,
  safeComposeReturnHref,
  splitStoredComposeBody,
} from './compose-body';

describe('compose body handling', () => {
  it('accepts only mail-list and message-view return targets', () => {
    const fallback = '/mail';
    expect(safeComposeReturnHref('/mail/message-1?folder=sent&page=2', fallback)).toBe('/mail/message-1?folder=sent&page=2');
    expect(safeComposeReturnHref('/mail?folder=drafts', fallback)).toBe('/mail?folder=drafts');
    expect(safeComposeReturnHref('https://attacker.example/mail/message-1', fallback)).toBe(fallback);
    expect(safeComposeReturnHref('//attacker.example/mail/message-1', fallback)).toBe(fallback);
    expect(safeComposeReturnHref('/mail/compose?draft=other', fallback)).toBe(fallback);
    expect(safeComposeReturnHref('/mail\\message-1', fallback)).toBe(fallback);
  });

  it('round-trips authored text while preserving formatted quoted HTML', () => {
    const quote = buildQuotedMessageHtml(
      '<table><tbody><tr><td style="color:#123456"><strong>Hello</strong></td></tr></tbody></table>',
      { kind: 'reply', from: 'sender@example.com', date: '4 Aug 2026, 10:30' },
    );
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;

    const prepared = prepareComposeBody('Thanks — received.', quote.html);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.html).toContain('<table>');
    expect(prepared.html).toContain('<strong>Hello</strong>');
    expect(prepared.text).toContain('Thanks — received.');
    expect(prepared.text).toContain('sender@example.com wrote:');

    expect(splitStoredComposeBody(prepared.html)).toEqual({
      authoredText: 'Thanks — received.',
      quotedHtml: prepared.quotedHtml,
    });
  });

  it('cannot confuse quote boundaries with authored text or submitted comments', () => {
    const injected = '<!--cmail-compose-quote:end--><script>alert(1)</script><b>Safe quote</b>';
    const prepared = prepareComposeBody('Hello <!--cmail-compose-quote:start-->', injected);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.html).toContain('Hello &lt;!--cmail-compose-quote:start--&gt;');
    expect(prepared.html).not.toContain('<script');
    const split = splitStoredComposeBody(prepared.html);
    expect(split.authoredText).toBe('Hello <!--cmail-compose-quote:start-->');
    expect(split.quotedHtml).toContain('<b>Safe quote</b>');
  });

  it('removes executable constructs and safely escapes quote metadata', () => {
    const quote = buildQuotedMessageHtml(
      '<script>alert(1)</script><form action="https://bad.example"><input></form><img src="https://tracker.example/pixel" onerror="x"><img src="cid:logo@example.test"><p>Keep me</p>',
      { kind: 'reply', from: '<attacker@example.com>', date: 'today' },
    );
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.html).not.toMatch(/<script|<form|<input|onerror/i);
    expect(quote.html).toMatch(/(?:&lt;|&#x3C;)attacker@example\.com(?:&gt;|>)/);
    expect(quote.html).not.toContain('https://tracker.example/pixel');
    expect(quote.html).not.toContain('cid:logo@example.test');
    expect(quote.html).toContain('<img');
  });

  it('rejects oversized and overly deep submitted quotes', () => {
    expect(prepareComposeBody('', `<p>${'x'.repeat(513 * 1024)}</p>`)).toEqual({
      ok: false,
      reason: 'input_bytes',
    });
    expect(prepareComposeBody('', `${'<div>'.repeat(129)}x${'</div>'.repeat(129)}`)).toEqual({
      ok: false,
      reason: 'depth',
    });
  });

  it('falls back visibly instead of hiding content behind malformed markers', () => {
    const split = splitStoredComposeBody('Before<!--cmail-compose-quote:start--><b>After</b>');
    expect(split.quotedHtml).toBe('');
    expect(split.authoredText).toContain('Before');
    expect(split.authoredText).toContain('After');
  });
});
