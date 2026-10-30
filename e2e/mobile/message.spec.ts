import { test, expect, open, smallTapTargets } from './fixtures';

// Only messages seeded as already read are opened here, so Mia's inbox (and
// its screenshot) never changes under a parallel run.
test.use({ as: 'user-mia' });

test('HTML mail renders inside the sandboxed frame with images blocked', async ({ page }) => {
  await open(page, '/mail/msg-newsletter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spring planting bulletin: Saturday working bee');
  const frame = page.frameLocator('iframe[title="Email content"]');
  await expect(frame.getByRole('heading', { name: 'Saturday working bee' })).toBeVisible();
  await expect(page.getByText('Images blocked to stop the sender tracking you.')).toBeVisible();
  await expect(page.locator('iframe[title="Email content"]')).toHaveAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
});

test('wide HTML mail fits the screen instead of being cut off', async ({ page }) => {
  await open(page, '/mail/msg-newsletter');
  const frame = page.locator('iframe[title="Email content"]');
  await expect(frame).toBeVisible();
  await page.waitForTimeout(400);
  // Content wider than the frame would be cut off: auto-sized frames don't scroll.
  await expect.poll(() => frame.evaluate((element) => {
    const doc = (element as HTMLIFrameElement).contentDocument!;
    return Math.round(doc.documentElement.scrollWidth - (element as HTMLIFrameElement).clientWidth);
  })).toBeLessThanOrEqual(2);
  // ...and the whole newsletter is still there to read.
  await expect(page.frameLocator('iframe[title="Email content"]').getByText('RSVP for Saturday')).toBeVisible();
});

test('plain message shows sender, recipients and the body', async ({ page }) => {
  await open(page, '/mail/msg-grant');
  await expect(page.getByText('Saltbush Shire Council').first()).toBeVisible();
  const frame = page.frameLocator('iframe[title="Email content"]');
  await expect(frame.getByText('CG-2026-114')).toBeVisible();
});

test('attachments are listed with name and size', async ({ page }) => {
  await open(page, '/mail/msg-minutes');
  await expect(page.getByText('committee-minutes-october-draft.docx')).toBeVisible();
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('message actions fit on one row above the subject', async ({ page }) => {
    await open(page, '/mail/msg-grant');
    const toolbar = page.getByRole('group', { name: 'Message actions' });
    const box = await toolbar.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(56);
  });

  test('Reply is reachable and message actions are at least 44px', async ({ page }) => {
    await open(page, '/mail/msg-grant');
    await expect(page.getByRole('link', { name: /^Reply$/ })).toBeVisible();
    const small = await smallTapTargets(page, '[aria-label="Message actions"] a, [aria-label="Message actions"] button');
    expect(small, small.join('\n')).toEqual([]);
  });
});

test('sender text stays readable when its background colour is removed', async ({ page }) => {
  await open(page, '/mail/msg-newsletter');
  const heading = page.frameLocator('iframe[title="Email content"]').getByRole('heading', { name: 'Banksia Heads Landcare' });
  await expect(heading).toBeVisible();
  // The newsletter sets white text on a green cell; the reader drops the
  // background, so the text must not stay white on the white page.
  const colour = await heading.evaluate((element) => getComputedStyle(element).color);
  expect(colour).not.toBe('rgb(255, 255, 255)');
});
