import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

// Performance budgets for the main screens on a phone: Pixel 7 viewport with
// the CPU slowed 4x, a cold load each time (new context, no service worker).
// Bytes are what the browser decoded (the local server doesn't compress) for
// the page's own .js and .css files (not fonts, images or the message frame), so
// they're stable from run to run. Timings on a shared CI runner are not, so
// those budgets are loose and only catch large regressions.
// Raise a budget only with a reason in the pull request.

type Metrics = { htmlKb: number; jsKb: number; cssKb: number; requests: number; lcpMs: number; cls: number };
type Budget = { jsKb: number; cssKb: number; lcpMs: number; cls: number };

// Set from CI on 1 Nov 2026 (bytes about 10% over the measured size; LCP
// measured 260-370 ms; CLS measured 0). null = measure and report only.
// Compose carries the rich-text editor, so it is the heavy one.
const BUDGETS: Record<string, Budget | null> = {
  'sign-in': { jsKb: 135, cssKb: 47, lcpMs: 2000, cls: 0.1 },
  inbox: { jsKb: 195, cssKb: 62, lcpMs: 2000, cls: 0.1 },
  message: { jsKb: 215, cssKb: 64, lcpMs: 2000, cls: 0.1 },
  compose: { jsKb: 950, cssKb: 75, lcpMs: 2000, cls: 0.1 },
};

async function measure(page: Page, path: string, ready: string): Promise<Metrics> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await open(page, path);
  await expect(page.locator(ready).first()).toBeVisible();
  // Compose loads the editor and its paste helper after hydration: wait again.
  await page.waitForLoadState('networkidle');
  return page.evaluate(async () => {
    const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const sum = (ext: string) => resources
      .filter((entry) => new URL(entry.name).pathname.endsWith(ext))
      .reduce((total, entry) => total + entry.decodedBodySize, 0);
    // Collect every entry (buffered and new) for one second, then stop. A
    // type with no entries (no layout shift) never calls back: empty list.
    const collect = <T extends PerformanceEntry>(type: string) => new Promise<T[]>((resolve) => {
      const entries: T[] = [];
      const observer = new PerformanceObserver((list) => { entries.push(...(list.getEntries() as T[])); });
      observer.observe({ type, buffered: true });
      setTimeout(() => { entries.push(...(observer.takeRecords() as T[])); observer.disconnect(); resolve(entries); }, 1000);
    });
    const [lcp, shifts] = await Promise.all([
      collect<PerformanceEntry>('largest-contentful-paint'),
      collect<PerformanceEntry & { value: number; hadRecentInput: boolean }>('layout-shift'),
    ]);
    return {
      htmlKb: kb(nav.decodedBodySize),
      jsKb: kb(sum('.js')),
      cssKb: kb(sum('.css')),
      requests: resources.length + 1,
      lcpMs: Math.round(lcp.at(-1)?.startTime ?? 0),
      cls: Math.round(shifts.filter((s) => !s.hadRecentInput).reduce((total, s) => total + s.value, 0) * 1000) / 1000,
    };
  });
}

const PAGES = [
  { name: 'sign-in', path: '/', ready: 'h1', as: undefined },
  { name: 'inbox', path: '/mail', ready: 'h1', as: 'user-mia' as const },
  { name: 'message', path: '/mail/msg-newsletter', ready: 'article h1', as: 'user-mia' as const },
  { name: 'compose', path: '/mail/compose', ready: '.rich-text-surface', as: 'user-sam' as const },
];

test.describe('performance budgets (phone, 4x CPU)', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'pixel-7', 'pixel-7 only');
  });

  for (const p of PAGES) {
    test.describe(p.name, () => {
      if (p.as) test.use({ as: p.as });
      test(`${p.name} stays within budget`, async ({ page }, info) => {
        const metrics = await measure(page, p.path, p.ready);
        console.log(`perf ${p.name}: ${JSON.stringify(metrics)}`);
        info.annotations.push({ type: 'perf', description: JSON.stringify(metrics) });
        // 0 means no LCP was observed, which must not pass as a perfect score.
        expect(metrics.lcpMs, 'LCP was observed').toBeGreaterThan(0);
        const budget = BUDGETS[p.name];
        if (!budget) return;
        expect.soft(metrics.jsKb, 'JavaScript (KB, decoded)').toBeLessThanOrEqual(budget.jsKb);
        expect.soft(metrics.cssKb, 'CSS (KB, decoded)').toBeLessThanOrEqual(budget.cssKb);
        expect.soft(metrics.lcpMs, 'Largest Contentful Paint (ms)').toBeLessThanOrEqual(budget.lcpMs);
        expect.soft(metrics.cls, 'Cumulative Layout Shift').toBeLessThanOrEqual(budget.cls);
      });
    });
  }
});
