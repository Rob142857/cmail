import { describe, expect, it } from 'vitest';
import { assessLinkRisk, displayedHost, registrableDomain } from '@cmail/shared/link-risk';
import { sanitizeEmailHtmlWithLinkGuard } from '$lib/server/sanitize-email';

const WARN = 'https://mail.example.com/link';

describe('registrableDomain', () => {
  it('collapses subdomains', () => {
    expect(registrableDomain('click.tracking.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('keeps compound public suffixes whole', () => {
    expect(registrableDomain('mail.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('shop.example.com.au')).toBe('example.com.au');
  });

  it('is case and trailing-dot insensitive', () => {
    expect(registrableDomain('WWW.Example.COM.')).toBe('example.com');
  });
});

describe('displayedHost', () => {
  it('extracts a host from URL-like anchor text', () => {
    expect(displayedHost('paypal.com')).toBe('paypal.com');
    expect(displayedHost('https://paypal.com/account')).toBe('paypal.com');
    expect(displayedHost('  www.paypal.com/x?y=1 ')).toBe('www.paypal.com');
  });

  it('ignores prose, which makes no claim about a destination', () => {
    expect(displayedHost('Click here')).toBe('');
    expect(displayedHost('View your invoice')).toBe('');
    expect(displayedHost('Reset password now')).toBe('');
    expect(displayedHost('')).toBe('');
  });
});

describe('assessLinkRisk', () => {
  it('flags anchor text that names a different domain', () => {
    const result = assessLinkRisk('https://evil.example.ru/login', 'paypal.com');
    expect(result.risk).toBe('mismatch');
    expect(result.host).toBe('evil.example.ru');
  });

  it('does not flag ordinary link tracking under the same registrable domain', () => {
    expect(assessLinkRisk('https://click.paypal.com/x', 'paypal.com').risk).toBeNull();
    expect(assessLinkRisk('https://www.paypal.com/x', 'paypal.com').risk).toBeNull();
  });

  it('does not flag descriptive anchor text', () => {
    expect(assessLinkRisk('https://anything.example/x', 'Click here').risk).toBeNull();
  });

  it('flags punycode hosts regardless of anchor text', () => {
    const result = assessLinkRisk('https://xn--pypal-4ve.com/', 'Click here');
    expect(result.risk).toBe('punycode');
    expect(result.host).toBe('xn--pypal-4ve.com');
  });

  it('ignores non-web schemes and malformed hrefs', () => {
    expect(assessLinkRisk('mailto:someone@example.com', 'example.org').risk).toBeNull();
    expect(assessLinkRisk('not a url', 'example.com').risk).toBeNull();
    expect(assessLinkRisk('', 'example.com').risk).toBeNull();
  });
});

describe('sanitizeEmailHtmlWithLinkGuard', () => {
  it('routes a disguised link through the warning page and reports it', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<p><a href="https://evil.example.ru/login">paypal.com</a></p>',
      WARN,
    );
    expect(result.riskyLinks).toHaveLength(1);
    expect(result.riskyLinks[0]).toMatchObject({ risk: 'mismatch', host: 'evil.example.ru' });
    expect(result.html).toContain('data-cmail-link-risk="mismatch"');
    expect(result.html).toContain('mail.example.com/link');
    expect(result.html).toContain(encodeURIComponent('https://evil.example.ru/login'));
  });

  it('leaves ordinary links untouched', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<p><a href="https://example.com/news">Read the update</a></p>',
      WARN,
    );
    expect(result.riskyLinks).toHaveLength(0);
    expect(result.html).toContain('href="https://example.com/news"');
    expect(result.html).not.toContain('data-cmail-link-risk');
  });

  it('keeps the hardening that applies to every link', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<a href="https://example.com/">x</a>',
      WARN,
    );
    expect(result.html).toContain('rel="noopener noreferrer nofollow"');
    expect(result.html).toContain('target="_blank"');
  });

  it('ignores a risk annotation forged by the sender', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<a href="https://example.com/" data-cmail-link-risk="mismatch" data-cmail-link-host="bank.example">safe</a>',
      WARN,
    );
    expect(result.riskyLinks).toHaveLength(0);
    expect(result.html).not.toContain('data-cmail-link-risk');
    expect(result.html).not.toContain('bank.example');
  });

  it('reads anchor text through nested markup', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<a href="https://evil.example.ru/"><b>pay</b><span>pal.com</span></a>',
      WARN,
    );
    expect(result.riskyLinks[0]?.risk).toBe('mismatch');
  });

  it('does not treat an image-only link as a mismatch', () => {
    const result = sanitizeEmailHtmlWithLinkGuard(
      '<a href="https://tracking.example/x"><img src="https://cdn.example/a.png" alt="bank.example"></a>',
      WARN,
    );
    expect(result.riskyLinks).toHaveLength(0);
  });
});
