import { describe, expect, it } from 'vitest';
import { deploymentUpdateAction, shouldCheckForServiceWorkerUpdate } from './service-worker-update';

describe('service-worker update coordination', () => {
  it.each(['/mail', '/mail/compose', '/admin/policy', '/admin/signatures', '/mail/settings'])(
    'keeps %s open when a deployment changes',
    (pathname) => {
      // A route cannot prove that its current form is clean, so no route may
      // opt into an automatic reload.
      expect(deploymentUpdateAction(pathname, true)).toBe('show-refresh-banner');
    },
  );

  it('coalesces lifecycle update checks for thirty seconds', () => {
    expect(shouldCheckForServiceWorkerUpdate(0, 30_000)).toBe(true);
    expect(shouldCheckForServiceWorkerUpdate(10_000, 39_999)).toBe(false);
    expect(shouldCheckForServiceWorkerUpdate(10_000, 40_000)).toBe(true);
  });

  it('shows no banner when SvelteKit reports no deployment change', () => {
    expect(deploymentUpdateAction('/mail', false)).toBe('none');
  });
});
