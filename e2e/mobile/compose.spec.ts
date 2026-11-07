import { test, expect, open, openVirtualKeyboard, isInViewport, smallTapTargets, horizontalOverflow } from './fixtures';

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

  test('the pinned Send bar replaces the top bar and the page fills the screen', async ({ page }) => {
    await newMessage(page);
    await expect(page.locator('.compose-appbar')).toBeVisible();
    await expect(page.locator('header.suite')).toBeHidden();
    const scroller = (await page.locator('.content-scroll').boundingBox())!;
    expect(scroller.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
  });

  test('a refused send scrolls its message into view', async ({ page }) => {
    await newMessage(page);
    await page.route((url) => url.pathname === '/mail/compose' && url.search === '?/send', (route) => route.fulfill({
      status: 422,
      contentType: 'application/json',
      // Like the real server, the result names where the action lands.
      body: JSON.stringify({ type: 'failure', status: 422, location: '/mail/compose', data: '[{"error":1},"Invented refusal for the test."]' }),
    }));
    await page.locator('#to').fill(RECORDS);
    await page.locator('#subject').fill('Refusal check');
    const editor = page.locator('.rich-text-surface');
    await editor.click();
    for (let line = 1; line <= 20; line += 1) {
      await page.keyboard.type(`Line ${line}`);
      await page.keyboard.press('Enter');
    }
    // A saved draft puts ?draft= in the address, which made SvelteKit
    // navigate away from the error before navigate: false.
    await expect(page.getByRole('button', { name: 'Discard draft' })).toBeAttached({ timeout: 15_000 });
    // Reopen it the way Drafts > Edit draft does, so the address carries the draft.
    await expect(page).toHaveURL(/[?&]draft=/);
    await page.reload();
    await page.locator('.rich-text-surface').click();
    await page.keyboard.press('End');
    await page.locator('.compose-appbar').getByRole('button', { name: 'Send' }).click();
    const error = page.locator('.form-error');
    await expect(error).toContainText('Invented refusal for the test.');
    await expect(error).toBeFocused();
    await expect.poll(() => isInViewport(page, '.form-error')).toBe(true);
  });

  test('a saved draft opens with Edit draft and Delete draft fully readable', async ({ page }) => {
    await newMessage(page);
    await page.locator('#subject').fill('Draft button check');
    await page.locator('.rich-text-surface').click();
    await page.keyboard.type('Draft text.');
    await expect(page).toHaveURL(/[?&]draft=/, { timeout: 15_000 });
    const draftId = new URL(page.url()).searchParams.get('draft');
    await open(page, `/mail/${draftId}`);
    for (const name of ['Edit draft', 'Delete draft']) {
      const control = page.getByRole(name === 'Edit draft' ? 'link' : 'button', { name });
      await expect(control).toBeVisible();
      // The words fit inside the button.
      expect(await control.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), name).toBe(true);
    }
  });

  test('with the keyboard up, Send is still reachable without scrolling', async ({ page }) => {
    await newMessage(page);
    await page.locator('.rich-text-surface').click();
    await openVirtualKeyboard(page);
    await page.keyboard.type('Ready to send.');
    expect(await isInViewport(page, 'button.appbar-send')).toBe(true);
  });

  for (const [surface, path] of [
    ['new message', '/mail/compose'],
    ['reply', '/mail/compose?reply=msg-sam-1&returnTo=%2Fmail%2Fmsg-sam-1'],
    ['forward', '/mail/compose?forward=msg-sam-1&returnTo=%2Fmail%2Fmsg-sam-1'],
  ]) {
    test(`${surface}: once the draft saves, every action fits on a 320px screen`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: page.viewportSize()!.height });
      await open(page, path);
      await page.locator('.rich-text-surface').click();
      await page.keyboard.type('Draft text.');
      // Saving the draft adds Discard draft, the widest the bar gets.
      await expect(page.getByRole('button', { name: 'Discard draft' })).toBeVisible({ timeout: 15_000 });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Back and Send live in the pinned bar on phones; the rest end the form.
      for (const [bar, name] of [
        ['.compose-appbar', 'Send'], ['.compose-appbar', /^Back to/],
        ['.compose-actions', 'Save draft'], ['.compose-actions', 'Discard draft'],
      ] as const) {
        const box = (await page.locator(bar).getByRole('button', { name }).boundingBox())!;
        expect(box.x, String(name)).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, String(name)).toBeLessThanOrEqual(320);
      }
      const small = await smallTapTargets(page, '.compose-appbar button, .compose-actions button:visible');
      expect(small, small.join('\n')).toEqual([]);
    });
  }

  test('formatting toolbar and attachment controls are at least 44px', async ({ page }) => {
    await newMessage(page);
    await page.locator('input[type=file][name=attachments]').setInputFiles({
      name: 'invented-agenda.txt', mimeType: 'text/plain', buffer: Buffer.from('Invented agenda'),
    });
    const small = await smallTapTargets(page, '.rich-text .toolbar button, .rich-text .toolbar select, .attachments button, .bcc-toggle');
    expect(small, small.join('\n')).toEqual([]);
  });
});

test('recipients become removable chips', async ({ page }) => {
  await newMessage(page);
  await page.locator('#to').fill('records@wattle.test, ');
  await expect(page.getByRole('button', { name: /remove records@wattle\.test/i })).toBeVisible({ timeout: 3000 });
});
