const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_X_REAL_E2E = process.env.RUN_X_REAL_E2E === '1';
const EXTENSION_PATH = path.resolve(__dirname, '../..');

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-x-real-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });
  return { context, userDataDir };
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  }
  const url = worker.url();
  const match = url.match(/chrome-extension:\/\/([a-z]{32})\//);
  if (!match) throw new Error(`Could not parse extension id from worker url: ${url}`);
  return match[1];
}

test.describe('Real X content-source extraction', () => {
  test.skip(!RUN_X_REAL_E2E, 'Set RUN_X_REAL_E2E=1 to run real X extraction test.');
  test.setTimeout(120000);

  test('extracts readable content from live x.com page via content script message path', async ({}, testInfo) => {
    const { context, userDataDir } = await launchExtensionContext();
    try {
      const extensionId = await getExtensionId(context);
      const sourcePage = await context.newPage();
      await sourcePage.goto('https://x.com/OpenAI', { waitUntil: 'domcontentloaded' });
      await sourcePage.waitForFunction(() => {
        const hasTweetText = document.querySelectorAll('div[data-testid="tweetText"]').length > 0;
        const bodyLen = String(document.body?.innerText || '').trim().length;
        return hasTweetText && bodyLen > 300;
      }, null, { timeout: 30000 }).catch(async () => {
        await sourcePage.waitForTimeout(10000);
      });

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });

      const result = await popupPage.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        const sourceTab = tabs.find((tab) =>
          typeof tab?.url === 'string' && /https:\/\/x\.com\/openai/i.test(tab.url)
        );
        if (!sourceTab?.id) {
          return { ok: false, reason: 'source-tab-not-found', tabs: tabs.map((t) => t.url || '') };
        }

        const response = await chrome.tabs.sendMessage(sourceTab.id, {
          type: 'EXTRACT_CONTENT',
          mode: 'full',
          payload: {}
        });
        return {
          ok: true,
          sourceTabUrl: sourceTab.url,
          response: response || null
        };
      });

      await testInfo.attach('x-content-extract-result.json', {
        body: Buffer.from(JSON.stringify(result, null, 2)),
        contentType: 'application/json'
      });

      expect(result?.ok).toBe(true);
      expect(result?.response?.success).toBe(true);
      expect(String(result?.response?.text || '').length).toBeGreaterThan(160);
      expect(Array.isArray(result?.response?.candidates)).toBe(true);
      expect(result.response.candidates.length).toBeGreaterThan(0);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
