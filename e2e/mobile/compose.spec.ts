import { test, expect, open, openVirtualKeyboard, isInViewport, smallTapTargets } from './fixtures';

// Compose writes drafts and sends, so it runs as Sam and sends only to the
// internal Records mailbox (records@wattle.test). OUTBOUND_PROVIDER is "none":
// nothing can leave the machine.
test.use({ as: 'user-sam' });

const RECORDS = 'records@wattle.test';

async function newMessage(page: import('@playwright/test').Page) {
  await open(page, '/mail/compose');
  await expect(page.locator('.rich-text-surface')).toBeVisible();
}

test('rich text: bold and a bulleted list are applied in the editor', async ({ page }) => {
  await newMessage(page);
  const editor = page.locator('.rich-text-surface');
  await editor.click();
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Key points');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hall keys');
  await expect(editor.locator('strong')).toHaveText('Key points');
  await expect(editor.locator('ul li')).toHaveText('Hall keys');
  await expect(page.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute('aria-pressed', 'true');
});

test('send states: Sending, then the Sent folder shows the message body', async ({ page }, info) => {
  const subject = `Suite check ${info.project.name} ${Date.now()}`;
  await newMessage(page);
  await page.locator('#to').fill(RECORDS);
  await page.locator('#subject').fill(subject);
  await page.locator('.rich-text-surface').click();
  await page.keyboard.type('Sent-body check: the minutes are filed.');
  await page.getByRole('button', { name: /^Send$/ }).click();
  await expect(page).toHaveURL(/folder=sent/, { timeout: 15_000 });
  const row = page.locator('.mail-row-link', { hasText: subject });
  await expect(row).toBeVisible();
  // Reproduction attempt for "Sent folder shows blank body".
  await row.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
  const frame = page.frameLocator('iframe[title="Email content"]');
  await expect(frame.getByText('Sent-body check: the minutes are filed.')).toBeVisible();
  const height = await page.locator('iframe[title="Email content"]').evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(60);
});

test('Sent body also renders after a full page load of the Sent item', async ({ page }, info) => {
  const subject = `Reload check ${info.project.name} ${Date.now()}`;
  await newMessage(page);
  await page.locator('#to').fill(RECORDS);
  await page.locator('#subject').fill(subject);
  await page.locator('.rich-text-surface').click();
  await page.keyboard.type('Visible after reload.');
  await page.getByRole('button', { name: /^Send$/ }).click();
  await expect(page).toHaveURL(/folder=sent/, { timeout: 15_000 });
  const href = await page.locator('.mail-row-link', { hasText: subject }).getAttribute('href');
  await page.goto(href!);
  await expect(page.frameLocator('iframe[title="Email content"]').getByText('Visible after reload.')).toBeVisible();
});

test('attachments: an added file is listed and can be removed', async ({ page }) => {
  await newMessage(page);
  await page.locator('input[type=file][name=attachments]').setInputFiles({
    name: 'invented-agenda.txt', mimeType: 'text/plain', buffer: Buffer.from('Invented agenda'),
  });
  await expect(page.getByText('invented-agenda.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Remove invented-agenda.txt' }).click();
  await expect(page.getByText('invented-agenda.txt')).toHaveCount(0);
});

test('a missing recipient is refused with a clear message', async ({ page }) => {
  await newMessage(page);
  await page.locator('#subject').fill('No recipient');
  await page.getByRole('button', { name: /^Send$/ }).click();
  // Either the browser's required-field check or the server's error.
  const invalid = await page.locator('#to').evaluate((input) => !(input as HTMLInputElement).validity.valid);
  expect(invalid).toBe(true);
  await expect(page).toHaveURL(/\/mail\/compose/);
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('with the keyboard up, the editor stays on screen', async ({ page }) => {
    await newMessage(page);
    await page.locator('.rich-text-surface').click();
    await openVirtualKeyboard(page);
    await page.keyboard.type('Typing with the keyboard up.');
    expect(await isInViewport(page, '.rich-text-surface')).toBe(true);
  });

  test('with the keyboard up, Send is still reachable without scrolling', async ({ page }) => {
    await newMessage(page);
    await page.locator('.rich-text-surface').click();
    await openVirtualKeyboard(page);
    await page.keyboard.type('Ready to send.');
    expect(await isInViewport(page, 'button.send-button')).toBe(true);
  });

  test('formatting toolbar and attachment controls are at least 44px', async ({ page }) => {
    await newMessage(page);
    await page.locator('input[type=file][name=attachments]').setInputFiles({
      name: 'invented-agenda.txt', mimeType: 'text/plain', buffer: Buffer.from('Invented agenda'),
    });
    const small = await smallTapTargets(page, '.rich-text .toolbar button, .rich-text .toolbar select, .format-toggle button, .attachments button, .bcc-toggle');
    expect(small, small.join('\n')).toEqual([]);
  });
});

test('recipients become removable chips', async ({ page }) => {
  await newMessage(page);
  await page.locator('#to').fill('records@wattle.test, ');
  await expect(page.getByRole('button', { name: /remove records@wattle\.test/i })).toBeVisible({ timeout: 3000 });
});
