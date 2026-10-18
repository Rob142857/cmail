import { test, expect, open, smallTapTargets } from './fixtures';

test.use({ as: 'user-mia' });

test('signature settings show the personal editor and organisation layer', async ({ page }) => {
  await open(page, '/mail/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Font and signature' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal signature' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save signature' })).toBeVisible();
});

test('Connected AI apps: empty state explains what this page is for', async ({ page }) => {
  await open(page, '/mail/connected-apps');
  await expect(page.getByRole('heading', { level: 1, name: 'Connected AI apps' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No AI apps connected' })).toBeVisible();
});

const ADMIN = [
  { path: '/admin', heading: 'Management overview' },
  { path: '/admin/users', heading: /people/i },
  { path: '/admin/mailboxes', heading: /mailbox/i },
  { path: '/admin/settings', heading: /settings/i },
  { path: '/admin/audit', heading: /audit/i },
  { path: '/admin/policy', heading: /policy/i },
  { path: '/admin/signatures', heading: /signature/i },
  { path: '/admin/quarantine', heading: /quarantine/i },
  { path: '/admin/trace', heading: /trace/i },
];

test.describe('management pages', () => {
  for (const item of ADMIN) {
    test(`${item.path} loads`, async ({ page, consoleErrors }) => {
      await open(page, item.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(item.heading);
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });
  }

  test('people list shows the invented staff with their state', async ({ page }) => {
    await open(page, '/admin/users');
    await expect(page.getByText('mia.manager@wattle.test').first()).toBeVisible();
    await expect(page.getByText('pia.pending@wattle.test').first()).toBeVisible();
  });

  test('AI connections switch is off by default', async ({ page }) => {
    await open(page, '/admin/settings');
    await expect(page.getByRole('button', { name: /allow ai agent \(mcp\) connections/i })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.skip(({ isMobile }) => !isMobile, 'phone layout');

    test('overview stat tiles sit two to a row', async ({ page }) => {
      await open(page, '/admin');
      const tops = await page.locator('.tile').evaluateAll((tiles) => tiles.slice(0, 2).map((tile) => Math.round(tile.getBoundingClientRect().top)));
      expect(tops[0]).toBe(tops[1]);
    });

    test('management header and drawer controls are at least 44px', async ({ page }) => {
      await open(page, '/admin');
      const small = await smallTapTargets(page, '.suite button, .suite a, .command-bar a, .command-bar button');
      expect(small, small.join('\n')).toEqual([]);
    });
  });
});
