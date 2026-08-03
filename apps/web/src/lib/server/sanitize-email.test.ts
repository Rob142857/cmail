import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitize-email';

describe('email HTML sanitization', () => {
  it('removes executable, navigational, form, and embedded content', () => {
    const result = sanitizeEmailHtml(`
      <script>alert(1)</script>
      <style>@import url(https://tracker.example/style.css)</style>
      <meta http-equiv="refresh" content="0;url=https://phish.example">
      <form action="https://phish.example"><input name="password"></form>
      <iframe src="https://phish.example"></iframe>
      <svg onload="alert(1)"><a href="https://phish.example">svg</a></svg>
      <p onclick="alert(1)">Safe copy</p>
    `);
    expect(result).toContain('<p>Safe copy</p>');
    expect(result).not.toMatch(/<(?:script|style|meta|form|input|iframe|svg)\b|onload|onclick/i);
  });

  it('normalises safe links and rejects dangerous URL schemes', () => {
    const result = sanitizeEmailHtml(`
      <a href="https://example.com/path" target="_self">Example</a>
      <a href="javascript:alert(1)">Bad</a>
      <a href="//tracker.example/path">Protocol relative</a>
    `);
    expect(result).toContain('href="https://example.com/path"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer nofollow"');
    expect(result).not.toMatch(/javascript:|\/\/tracker\.example/i);
  });

  it('keeps useful email presentation while removing CSS network primitives', () => {
    const result = sanitizeEmailHtml(`
      <table style="border-collapse:collapse"><tr><td style="color:#123456;background-image:url(https://tracker.example/pixel)">Hello</td></tr></table>
      <img src="https://images.example/logo.png" onerror="alert(1)" alt="Logo">
    `);
    expect(result).toContain('border-collapse:collapse');
    expect(result).toContain('color:#123456');
    expect(result).not.toContain('background-image');
    expect(result).not.toContain('onerror');
    // The sandboxed viewer blocks this URL by default and preserves it only
    // for the user's explicit "Load images" action.
    expect(result).toContain('src="https://images.example/logo.png"');
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('referrerpolicy="no-referrer"');
  });
});
