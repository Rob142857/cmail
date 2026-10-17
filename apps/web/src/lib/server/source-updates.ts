export interface Build { revision: string; modified: boolean; version?: string }
export interface UpdateStatus {
  build: Build;
  status: 'available' | 'current' | 'custom' | 'unknown' | 'disabled';
  /** Commits on upstream main that this build lacks, when GitHub's API answered. */
  ahead: number | null;
  latest: { revision: string; version: string | null } | null;
  checkedAt: string | null;
  changesUrl: string | null;
  procedureUrl: string;
  reason: string | null;
}

export const DEFAULT_REPOSITORY = 'https://github.com/Rob142857/cmail';
const BRANCH = 'main';
const PROCEDURE_PATH = `/blob/${BRANCH}/docs/deployment.md#updating-an-existing-instance`;
const TIMEOUT_MS = 5000;

/** Accept only a plain public GitHub repository URL; anything else is never fetched. */
export function parseRepository(repository: string): string | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repository.trim());
  if (!match || match[1].startsWith('.') || match[2].startsWith('.')) return null;
  return `${match[1]}/${match[2]}`;
}

export function procedureUrl(repository: string): string {
  return `https://github.com/${parseRepository(repository) || parseRepository(DEFAULT_REPOSITORY)}${PROCEDURE_PATH}`;
}

/**
 * Upstream main's head commit from Git's smart-HTTP ref advertisement. Unlike
 * api.github.com, this isn't subject to the 60-per-hour unauthenticated REST
 * limit, which shared Cloudflare egress addresses exhaust almost constantly.
 */
async function latestRevision(repo: string, fetcher: typeof fetch): Promise<string | null> {
  const response = await fetcher(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
    headers: { 'User-Agent': 'cmail-update-check' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const refs = await response.text();
  return new RegExp(`([0-9a-f]{40}) refs/heads/${BRANCH}(?=[\\n\\0])`).exec(refs)?.[1] || null;
}

/** The release version recorded at an immutable upstream commit, if readable. */
async function versionAt(repo: string, revision: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(`https://raw.githubusercontent.com/${repo}/${revision}/package.json`, {
      headers: { 'User-Agent': 'cmail-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const version = (await response.json() as { version?: unknown }).version;
    return typeof version === 'string' && /^\d+\.\d+\.\d+[\w.+-]{0,40}$/.test(version) ? version : null;
  } catch { return null; }
}

/** Ancestry from GitHub's REST API. Optional: rate limits only lose the commit count. */
async function compare(repo: string, base: string, fetcher: typeof fetch): Promise<{ status: string; ahead: number } | null> {
  try {
    const response = await fetcher(`https://api.github.com/repos/${repo}/compare/${base}...${BRANCH}?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cmail-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as { status?: string; ahead_by?: number };
    if (!['ahead', 'identical', 'behind', 'diverged'].includes(body.status || '')) return null;
    if (!Number.isSafeInteger(body.ahead_by) || body.ahead_by! < 0) return null;
    return { status: body.status!, ahead: body.ahead_by! };
  } catch { return null; }
}

/** Compare ancestry, not dates: a fork or local change is not a normal upgrade. Never throws. */
export async function checkSourceUpdates(build: Build, repository: string, fetcher: typeof fetch = fetch): Promise<UpdateStatus> {
  const result: UpdateStatus = {
    build, status: 'unknown', ahead: null, latest: null, checkedAt: null, changesUrl: null,
    procedureUrl: procedureUrl(repository), reason: null,
  };
  if (build.modified) return { ...result, status: 'custom', reason: 'Built from a working tree with local changes' };
  const repo = parseRepository(repository);
  if (!repo) return { ...result, reason: 'REPO_URL is not a public GitHub repository URL' };
  if (!/^[a-f0-9]{40}$/.test(build.revision)) return { ...result, reason: 'This build does not record its source revision' };

  let head: string | null;
  try { head = await latestRevision(repo, fetcher); } catch { head = null; }
  if (!head) return { ...result, reason: 'Could not reach the upstream repository' };

  const checked = { ...result, checkedAt: new Date().toISOString() };
  if (head === build.revision) {
    return { ...checked, status: 'current', ahead: 0, latest: { revision: head, version: build.version || null } };
  }
  const [comparison, version] = await Promise.all([compare(repo, build.revision, fetcher), versionAt(repo, head, fetcher)]);
  const latest = { revision: head, version };
  const changesUrl = `https://github.com/${repo}/compare/${build.revision}...${head}`;
  if (comparison && comparison.status !== 'ahead') {
    // Identical can't happen once heads differ unless main moved between requests.
    if (comparison.status === 'identical') return { ...checked, status: 'current', ahead: 0, latest };
    return { ...checked, status: 'custom', latest, changesUrl, reason: 'This build is not on upstream main' };
  }
  return { ...checked, status: 'available', ahead: comparison?.ahead ?? null, latest, changesUrl };
}
