import { describe, expect, it, vi } from 'vitest';
import { checkSourceUpdates, parseRepository, procedureUrl } from './source-updates';

const build = { revision: 'a'.repeat(40), modified: false, version: '0.1.0' };
const head = 'b'.repeat(40);
const repository = 'https://github.com/example/mail';
const advert = (sha: string) =>
  `001e# service=git-upload-pack\n0000015b${'c'.repeat(40)} HEAD\0multi_ack symref=HEAD:refs/heads/main\n003f${sha} refs/heads/main\n0044${'d'.repeat(40)} refs/heads/main-old\n0000`;

/** Route by host so each upstream source can succeed or fail independently. */
function upstream({ refs = advert(head), refsStatus = 200, compare = { status: 'ahead', ahead_by: 3 } as unknown, compareStatus = 200, version = '0.2.0' as unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://github.com/')) return new Response(refs, { status: refsStatus });
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify(compare), { status: compareStatus });
    if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(JSON.stringify({ version }));
    throw new Error(`unexpected ${url}`);
  });
}

describe('source update checks', () => {
  it('reports an available update with version, commit count and a trusted review link', async () => {
    const fetcher = upstream();
    const result = await checkSourceUpdates(build, repository, fetcher);
    expect(result).toMatchObject({
      status: 'available', ahead: 3, latest: { revision: head, version: '0.2.0' },
      changesUrl: `${repository}/compare/${build.revision}...${head}`,
      procedureUrl: `${repository}/blob/main/docs/deployment.md#updating-an-existing-instance`,
    });
    expect(result.checkedAt).toBeTruthy();
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('https://github.com/example/mail.git/info/refs?service=git-upload-pack');
    expect(urls).toContain(`https://api.github.com/repos/example/mail/compare/${build.revision}...main?per_page=1`);
    expect(urls).toContain(`https://raw.githubusercontent.com/example/mail/${head}/package.json`);
  });

  it('is up to date when upstream main is this build, without calling the rate-limited API', async () => {
    const fetcher = upstream({ refs: advert(build.revision) });
    expect(await checkSourceUpdates(build, repository, fetcher)).toMatchObject({ status: 'current', ahead: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('still reports an update when the GitHub REST API is rate limited (the Cloudflare egress case)', async () => {
    const result = await checkSourceUpdates(build, repository, upstream({ compare: { message: 'API rate limit exceeded' }, compareStatus: 403 }));
    expect(result).toMatchObject({ status: 'available', ahead: null, latest: { revision: head, version: '0.2.0' } });
  });

  it.each([['behind'], ['diverged']])('marks %s builds as custom', async (status) => {
    expect((await checkSourceUpdates(build, repository, upstream({ compare: { status, ahead_by: 0 } }))).status).toBe('custom');
  });

  it('ignores untrusted version strings', async () => {
    const result = await checkSourceUpdates(build, repository, upstream({ version: '<img src=x>' }));
    expect(result.latest?.version).toBeNull();
  });

  it('does not contact upstream for modified or unidentified builds', async () => {
    const fetcher = upstream();
    expect((await checkSourceUpdates({ ...build, modified: true }, repository, fetcher)).status).toBe('custom');
    expect(await checkSourceUpdates({ ...build, revision: 'unknown' }, repository, fetcher)).toMatchObject({ status: 'unknown', reason: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['https://127.0.0.1/private', 'https://github.com.evil.test/a/b', 'https://github.com/a/b?x=1', 'https://github.com/a/b/../../c', 'https://github.com/../b', 'http://github.com/a/b'])('rejects unexpected repository URLs: %s', async (url) => {
    const fetcher = upstream();
    expect((await checkSourceUpdates(build, url, fetcher)).status).toBe('unknown');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('degrades to unknown with a reason when the repository itself is unreachable', async () => {
    for (const fetcher of [upstream({ refsStatus: 404 }), upstream({ refs: 'garbage' }), vi.fn().mockRejectedValue(new Error('offline'))]) {
      expect(await checkSourceUpdates(build, repository, fetcher)).toMatchObject({ status: 'unknown', checkedAt: null, reason: expect.any(String) });
    }
  });

  it('accepts .git and trailing-slash repository URLs and falls back to the public procedure', () => {
    expect(parseRepository('https://github.com/example/mail.git')).toBe('example/mail');
    expect(parseRepository('https://github.com/example/mail/')).toBe('example/mail');
    expect(procedureUrl('not a url')).toBe('https://github.com/Rob142857/cmail/blob/main/docs/deployment.md#updating-an-existing-instance');
  });
});
