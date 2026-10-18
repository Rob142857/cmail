import { test, expect, open } from './fixtures';

// The local server's certificate is self-signed and service worker script
// fetches ignore ignoreHTTPSErrors, so this file's browser skips the check.
test.use({ serviceWorkers: 'allow', as: 'user-mia', launchOptions: { args: ['--ignore-certificate-errors'] } });

test('service worker registers on the mail app', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes registration reliably');
  await open(page, '/mail');
  const scope = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return registration ? registration.scope : null;
  });
  expect(scope).toMatch(/\/$/);
});
