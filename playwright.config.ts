import { defineConfig, devices } from '@playwright/test';

// Mobile and accessibility suite. `pnpm test:mobile` runs it against a local
// production build (wrangler pages dev, local D1/R2, invented fixtures; see
// e2e/mobile/serve.mjs). `pnpm test:mobile:update` refreshes the screenshot
// baselines. Nothing in this suite reaches a real deployment or sends mail.

const PORT = Number(process.env.E2E_PORT || 4321);

const shared = {
  // Local self-signed certificate from `wrangler pages dev --local-protocol https`.
  ignoreHTTPSErrors: true,
  timezoneId: 'Australia/Sydney',
  locale: 'en-AU',
  // An invented point in inland NSW; cmail never asks for location.
  geolocation: { latitude: -31.4, longitude: 147.9 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce' as const,
  // The service worker would cache pages across specs; the PWA spec opts in.
  serviceWorkers: 'block' as const,
};

export default defineConfig({
  testDir: 'e2e/mobile',
  outputDir: 'test-results/mobile',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 45_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL: `https://127.0.0.1:${PORT}`,
    // Fail fast: a timed-out test can't be an expected (known-bug) failure.
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...shared,
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'], ...shared } },
    { name: 'galaxy-s24', use: { ...devices['Galaxy S24'], ...shared } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'], ...shared } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], ...shared } },
  ],
  webServer: {
    command: 'node e2e/mobile/serve.mjs',
    url: `https://127.0.0.1:${PORT}/`,
    ignoreHTTPSErrors: true,
    // Each run seeds fresh state and new sessions. E2E_REUSE=1 attaches to a
    // server you already started with `node e2e/mobile/serve.mjs` (debugging).
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
