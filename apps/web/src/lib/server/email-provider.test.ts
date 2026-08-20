import { describe, expect, it, vi } from 'vitest';
import { classifyEmailDomain, detectEmailProvider } from './email-provider';

function dohResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('classifyEmailDomain', () => {
  it.each([
    ['gmail.com', 'google'],
    ['googlemail.com', 'google'],
    ['hotmail.com', 'microsoft'],
    ['hotmail.co.uk', 'microsoft'],
    ['live.com.au', 'microsoft'],
    ['outlook.com', 'microsoft'],
    ['outlook.fr', 'microsoft'],
    ['msn.com', 'microsoft'],
    ['outlook.example.com', null],
    ['yahoo.com', null],
  ] as const)('classifies %s as %s', (domain, expected) => {
    expect(classifyEmailDomain(domain)).toBe(expected);
  });
});

describe('detectEmailProvider', () => {
  it('resolves well-known consumer domains without a network call', async () => {
    const fetcher = vi.fn();
    await expect(detectEmailProvider('person@gmail.com', fetcher)).resolves.toBe('google');
    await expect(detectEmailProvider('person@hotmail.com', fetcher)).resolves.toBe('microsoft');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('detects Google Workspace via an MX host under google.com', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({
      Status: 0,
      Answer: [{ data: '1 aspmx.l.google.com.' }, { data: '5 alt1.aspmx.l.google.com.' }],
    }));

    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('google');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloudflare-dns.com/dns-query?name=example.com&type=MX');
    expect((init.headers as Record<string, string>).accept).toBe('application/dns-json');
  });

  it('detects Microsoft 365 via an MX host under mail.protection.outlook.com', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({
      Status: 0,
      Answer: [{ data: '0 example-com.mail.protection.outlook.com.' }],
    }));

    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('microsoft');
  });

  it('returns unknown when MX hosts match neither provider', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({
      Status: 0,
      Answer: [{ data: '1 mx.yahoo.com.' }],
    }));

    await expect(detectEmailProvider('person@yahoo.com', fetcher)).resolves.toBe('unknown');
  });

  it('returns unknown when there are no MX answers', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({ Status: 0, Answer: [] }));
    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('unknown');

    const fetcherNoAnswerField = vi.fn().mockResolvedValue(dohResponse({ Status: 0 }));
    await expect(detectEmailProvider('person@example.com', fetcherNoAnswerField)).resolves.toBe('unknown');
  });

  it('returns unknown on NXDOMAIN (DNS Status 3)', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({ Status: 3 }));
    await expect(detectEmailProvider('person@does-not-exist.invalid', fetcher)).resolves.toBe('unknown');
  });

  it('returns unverifiable when fetch throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('unverifiable');
  });

  it('returns unverifiable on a non-2xx HTTP response', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({ Status: 0 }, 500));
    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('unverifiable');
  });

  it('returns unverifiable on an unexpected DNS status', async () => {
    const fetcher = vi.fn().mockResolvedValue(dohResponse({ Status: 2 }));
    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('unverifiable');
  });

  it('returns unverifiable when the response body is not valid JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(detectEmailProvider('person@example.com', fetcher)).resolves.toBe('unverifiable');
  });

  it('defaults the fetcher to globalThis.fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(dohResponse({ Status: 0, Answer: [] }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(detectEmailProvider('person@example.com')).resolves.toBe('unknown');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
