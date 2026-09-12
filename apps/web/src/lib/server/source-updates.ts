export interface Build { revision: string; modified: boolean }
export interface UpdateStatus {
  build: Build;
  status: 'available' | 'current' | 'custom' | 'unknown';
  ahead: number;
  checkedAt: string | null;
  changesUrl: string | null;
}

/** Compare ancestry, not dates: a fork or local change is not a normal upgrade. */
export async function checkSourceUpdates(build: Build, repository: string, fetcher: typeof fetch = fetch): Promise<UpdateStatus> {
  const result: UpdateStatus = { build, status: 'unknown', ahead: 0, checkedAt: null, changesUrl: null };
  if (build.modified) return { ...result, status: 'custom' };
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repository);
  if (!match || !/^[a-f0-9]{40}$/.test(build.revision)) return result;
  const repo = `${match[1]}/${match[2]}`;
  try {
    const response = await fetcher(`https://api.github.com/repos/${repo}/compare/${build.revision}...main?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cmail-update-check' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return result;
    const comparison = await response.json() as { status?: string; ahead_by?: number };
    if (!['ahead', 'identical', 'behind', 'diverged'].includes(comparison.status || '')) return result;
    if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by! < 0) return result;
    return {
      ...result,
      status: comparison.status === 'ahead' ? 'available' : comparison.status === 'identical' ? 'current' : 'custom',
      ahead: comparison.ahead_by!,
      checkedAt: new Date().toISOString(),
      changesUrl: `https://github.com/${repo}/compare/${build.revision}...main`,
    };
  } catch { return result; }
}
