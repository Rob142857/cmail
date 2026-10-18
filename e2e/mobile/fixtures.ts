import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { KNOWN_BUGS } from './known-bugs';

/**
 * Seeded users (see seed-data.mjs). Mia is a manager whose views are kept
 * stable for screenshots: specs only READ as Mia. Anything that writes
 * (drafts, sends, moves) runs as Sam, so parallel projects never disturb
 * Mia's inbox.
 */
export type TestUser = 'user-mia' | 'user-sam';

const STATE = resolve(process.cwd(), '.tmp/e2e-mobile/sessions.json');

function sessionToken(user: TestUser): string {
  const { sessions } = JSON.parse(readFileSync(STATE, 'utf8')) as { sessions: Record<string, string> };
  const token = sessions[user];
  if (!token) throw new Error(`No seeded session for ${user}; did e2e/mobile/serve.mjs run?`);
  return token;
}

/** Session cookie for a seeded user (the local server is HTTPS, like production). */
export function storageFor(user: TestUser, baseURL: string) {
  return {
    cookies: [{
      name: 'cmail_session', value: sessionToken(user), domain: new URL(baseURL).hostname, path: '/',
      expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const,
    }],
    origins: [],
  };
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Messages the browser prints that are not cmail defects. */
const IGNORED_CONSOLE = [
  // Playwright WebKit reports style-src CSP for SvelteKit's hashed inline styles.
  /Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/i,
  // Our own isolation of third-party hosts.
  /ERR_BLOCKED_BY_CLIENT|blockedbyclient/i,
  // By design: a message frame's own CSP blocks remote images until the
  // reader chooses "Load images", and the browser logs each block.
  /violates the following Content Security Policy directive: "img-src data:/i,
  /Refused to load https:\/\/\S+ because it does not appear in the img-src directive/i,
];

type Fixtures = {
  knownBug: void;
  consoleErrors: string[];
  blockedHosts: string[];
  as: TestUser | null;
};

export const test = base.extend<Fixtures>({
  as: [null, { option: true }],
  // Marks a test as an expected failure (test.fail) while its bug is listed in
  // known-bugs.ts for this device. When the bug is fixed the test reports
  // "Expected to fail, but passed": delete its entry in the same commit.
  knownBug: [async ({}, use, info) => {
    const key = `${basename(info.file)} › ${info.titlePath.slice(1).join(' › ')}`;
    const bug = KNOWN_BUGS[key];
    if (bug && (bug.projects === 'all' || bug.projects.includes(info.project.name))) {
      info.annotations.push({ type: 'known-bug', description: bug.todo });
      info.fail(true, bug.todo);
    }
    await use();
  }, { auto: true }],
  blockedHosts: async ({}, use) => { await use([]); },
  storageState: async ({ as, baseURL }, use) => {
    await use(as ? storageFor(as, baseURL!) : { cookies: [], origins: [] });
  },
  // Mark the first-run guide done. Done with one evaluate on a static file,
  // not an init script or storageState origin, both of which Playwright also
  // runs inside cmail's sandboxed message frames (logging bogus errors there).
  page: async ({ page, as }, use) => {
    if (as) {
      await page.goto('/favicon.svg');
      await page.evaluate((id) => localStorage.setItem(`cmail:welcome:v1:${id}`, 'complete'), as);
    }
    await use(page);
  },
  consoleErrors: [async ({ page, blockedHosts }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
      // Playwright's trace recorder injects a snapshot script into every
      // frame; cmail's sandboxed message frames (correctly) refuse it.
      const where = message.location().url;
      if ((where === 'about:srcdoc' || where.startsWith('web-inspector://')) && /^Blocked script execution in 'about:srcdoc'/.test(text)) return;
      errors.push(`${text} @${JSON.stringify(message.location())}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    // Offline by construction: anything not served by the local build is
    // aborted and recorded, so a new outbound call shows up in a failure.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (LOCAL_HOSTS.has(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      blockedHosts.push(url.host);
      return route.abort('blockedbyclient');
    });
    await use(errors);
  }, { auto: true }],
});

export { expect };

/** Opens a page and waits for the app to hydrate. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** Width the document overflows the viewport by (sideways scroll), in px. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Visible, enabled interactive controls in `scope` smaller than `min` CSS px
 * in either dimension. Checkboxes count by their label when wrapped in one.
 */
export async function smallTapTargets(page: Page, selector: string, min = 44): Promise<string[]> {
  return page.$$eval(selector, (elements, min) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        && !(element as HTMLButtonElement).disabled && !element.closest('[inert]');
    })
    .map((element) => {
      const target = element.matches('input[type=checkbox], input[type=radio]') && element.closest('label') ? element.closest('label')! : element;
      const rect = target.getBoundingClientRect();
      return { element, w: Math.round(rect.width), h: Math.round(rect.height) };
    })
    .filter(({ w, h }) => w < min || h < min)
    .map(({ element, w, h }) => {
      const label = element.getAttribute('aria-label')
        || (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32)
        || element.getAttribute('name') || element.className;
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} "${label}" ${w}x${h}`;
    }), min);
}

/** Runs axe and returns serious/critical violations in a readable form. */
export async function seriousA11yViolations(page: Page, options: { exclude?: string[] } = {}): Promise<string[]> {
  // Message and signature frames hold sender-authored HTML (and are sandboxed
  // without scripts, so axe cannot run inside them anyway): skip them.
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .options({ iframes: false })
    .exclude('iframe[srcdoc]');
  for (const selector of options.exclude || []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.slice(0, 4).map((node) => node.target.join(' ')).join('\n  ')}`);
}

/**
 * Approximates an on-screen keyboard by shrinking the layout viewport, as
 * Android Chrome does. iOS Safari only shrinks the visual viewport, so treat
 * iPhone results as approximate.
 */
export async function openVirtualKeyboard(page: Page, fraction = 0.55): Promise<{ width: number; height: number }> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const shrunk = { width: viewport.width, height: Math.round(viewport.height * fraction) };
  await page.setViewportSize(shrunk);
  return shrunk;
}

/** At least `minVisiblePx` of the element is inside the visual viewport. */
export async function isInViewport(page: Page, selector: string, minVisiblePx = 24): Promise<boolean> {
  return page.$eval(selector, (element, minVisiblePx) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = top + (viewport ? viewport.height : window.innerHeight);
    return Math.min(rect.bottom, bottom) - Math.max(rect.top, top) >= Math.min(minVisiblePx, rect.height);
  }, minVisiblePx);
}

/** Tabs through the page and returns a description of each focused element. */
export async function tabOrder(page: Page, steps: number): Promise<Array<{ label: string; visibleFocus: boolean }>> {
  const order: Array<{ label: string; visibleFocus: boolean }> = [];
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { label: '(body)', visibleFocus: false };
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const ring = style.boxShadow && style.boxShadow !== 'none';
      const underline = parseFloat(style.borderBottomWidth) >= 2;
      const label = element.getAttribute('aria-label') || (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
        || element.getAttribute('name') || element.tagName.toLowerCase();
      return { label, visibleFocus: Boolean(outline || ring || underline) };
    }));
  }
  return order;
}

/** Elements to hide in screenshots because their text depends on the clock. */
export function volatile(page: Page) {
  return [page.locator('time'), page.locator('.message-date'), page.locator('[data-volatile]')];
}

export const MIA_PAGES: Array<{ name: string; path: string; ready: string }> = [
  { name: 'inbox', path: '/mail', ready: 'h1' },
  { name: 'shared mailbox', path: '/mail?mailbox=mb-desk', ready: 'h1' },
  { name: 'sent', path: '/mail?folder=sent', ready: 'h1' },
  { name: 'search', path: '/mail?q=hall', ready: 'h1' },
  { name: 'message html', path: '/mail/msg-newsletter', ready: 'article h1' },
  { name: 'message plain', path: '/mail/msg-grant', ready: 'article h1' },
  { name: 'settings', path: '/mail/settings', ready: 'h1' },
  { name: 'connected apps', path: '/mail/connected-apps', ready: 'h1' },
  { name: 'calendar', path: '/mail/calendar', ready: 'h1' },
  { name: 'admin home', path: '/admin', ready: 'h1' },
  { name: 'admin users', path: '/admin/users', ready: 'h1' },
  { name: 'admin mailboxes', path: '/admin/mailboxes', ready: 'h1' },
  { name: 'admin settings', path: '/admin/settings', ready: 'h1' },
  { name: 'admin audit', path: '/admin/audit', ready: 'h1' },
];
