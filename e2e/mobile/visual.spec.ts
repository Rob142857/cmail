import { test, expect, open, volatile } from './fixtures';

// Per-device baselines (e2e/mobile/__screenshots__/<platform>/<project>/).
// Dates are masked: the seed is relative to "now". Refresh after an intended
// UI change with `pnpm test:mobile:update`, then look at the PNGs.

test.describe('signed out', () => {
  test('sign-in', async ({ page }) => {
    await open(page, '/');
    await expect(page).toHaveScreenshot('sign-in.png');
  });
});

test.describe('manager views', () => {
  test.use({ as: 'user-mia' });

  const SHOTS = [
    { name: 'inbox', path: '/mail' },
    { name: 'shared-mailbox', path: '/mail?mailbox=mb-desk' },
    { name: 'message-html', path: '/mail/msg-newsletter' },
    { name: 'message-plain', path: '/mail/msg-minutes' },
    { name: 'settings', path: '/mail/settings' },
    { name: 'connected-apps', path: '/mail/connected-apps' },
    { name: 'admin', path: '/admin' },
  ];

  for (const shot of SHOTS) {
    test(shot.name, async ({ page }) => {
      await open(page, shot.path);
      await page.waitForTimeout(300); // message frame auto-size
      await expect(page).toHaveScreenshot(`${shot.name}.png`, { mask: volatile(page) });
    });
  }

  test('inbox-dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/mail');
    await expect(page).toHaveScreenshot('inbox-dark.png', { mask: volatile(page) });
  });

  test('navigation-drawer', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'drawer is phone-only');
    await open(page, '/mail');
    await page.getByRole('button', { name: /open mail navigation/i }).click();
    await expect(page.locator('#shell-navigation')).toHaveClass(/open/);
    await expect(page).toHaveScreenshot('navigation-drawer.png', { mask: volatile(page) });
  });
});

test.describe('compose', () => {
  test.use({ as: 'user-sam' });
  test('compose', async ({ page }) => {
    await open(page, '/mail/compose');
    await expect(page.locator('.rich-text-surface')).toBeVisible();
    await expect(page).toHaveScreenshot('compose.png', { mask: [...volatile(page), page.locator('.status')] });
  });

  // Dark mode shows the body on the surface tone with display-only inverted
  // content; typed text checks it stays readable. Desktop only.
  test('compose-dark', async ({ page, isMobile }) => {
    test.skip(isMobile, 'one desktop dark check is enough');
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/mail/compose');
    const body = page.locator('.rich-text-surface');
    await expect(body).toBeVisible();
    await body.click();
    await page.keyboard.type('Hi Ivo, the roster looks good.');
    await expect(page).toHaveScreenshot('compose-dark.png', { mask: [...volatile(page), page.locator('.status')] });
  });
});
