const { test, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const RUN_CHROME_DIAGNOSTICS = process.env.RUN_CHROME_DIAGNOSTICS === '1';

async function collectChromeInternals(testInfo, context, label) {
  const pages = context.pages().map((page) => page.url());
  await testInfo.attach(`${label}-open-pages.json`, {
    body: Buffer.from(JSON.stringify(pages, null, 2)),
    contentType: 'application/json'
  });

  const versionPage = await context.newPage();
  await versionPage.goto('chrome://version/', { waitUntil: 'domcontentloaded' });
  await versionPage.screenshot({ path: testInfo.outputPath(`${label}-chrome-version.png`), fullPage: true });
  await testInfo.attach(`${label}-chrome-version-url.txt`, {
    body: Buffer.from(versionPage.url()),
    contentType: 'text/plain'
  });

  const extensionsPage = await context.newPage();
  await extensionsPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await extensionsPage.screenshot({ path: testInfo.outputPath(`${label}-chrome-extensions.png`), fullPage: true });
  await testInfo.attach(`${label}-chrome-extensions-url.txt`, {
    body: Buffer.from(extensionsPage.url()),
    contentType: 'text/plain'
  });
}

async function runChromeRegistrationAttempt(testInfo, attempt) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `web2comics-${attempt.name}-`));
  let context;
  const eventLog = [];

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      args: [
        ...attempt.extraArgs,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox'
      ]
    });

    eventLog.push(`chromeVersion=${context.browser()?.version() || 'unknown'}`);
    eventLog.push(`pagesAtLaunch=${context.pages().map((p) => p.url()).join(', ') || '(none)'}`);

    context.on('serviceworker', (worker) => {
      eventLog.push(`serviceworker=${worker.url()}`);
    });

    context.on('page', (page) => {
      eventLog.push(`page=${page.url()}`);
      page.on('console', (msg) => eventLog.push(`console:${msg.type()}:${msg.text()}`));
      page.on('pageerror', (err) => eventLog.push(`pageerror:${err.message}`));
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
      } catch {
        serviceWorker = null;
      }
    }

    if (!serviceWorker) {
      await collectChromeInternals(testInfo, context, attempt.name);
      await testInfo.attach(`${attempt.name}-event-log.txt`, {
        body: Buffer.from(eventLog.join('\n') || '(empty)'),
        contentType: 'text/plain'
      });
      return { ok: false, reason: 'No extension service worker observed within 15s.' };
    }

    const workerUrl = serviceWorker.url();
    const extensionId = new URL(workerUrl).host;
    eventLog.push(`extensionId=${extensionId}`);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForSelector('#generate-btn', { timeout: 10000 });
    eventLog.push('popupLoaded=true');

    await testInfo.attach(`${attempt.name}-event-log.txt`, {
      body: Buffer.from(eventLog.join('\n')),
      contentType: 'text/plain'
    });
    return { ok: true, workerUrl };
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test.describe('Windows Chrome extension diagnostics', () => {
  test.skip(!RUN_CHROME_DIAGNOSTICS, 'Set RUN_CHROME_DIAGNOSTICS=1 to run Chrome diagnostics suite.');
  test('DIAG-CHROME-00: diagnose unpacked extension registration in real Chrome', async ({}, testInfo) => {
    test.setTimeout(90000);

    const attempts = [
      { name: 'baseline', extraArgs: [] },
      {
        name: 'disable-load-extension-switch-flag',
        extraArgs: ['--disable-features=DisableLoadExtensionCommandLineSwitch']
      }
    ];

    const results = [];
    for (const attempt of attempts) {
      results.push({
        name: attempt.name,
        ...(await runChromeRegistrationAttempt(testInfo, attempt))
      });
    }

    await testInfo.attach('attempt-results.json', {
      body: Buffer.from(JSON.stringify(results, null, 2)),
      contentType: 'application/json'
    });

    const success = results.find((r) => r.ok);
    if (!success) {
      throw new Error(
        `Chrome extension registration failed for all attempts: ${results
          .map((r) => `${r.name} (${r.reason})`)
          .join('; ')}`
      );
    }
  });
});
