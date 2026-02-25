const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const RUN_MANUAL = process.env.RUN_MANUAL_CHROME_EXT_TEST === '1';

test.describe('Windows Chrome manual extension load (assisted)', () => {
  test.skip(!RUN_MANUAL, 'Set RUN_MANUAL_CHROME_EXT_TEST=1 to run this interactive test.');

  test('MANUAL-CHROME-00: dev mode + load unpacked via chrome://extensions', async ({}, testInfo) => {
    test.setTimeout(10 * 60 * 1000);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-manual-chrome-'));
    let context;

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,
        args: ['--no-sandbox']
      });

      const browserVersion = context.browser()?.version() || 'unknown';
      console.log('\n=== Manual Chrome Extension Load (Assisted) ===');
      console.log(`Chrome version: ${browserVersion}`);
      console.log(`Extension path: ${EXTENSION_PATH}`);
      console.log('1. In chrome://extensions, enable "Developer mode".');
      console.log('2. Click "Load unpacked".');
      console.log(`3. Select this folder: ${EXTENSION_PATH}`);
      console.log('4. Confirm the extension appears and has no obvious errors.');
      console.log('5. Resume the Playwright inspector when done.');
      console.log('=============================================\n');

      const page = await context.newPage();
      await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
      await page.screenshot({
        path: testInfo.outputPath('before-manual-load-chrome-extensions.png'),
        fullPage: true
      });

      // Interactive pause: lets you use the visible Chrome UI to load the unpacked extension.
      await page.pause();

      await page.screenshot({
        path: testInfo.outputPath('after-manual-load-chrome-extensions.png'),
        fullPage: true
      });

      const serviceWorker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent('serviceworker', { timeout: 30000 }));

      const workerUrl = serviceWorker.url();
      await testInfo.attach('manual-service-worker-url.txt', {
        body: Buffer.from(workerUrl),
        contentType: 'text/plain'
      });

      expect(workerUrl).toMatch(/^chrome-extension:\/\/[a-z]{32}\//);
      expect(workerUrl.endsWith('/background/service-worker.js')).toBe(true);

      const extensionId = new URL(workerUrl).host;
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
        waitUntil: 'domcontentloaded'
      });
      await expect(popupPage.locator('#generate-btn')).toBeVisible({ timeout: 10000 });

      await popupPage.screenshot({
        path: testInfo.outputPath('manual-loaded-popup.png'),
        fullPage: true
      });
    } finally {
      if (context) {
        await context.close();
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
