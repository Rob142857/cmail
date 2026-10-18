import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, open, openVirtualKeyboard, isInViewport, smallTapTargets, horizontalOverflow } from './fixtures';

// The Outlook-style formatting bar. Writes (drafts, sends) run as Sam and go
// only to the internal Records mailbox; OUTBOUND_PROVIDER is "none", so
// nothing leaves the machine. Settings changes run as Ivy, on one project.
test.use({ as: 'user-sam' });

const RECORDS = 'records@wattle.test';
const WORD_PASTE = readFileSync(resolve(process.cwd(), 'apps/web/src/lib/server/fixtures/word-paste.html'), 'utf8');

async function newMessage(page: Page) {
  await open(page, '/mail/compose');
  await expect(page.locator('.rich-text-surface')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bold' })).toBeEnabled();
}

/** aria-labels of the bar's controls a person can see, in order. */
async function visibleControls(page: Page): Promise<string[]> {
  return page.$$eval('.rich-text .toolbar [data-control]', (controls) => controls
    .filter((control) => (control as HTMLElement).offsetParent !== null)
    .map((control) => control.getAttribute('aria-label') || ''));
}

async function surfaceStyle(page: Page) {
  return page.locator('.rich-text-surface').evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color };
  });
}

test('new messages start in Aptos 12 pt, black, like Outlook', async ({ page }) => {
  await newMessage(page);
  const style = await surfaceStyle(page);
  expect(style.fontFamily).toMatch(/^"?Aptos"?, Calibri, Arial, sans-serif$/);
  expect(style.fontSize).toBe('16px');
  expect(style.color).toBe('rgb(0, 0, 0)');
});

test.describe('on a computer', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('the bar follows Outlook’s Format text order, with labels and tooltips', async ({ page }) => {
    await newMessage(page);
    expect(await visibleControls(page)).toEqual([
      'Font', 'Font size',
      'Bold', 'Italic', 'Underline', 'Strikethrough',
      'Font colour', 'Highlight colour',
      'Bulleted list', 'Numbered list', 'Decrease indent', 'Increase indent',
      'Align left', 'Centre', 'Align right',
      'Link', 'Quote', 'Clear formatting',
      'Undo', 'Redo',
    ]);
    const untitled = await page.$$eval('.rich-text .toolbar [data-control]', (controls) => controls
      .filter((control) => (control as HTMLElement).offsetParent !== null && !control.getAttribute('title'))
      .map((control) => control.getAttribute('aria-label')));
    expect(untitled).toEqual([]);
    await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', 'Bold (Ctrl+B)');
    await expect(page.getByRole('button', { name: 'Link' })).toHaveAttribute('title', 'Insert or edit link (Ctrl+K)');
    expect(await page.locator('.rich-text .toolbar .sep:visible').count()).toBeGreaterThanOrEqual(6);
    await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveValue('Aptos');
    await expect(page.getByRole('combobox', { name: 'Font size' })).toHaveValue('12');
  });

  test('shortcuts, menus and buttons apply formatting and show it as pressed', async ({ page }) => {
    await newMessage(page);
    const editor = page.locator('.rich-text-surface');
    await editor.click();
    await page.keyboard.type('Formatted words');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.press('ControlOrMeta+i');
    await page.keyboard.press('ControlOrMeta+u');
    for (const name of ['Bold', 'Italic', 'Underline']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('button', { name: 'Strikethrough' }).click();
    await expect(page.getByRole('button', { name: 'Strikethrough' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Georgia');
    await page.getByRole('combobox', { name: 'Font size' }).selectOption('18');
    await page.getByRole('button', { name: 'Font colour' }).click();
    await page.getByRole('group', { name: 'Font colour' }).getByRole('button', { name: 'Red', exact: true }).click();
    await page.getByRole('button', { name: 'Highlight colour' }).click();
    await page.getByRole('group', { name: 'Highlight colour' }).getByRole('button', { name: 'Yellow', exact: true }).click();
    await page.getByRole('button', { name: 'Centre' }).click();
    await expect(editor).toBeFocused();

    await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveValue('Georgia');
    await expect(page.getByRole('combobox', { name: 'Font size' })).toHaveValue('18');
    await expect(page.getByRole('button', { name: 'Centre' })).toHaveAttribute('aria-pressed', 'true');
    const html = await editor.innerHTML();
    expect(html).toContain('text-align: center');
    expect(html).toMatch(/font-family: Georgia/);
    expect(html).toContain('font-size: 18pt');
    expect(html).toMatch(/color: (#ff0000|rgb\(255, 0, 0\))/);
    expect(html).toMatch(/background-color: (#ffff00|rgb\(255, 255, 0\))/);
    for (const tag of ['strong', 'em', 'u', 's']) expect(html).toContain(`<${tag}>`);

    // Automatic takes the colour back off.
    await page.getByRole('button', { name: 'Font colour' }).click();
    await page.getByRole('group', { name: 'Font colour' }).getByRole('button', { name: 'Automatic' }).click();
    expect(await editor.innerHTML()).not.toMatch(/[^-]color: (#ff0000|rgb\(255, 0, 0\))/);
  });

  test('Ctrl+K adds a link, refuses javascript:, and can remove it', async ({ page }) => {
    await newMessage(page);
    const editor = page.locator('.rich-text-surface');
    await editor.click();
    await page.keyboard.type('Roster page');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+k');
    const address = page.getByLabel('Link address');
    await expect(address).toBeFocused();
    await address.fill('javascript:alert(1)');
    await address.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'web address' })).toBeVisible();
    expect(await editor.locator('a').count()).toBe(0);
    // Enter in the link box never submits (sends) the message.
    await expect(page).toHaveURL(/\/mail\/compose/);

    await address.fill('wattle-creek.test/roster');
    await address.press('Enter');
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://wattle-creek.test/roster');
    await expect(page.getByRole('button', { name: 'Link' })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(address).toHaveValue('https://wattle-creek.test/roster');
    await page.getByRole('button', { name: 'Remove link' }).click();
    expect(await editor.locator('a').count()).toBe(0);
    await expect(editor).toHaveText('Roster page');
  });

  test('indent, lists, undo and redo', async ({ page }) => {
    await newMessage(page);
    const editor = page.locator('.rich-text-surface');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await editor.click();
    await page.keyboard.type('Indented');
    await page.getByRole('button', { name: 'Increase indent' }).click();
    await page.getByRole('button', { name: 'Increase indent' }).click();
    await expect(editor.locator('p').first()).toHaveAttribute('style', /^margin-left: 80px;?$/);
    await page.getByRole('button', { name: 'Decrease indent' }).click();
    await expect(editor.locator('p').first()).toHaveAttribute('style', /^margin-left: 40px;?$/);
    await page.keyboard.press('ControlOrMeta+Shift+m');
    await expect(editor.locator('p').first()).not.toHaveAttribute('style', /margin-left/);

    await page.getByRole('button', { name: 'Numbered list' }).click();
    await expect(editor.locator('ol li')).toHaveText('Indented');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await editor.locator('ol').count()).toBe(0);
    await page.keyboard.press('ControlOrMeta+y');
    await expect(editor.locator('ol li')).toHaveText('Indented');
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await editor.locator('ol').count()).toBe(0);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(editor.locator('ol li')).toHaveText('Indented');
  });

  test('arrow keys move along the bar, which is one Tab stop', async ({ page }) => {
    await newMessage(page);
    await page.getByRole('button', { name: 'Bold' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Italic' })).toBeFocused();
    // Undo and Redo are disabled in a new message, so End stops before them.
    await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Clear formatting' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toBeFocused();
    const stops = await page.$$eval('.rich-text .toolbar [data-control]', (controls) => controls
      .filter((control) => (control as HTMLElement).offsetParent !== null && (control as HTMLElement).tabIndex === 0).length);
    expect(stops).toBe(1);
    // Escape closes a palette and returns to its button.
    await page.getByRole('button', { name: 'Font colour' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Font colour' }).getByRole('button', { name: 'Automatic' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Font colour' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Font colour' })).toBeFocused();
  });

  test('a formatted message is sent inside the default-font container', async ({ page }, info) => {
    const subject = `Toolbar check ${info.project.name} ${Date.now()}`;
    await newMessage(page);
    await page.locator('#to').fill(RECORDS);
    await page.locator('#subject').fill(subject);
    await page.locator('.rich-text-surface').click();
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('Important');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type(' and ');
    await page.getByRole('button', { name: 'Font colour' }).click();
    await page.getByRole('group', { name: 'Font colour' }).getByRole('button', { name: 'Dark red' }).click();
    await page.keyboard.type('red');
    await page.getByRole('button', { name: /^Send$/ }).click();
    await expect(page).toHaveURL(/folder=sent/, { timeout: 15_000 });
    await page.locator('.mail-row-link', { hasText: subject }).click();
    const frame = page.frameLocator('iframe[title="Email content"]');
    await expect(frame.locator('strong')).toHaveText('Important');
    await expect(frame.locator('div[style*="Aptos"]').first()).toBeVisible();
    await expect(frame.locator('div[style*="Aptos"]').first()).toHaveCSS('font-size', '16px');
    await expect(frame.getByText('red', { exact: true })).toHaveCSS('color', 'rgb(192, 0, 0)');
  });
});

test('pasting from Word keeps basic formatting and strips Office junk', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit ignores synthetic clipboard data on paste events');
  await newMessage(page);
  await expect(page.locator('.rich-text')).toHaveAttribute('data-paste', 'office');
  const editor = page.locator('.rich-text-surface');
  await editor.click();
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'Hall roster update');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, WORD_PASTE);
  await expect(editor.locator('strong', { hasText: 'Hall roster update' })).toBeVisible();
  const html = await editor.innerHTML();
  expect(html).not.toMatch(/mso-|Mso|class="(?!ProseMirror)|<o:p|supportLists|Comic Sans|javascript|<img/i);
  await expect(editor.locator(':scope > ul > li')).toHaveCount(2);
  await expect(editor.locator(':scope > ul > li > ul > li')).toHaveText('Bring the urn');
  await expect(editor.locator(':scope > ol > li')).toHaveText(['Check the keys', 'Lock up']);
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://wattle-creek.test/roster');
  expect(html).toMatch(/font-size: 14pt/);
  expect(html).toMatch(/color: (#c00000|rgb\(192, 0, 0\))/);
  expect(html).toMatch(/background-color: (#ffff00|rgb\(255, 255, 0\))/);
  expect(html).toContain('<em>new</em>');
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('one sideways-scrolling row with the most-used buttons and a More sheet', async ({ page }) => {
    await newMessage(page);
    expect(await visibleControls(page)).toEqual([
      'Bold', 'Italic', 'Underline', 'Font size', 'Font colour', 'Bulleted list', 'Link', 'More formatting',
    ]);
    const toolbar = page.locator('.rich-text .toolbar');
    expect(await toolbar.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
    expect(await toolbar.evaluate((element) => getComputedStyle(element).flexWrap)).toBe('nowrap');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // More is always on screen, pinned to the end of the row.
    const more = await page.getByRole('button', { name: 'More formatting' }).boundingBox();
    const bar = await toolbar.boundingBox();
    expect(more && bar && more.x + more.width <= bar.x + bar.width + 1 && more.x >= bar.x).toBe(true);

    await page.getByRole('button', { name: 'More formatting' }).click();
    const sheet = page.getByRole('group', { name: 'More formatting' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Font', exact: true })).toBeVisible();
    for (const name of ['Strikethrough', 'Highlight colour', 'Numbered list', 'Decrease indent', 'Increase indent',
      'Align left', 'Centre', 'Align right', 'Quote', 'Clear formatting', 'Undo', 'Redo']) {
      await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
    }
    const small = await smallTapTargets(page, '.rich-text .toolbar button, .rich-text .toolbar select, .more-sheet button, .more-sheet select');
    expect(small, small.join('\n')).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.locator('.rich-text-surface').click();
    await page.keyboard.type('Item');
    await page.getByRole('button', { name: 'More formatting' }).click();
    await sheet.getByRole('button', { name: 'Numbered list' }).click();
    await expect(page.locator('.rich-text-surface ol li')).toHaveText('Item');

    await page.getByRole('button', { name: 'Font colour' }).click();
    const palette = page.getByRole('group', { name: 'Font colour' });
    const swatches = await smallTapTargets(page, '.palette button');
    expect(swatches, swatches.join('\n')).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await palette.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect(palette).toHaveCount(0);
  });

  for (const width of [360, 375]) {
    test(`at ${width}px with the keyboard up, the bar stays at the top of the editor`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await newMessage(page);
      const editor = page.locator('.rich-text-surface');
      await editor.click();
      for (let line = 1; line <= 18; line += 1) {
        await page.keyboard.type(`Line ${line} of a long message`);
        await page.keyboard.press('Enter');
      }
      await openVirtualKeyboard(page);
      await page.keyboard.type('Still typing with the keyboard up');
      expect(await isInViewport(page, '.rich-text .toolbar', 44)).toBe(true);
      expect(await isInViewport(page, 'button.send-button')).toBe(true);
      // The bar sits above the line being typed, not over it.
      const bar = await page.locator('.rich-text .toolbar').boundingBox();
      const caretLine = await editor.locator('p').last().boundingBox();
      expect(bar && caretLine && bar.y + bar.height <= caretLine.y + 1).toBe(true);
      // ...and the sticky Send bar doesn't cover it either.
      const actions = await page.locator('.compose-actions').boundingBox();
      expect(caretLine && actions && caretLine.y + caretLine.height <= actions.y + 1).toBe(true);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      const small = await smallTapTargets(page, '.rich-text .toolbar button, .rich-text .toolbar select');
      expect(small, small.join('\n')).toEqual([]);
      // Tapping a button keeps the caret (and the keyboard) in the editor.
      await page.getByRole('button', { name: 'Bold' }).click();
      await expect(editor).toBeFocused();
      await page.keyboard.type(' bold');
      await expect(editor.locator('p').last().locator('strong')).toHaveText('bold');
    });
  }
});

test.describe('default font in Settings', () => {
  test.use({ as: 'user-ivy' });

  test('a saved default font and size is used for new messages', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'changes Ivy’s saved setting, so runs on one project');
    await open(page, '/mail/settings');
    const font = page.getByLabel('Font', { exact: true });
    const size = page.getByLabel('Size', { exact: true });
    await expect(font).toHaveValue('Aptos');
    await expect(size).toHaveValue('12');
    await expect(page.getByRole('button', { name: 'Save font' })).toBeDisabled();
    try {
      await font.selectOption('Georgia');
      await size.selectOption('14');
      await page.getByRole('button', { name: 'Save font' }).click();
      await expect(page.getByText('Default font saved')).toBeVisible();

      await newMessage(page);
      const style = await surfaceStyle(page);
      expect(style.fontFamily).toMatch(/^Georgia, "?Times New Roman"?, serif$/);
      expect(style.fontSize).toBe('18.6667px');
      await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveValue('Georgia');
      await expect(page.getByRole('combobox', { name: 'Font size' })).toHaveValue('14');
    } finally {
      await open(page, '/mail/settings');
      await page.getByLabel('Font', { exact: true }).selectOption('Aptos');
      await page.getByLabel('Size', { exact: true }).selectOption('12');
      if (await page.getByRole('button', { name: 'Save font' }).isEnabled()) {
        await page.getByRole('button', { name: 'Save font' }).click();
        await expect(page.getByText('Default font saved')).toBeVisible();
      }
    }
  });
});
