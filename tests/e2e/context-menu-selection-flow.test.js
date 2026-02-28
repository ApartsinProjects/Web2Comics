const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-context-menu-e2e-'));
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

async function getServiceWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (worker) return worker;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch (_) {
      worker = context.serviceWorkers()[0];
    }
    if (worker) return worker;
    const wakePage = await context.newPage();
    await wakePage.goto('about:blank');
    await wakePage.close();
    worker = context.serviceWorkers()[0];
    if (worker) return worker;
  }

  throw new Error('Service worker did not start for extension context');
}

async function getExtensionId(worker) {
  return new URL(worker.url()).host;
}

test.describe('Context menu selection flow E2E', () => {
  test.setTimeout(120000);

  test('right-click generate action starts generation from selected text', async () => {
    const { context, userDataDir } = await launchExtensionContext();
    try {
      const worker = await getServiceWorker(context);

      const selectedText = 'Context menu selected text for instant generate path.';
      const triggerResult = await worker.evaluate(async ({ selectedText }) => {
        return globalThis.__WEB2COMICS_E2E__.triggerSelectionMenuGenerate(
          { selectionText: selectedText },
          { url: 'https://example.com/article', title: 'Example Article', windowId: 1 }
        );
      }, { selectedText });

      expect(triggerResult).toBeTruthy();
      expect(triggerResult.started).toBe(true);

      const currentJob = await worker.evaluate(async () => {
        const result = await chrome.storage.local.get('currentJob');
        return result.currentJob || null;
      });

      expect(currentJob).toBeTruthy();
      expect(currentJob.extractedText).toContain(selectedText);
      expect(currentJob.sourceUrl).toBe('https://example.com/article');
      expect(currentJob.sourceTitle).toBe('Example Article');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('right-click open-composer action prepopulates selected text in popup', async () => {
    const { context, userDataDir } = await launchExtensionContext();
    try {
      const worker = await getServiceWorker(context);
      const extensionId = await getExtensionId(worker);

      const selectedText = 'Context menu selected text for open composer path.';
      const triggerResult = await worker.evaluate(async ({ selectedText }) => {
        return globalThis.__WEB2COMICS_E2E__.triggerSelectionMenuOpenComposer(
          { selectionText: selectedText },
          { url: 'https://example.com/wiki', title: 'Example Wiki', windowId: 1 },
          { skipOpenPopup: true }
        );
      }, { selectedText });

      expect(triggerResult).toBeTruthy();
      expect(triggerResult.opened).toBe(true);

      const pendingBeforePopup = await worker.evaluate(async () => {
        const result = await chrome.storage.local.get('pendingComposerPrefill');
        return result.pendingComposerPrefill || null;
      });
      expect(pendingBeforePopup).toBeTruthy();
      expect(String(pendingBeforePopup.text || '')).toContain(selectedText);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });

      await expect(popup.locator('#main-section')).toBeVisible();
      await expect(popup.locator('input[name="contentSource"][value="selection"]')).toBeChecked();
      await expect(popup.locator('#preview-text')).toContainText('Context menu selected text for open composer path.');

      const pendingAfterPopup = await worker.evaluate(async () => {
        const result = await chrome.storage.local.get('pendingComposerPrefill');
        return result.pendingComposerPrefill || null;
      });
      expect(pendingAfterPopup).toBeNull();
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
