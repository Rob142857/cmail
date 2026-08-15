const UPDATE_CHECK_INTERVAL_MS = 30_000;

export type DeploymentUpdateAction = 'none' | 'show-refresh-banner';

/**
 * Deployments must never reload an already-open page: compose is not the only
 * surface with unsaved state (admin and settings forms are equally important).
 */
export function deploymentUpdateAction(_pathname: string, versionChanged: boolean): DeploymentUpdateAction {
  if (!versionChanged) return 'none';
  return 'show-refresh-banner';
}

/** Avoid redundant network checks when focus, online, and visibility fire together. */
export function shouldCheckForServiceWorkerUpdate(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}
