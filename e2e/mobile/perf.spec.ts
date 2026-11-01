import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

// Performance budgets for the main screens on a phone: Pixel 7 viewport with
// the CPU slowed 4x, a cold load each time (new context, no service worker).
// Bytes are what the browser decoded (the local server doesn't compress), so
// they're stable from run to run. Timings on a shared CI runner are not, so
// those budgets are loose and only catch large regressions.
// Raise a budget only with a reason in the pull request.

type Metrics = { htmlKb: number; jsKb: number; cssKb: number; requests: number; lcpMs: number; cls: number };
type Budget = { jsKb: number; cssKb: number; lcpMs: number; cls: number };

// null = measure and report only (the first CI runs set the numbers).
const BUDGETS: Record<string, Budget | null> = {
  'sign-in': null,
  inbox: null,
  message: null,
  compose: null,
};

async function measure(page: Page, path: string, ready: string): Promise<Metrics> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await open(page, path);
  await expect(page.locator(ready).first()).toBeVisible();
  return page.evaluate(async () => {
    const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const sum = (ext: string) => resources
      .filter((entry) => new URL(entry.name).pathname.endsWith(ext))
      .reduce((total, entry) => total + entry.decodedBodySize, 0);
    const buffered = <T extends PerformanceEntry>(type: string) => new Promise<T[]>((resolve) => {
      const observer = new PerformanceObserver((list) => resolve(list.getEntries() as T[]));
      observer.observe({ type, buffered: true });
      setTimeout(() => { observer.disconnect(); resolve([]); }, 1000);
    });
    const lcp = await buffered<PerformanceEntry & { startTime: number }>('largest-contentful-paint');
    const shifts = await buffered<PerformanceEntry & { value: number; hadRecentInput: boolean }>('layout-shift');
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
