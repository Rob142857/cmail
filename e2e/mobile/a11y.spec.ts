import { test, expect, open, seriousA11yViolations, tabOrder, MIA_PAGES } from './fixtures';

// axe-core, failing only on serious and critical issues. Run on one phone
// and desktop: layouts differ, the markup mostly does not.
test.describe('axe: serious and critical issues', () => {
  test.beforeEach(({}, info) => {
    test.skip(!['pixel-7', 'desktop-chrome'].includes(info.project.name), 'pixel-7 and desktop only');
  });

  test('sign-in page', async ({ page }) => {
    await open(page, '/');
    const violations = await seriousA11yViolations(page);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test.describe('signed in', () => {
    test.use({ as: 'user-mia' });
    for (const p of MIA_PAGES) {
      test(p.name, async ({ page }) => {
        await open(page, p.path);
        const violations = await seriousA11yViolations(page);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    }
  });

  test.describe('dark mode', () => {
    test.use({ as: 'user-mia', colorScheme: 'dark' });
    for (const p of MIA_PAGES.filter((x) => ['inbox', 'message html', 'settings', 'admin home'].includes(x.name))) {
      test(`${p.name} (dark)`, async ({ page }) => {
        await open(page, p.path);
        const violations = await seriousA11yViolations(page);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    }
  });

  test.describe('compose', () => {
    test.use({ as: 'user-sam' });
    test('new message', async ({ page }) => {
      await open(page, '/mail/compose');
      await expect(page.locator('.rich-text-surface')).toBeVisible();
      const violations = await seriousA11yViolations(page);
      expect(violations, violations.join('\n')).toEqual([]);
    });
  });
});

test.describe('keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard: desktop');
  test.use({ as: 'user-mia' });

  test('skip link comes first and every stop shows a focus ring', async ({ page }) => {
    await open(page, '/mail');
    const order = await tabOrder(page, 14);
    expect(order[0].label).toMatch(/skip/i);
    const invisible = order.filter((step) => !step.visibleFocus).map((step) => step.label);
    expect(invisible, `no visible focus on: ${invisible.join(', ')}`).toEqual([]);
  });

  test('focus order runs header, navigation, then the message list', async ({ page }) => {
    await open(page, '/mail');
    const labels = (await tabOrder(page, 30)).map((step) => step.label);
    const search = labels.findIndex((label) => /search/i.test(label));
    const compose = labels.findIndex((label) => /new message/i.test(label));
    const firstMessage = labels.findIndex((label) => /roster for the spring/i.test(label));
    expect(search).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(search);
    expect(firstMessage === -1 || firstMessage > compose).toBe(true);
  });

  test('the navigation drawer is not focusable while closed on a phone-width window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page, '/mail');
    const labels = (await tabOrder(page, 8)).map((step) => step.label);
    expect(labels.some((label) => /^Sent$/.test(label))).toBe(false);
  });
});
