import { describe, expect, it, vi } from 'vitest';
import { checkSourceUpdates } from './source-updates';

const build = { revision: 'a'.repeat(40), modified: false };
const repository = 'https://github.com/example/mail';
const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('source update checks', () => {
  it('reports newer ancestry and constructs a trusted review link', async () => {
    const fetcher = reply({ status: 'ahead', ahead_by: 3, html_url: 'https://untrusted.example' });
    const result = await checkSourceUpdates(build, repository, fetcher);
    expect(result).toMatchObject({ status: 'available', ahead: 3, changesUrl: `${repository}/compare/${build.revision}...main` });
    expect(result.checkedAt).toBeTruthy();
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.github.com/repos/example/mail/compare/${build.revision}...main?per_page=1`);
  });

  it.each([
    ['identical', 'current'], ['behind', 'custom'], ['diverged', 'custom'],
  ])('classifies %s history as %s', async (status, expected) => {
    expect((await checkSourceUpdates(build, repository, reply({ status, ahead_by: 0 }))).status).toBe(expected);
  });

  it('does not compare modified or unknown builds', async () => {
    const fetcher = reply({});
    expect((await checkSourceUpdates({ ...build, modified: true }, repository, fetcher)).status).toBe('custom');
    expect((await checkSourceUpdates({ ...build, revision: 'unknown' }, repository, fetcher)).status).toBe('unknown');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['https://127.0.0.1/private', 'https://github.com.evil.test/a/b', 'https://github.com/a/b?x=1', 'https://github.com/a/b/../../c'])('rejects unexpected repository URLs: %s', async (url) => {
    const fetcher = reply({});
    expect((await checkSourceUpdates(build, url, fetcher)).status).toBe('unknown');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('degrades to unknown for rate limits, missing history, malformed data, and network failures', async () => {
    for (const fetcher of [reply({}, 403), reply({}, 404), reply({ status: 'ahead' }), vi.fn().mockRejectedValue(new Error('offline'))]) {
      expect((await checkSourceUpdates(build, repository, fetcher)).status).toBe('unknown');
    }
  });
});
