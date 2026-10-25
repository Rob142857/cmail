import { test, expect, open, horizontalOverflow, MIA_PAGES } from './fixtures';

const SIGNED_OUT_PAGES = [
  { name: 'sign-in', path: '/', ready: 'h1' },
  { name: 'email code sign-in', path: '/auth/email', ready: 'h1' },
  { name: 'help centre', path: '/help', ready: 'h1' },
  { name: 'privacy', path: '/privacy', ready: 'h1' },
];

test.describe('signed-out pages', () => {
  for (const p of SIGNED_OUT_PAGES) {
    test(`${p.name} loads with no console errors`, async ({ page, consoleErrors }) => {
      await open(page, p.path);
      await expect(page.locator(p.ready).first()).toBeVisible();
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });
  }
});

test.describe('signed in as a manager', () => {
  test.use({ as: 'user-mia' });

  for (const p of MIA_PAGES) {
    test(`${p.name} loads with no console errors`, async ({ page, consoleErrors, blockedHosts }) => {
      await open(page, p.path);
      await expect(page.locator(p.ready).first()).toBeVisible();
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
      // The only outbound attempt allowed is a remote image the reader blocks.
      expect(blockedHosts.filter((host) => host !== 'images.banksia.test')).toEqual([]);
    });
  }

  test('a standard user is kept out of Management', async ({ browser, baseURL }) => {
    const { storageFor } = await import('./fixtures');
    const context = await browser.newContext({ storageState: storageFor('user-sam', baseURL!) });
    const response = await (await context.newPage()).goto('/admin');
    expect(response?.status()).toBe(403);
    await context.close();
  });
});

// Checked for width only; their other checks live in their own specs.
const WIDTH_ONLY_PAGES = [
  { name: 'new message', path: '/mail/compose', ready: 'h1' },
  { name: 'reply', path: '/mail/compose?reply=msg-roster', ready: 'h1' },
  { name: 'forward', path: '/mail/compose?forward=msg-newsletter', ready: 'h1' },
  { name: 'admin quarantine', path: '/admin/quarantine', ready: 'h1' },
  { name: 'help getting started', path: '/help/getting-started', ready: 'h1' },
  { name: 'help shared mailboxes', path: '/help/shared-mailboxes', ready: 'h1' },
];

test.describe('no sideways scroll on narrow phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone widths only');
  test.use({ as: 'user-mia' });

  for (const width of [320, 360, 375]) {
    for (const p of [...MIA_PAGES, ...WIDTH_ONLY_PAGES, ...SIGNED_OUT_PAGES.slice(0, 1)]) {
      test(`${p.name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: page.viewportSize()!.height });
        await open(page, p.path);
        await expect(page.locator(p.ready).first()).toBeVisible();
        await expect.poll(() => horizontalOverflow(page), { timeout: 3000 }).toBeLessThanOrEqual(0);
      });
    }
  }
});
