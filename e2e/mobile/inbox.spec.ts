import { test, expect, open, smallTapTargets } from './fixtures';

test.use({ as: 'user-mia' });

test('inbox lists every mailbox with unread first-class', async ({ page }) => {
  await open(page, '/mail');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  const rows = page.locator('.mail-row');
  await expect(rows).toHaveCount(13);
  await expect(rows.first()).toContainText('Roster for the spring working bee');
  await expect(rows.first()).toHaveClass(/unread/);
  // Shared-mailbox mail is labelled with its mailbox.
  await expect(page.locator('.mail-row', { hasText: 'Lost property' })).toContainText('frontdesk');
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('each row shows sender, subject and a preview line', async ({ page }) => {
    await open(page, '/mail');
    const row = page.locator('.mail-row', { hasText: 'Hall key handover' }).last();
    await expect(row.locator('.participant')).toBeVisible();
    await expect(row.locator('.subject')).toBeVisible();
    await expect(row.locator('.snippet')).toBeVisible();
  });

  test('a phone screen shows at least six messages', async ({ page }) => {
    await open(page, '/mail');
    const visible = await page.locator('.mail-row').evaluateAll((rows) => rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom <= window.innerHeight && rect.top >= 0;
    }).length);
    expect(visible).toBeGreaterThanOrEqual(6);
  });

  test('bulk actions stay out of the way until something is selected', async ({ page }) => {
    await open(page, '/mail');
    await expect(page.locator('.bulk-commands')).toBeHidden();
    await page.locator('.mail-row .message-selector').first().click();
    await expect(page.locator('.bulk-commands')).toBeVisible();
    await expect(page.locator('.selection-summary')).toHaveText('1 selected');
  });

  test('New message is one tap away without opening the menu', async ({ page }) => {
    await open(page, '/mail');
    // The drawer's own New message link is off-screen (and inert) while closed.
    const links = page.getByRole('link', { name: 'New message' });
    const onScreen = await links.evaluateAll((elements) => elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return !element.closest('[inert]') && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth
        && rect.top >= 0 && rect.bottom <= window.innerHeight;
    }));
    expect(onScreen).toBeGreaterThan(-1);
    await links.nth(onScreen).click();
    await expect(page).toHaveURL(/\/mail\/compose/);
  });

  test('list controls are at least 44px', async ({ page }) => {
    await open(page, '/mail');
    const small = await smallTapTargets(page, '.suite button, .suite a, .page-header .btn, .mail-row .message-selector input, .pagination .btn');
    expect(small, small.join('\n')).toEqual([]);
  });
});

test('Refresh keeps the list and confirms', async ({ page }) => {
  await open(page, '/mail');
  await page.getByRole('button', { name: /refresh/i }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Messages refreshed.' })).toBeVisible();
  await expect(page.locator('.mail-row')).toHaveCount(13);
});

test('an empty folder explains itself', async ({ page }) => {
  await open(page, '/mail?folder=archive');
  await expect(page.getByRole('heading', { name: 'No messages in archive' })).toBeVisible();
});

test('Refresh while offline keeps the list and says you are offline', async ({ page, context }) => {
  await open(page, '/mail');
  await context.setOffline(true);
  await page.getByRole('button', { name: /refresh/i }).click();
  await expect(page.getByText(/you.re offline/i).first()).toBeVisible();
  await expect(page.locator('.mail-row')).toHaveCount(13);
  await context.setOffline(false);
});

test('opening a message while offline stays on the list and explains why', async ({ page, context }) => {
  await open(page, '/mail');
  await context.setOffline(true);
  await page.locator('.mail-row-link', { hasText: 'Spring planting bulletin' }).click();
  await expect(page.getByText(/you.re offline/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/mail$/);
  await expect(page.locator('.mail-row')).toHaveCount(13);
  await context.setOffline(false);
});
