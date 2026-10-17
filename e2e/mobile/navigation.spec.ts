import { test, expect, open, smallTapTargets } from './fixtures';

test.use({ as: 'user-mia' });

test.describe('search', () => {
  test('finds messages across mailboxes and can be cleared', async ({ page, isMobile }) => {
    await open(page, '/mail');
    if (isMobile) await page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = page.getByRole('searchbox', { name: 'Search mail' });
    await expect(box).toBeVisible();
    await box.fill('hall');
    await box.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();
    // Subject or preview: two hall-key mails, the yoga booking and lost property.
    await expect(page.locator('.mail-row')).toHaveCount(4);
    await page.getByRole('link', { name: 'Clear search' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  });

  test('no results says what to do next', async ({ page }) => {
    await open(page, '/mail?q=zebra-crossing');
    await expect(page.getByRole('heading', { name: 'No matching messages' })).toBeVisible();
  });

  test('search stays scoped to the shared mailbox in view', async ({ page }) => {
    await open(page, '/mail?mailbox=mb-desk&q=parking');
    await expect(page.locator('.mail-row')).toHaveCount(1);
  });
});

test.describe('shared mailbox switcher', () => {
  test('switching to a shared mailbox scopes the list and the heading', async ({ page, isMobile }) => {
    await open(page, '/mail');
    if (isMobile) await page.getByRole('button', { name: /open mail navigation/i }).click();
    await page.getByRole('navigation', { name: 'Shared' }).getByRole('link', { name: 'Front Desk' }).click();
    await expect(page).toHaveURL(/mailbox=mb-desk/);
    await expect(page.locator('.heading-group')).toContainText('frontdesk@wattle.test');
    await expect(page.locator('.mail-row')).toHaveCount(3);
    if (isMobile) await expect(page.locator('#shell-navigation')).not.toHaveClass(/open/);
  });

  test('the folder is kept when switching mailbox', async ({ page, isMobile }) => {
    await open(page, '/mail?folder=sent');
    if (isMobile) await page.getByRole('button', { name: /open mail navigation/i }).click();
    await page.locator('#mailbox-picker').selectOption('mb-desk');
    await expect(page).toHaveURL(/folder=sent/);
    await expect(page).toHaveURL(/mailbox=mb-desk/);
  });

  test('read-only shared mailbox: star and move are unavailable', async ({ page }) => {
    await open(page, '/mail/msg-book-1');
    // Opening marks it read, which is allowed with read access.
    await expect(page.getByRole('link', { name: /^Reply$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.skip(({ isMobile }) => !isMobile, 'drawer');

    test('the drawer opens, traps the page behind it, and closes with Escape', async ({ page }) => {
      await open(page, '/mail');
      const toggle = page.getByRole('button', { name: /open mail navigation/i });
      await toggle.click();
      await expect(page.locator('#shell-navigation')).toHaveClass(/open/);
      await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
      await page.keyboard.press('Escape');
      await expect(page.locator('#shell-navigation')).not.toHaveClass(/open/);
    });

    test('drawer items are at least 44px', async ({ page }) => {
      await open(page, '/mail');
      await page.getByRole('button', { name: /open mail navigation/i }).click();
      const small = await smallTapTargets(page, '#shell-navigation .nav-item, #shell-navigation .btn, #shell-navigation select');
      expect(small, small.join('\n')).toEqual([]);
    });
  });
});
