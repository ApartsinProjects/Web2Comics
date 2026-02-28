const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, relPath), 'utf8'));
}

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-exttest-'));
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
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    } catch (_) {
      worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
      }
    }
  }
  return new URL(worker.url()).host;
}

test.describe('Web2Comics Extension E2E', () => {
  test.describe('Popup Flow', () => {
    test('should load popup with launcher state', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

        await expect(page.locator('.popup-container')).toBeVisible();
        await expect(page.locator('.popup-header')).toBeVisible();
        await expect(page.locator('.logo span')).toHaveText('Web2Comics');

        if (await page.locator('#onboarding-start-btn').isVisible().catch(() => false)) {
          await page.locator('#onboarding-start-btn').click();
        }

        await expect(page.locator('#create-comic-btn')).toBeVisible();
        await expect(page.locator('#view-history-btn')).toBeVisible();
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('should open composer and show provider/style/panel controls', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

        // Ensure advanced customization is visible in this test even under first-run progressive reveal.
        await page.evaluate(async () => {
          await chrome.storage.local.set({ firstSuccessfulGenerationAt: new Date().toISOString() });
        });
        await page.reload({ waitUntil: 'domcontentloaded' });

        if (await page.locator('#onboarding-start-btn').isVisible().catch(() => false)) {
          await page.locator('#onboarding-start-btn').click();
        }
        await page.locator('#create-comic-btn').click();

        await expect(page.locator('#generate-btn')).toBeVisible();
        await expect(page.locator('#wizard-readiness')).toBeVisible();
        await page.locator('#options-extra-section summary').click();
        await expect(page.locator('#panel-count')).toBeVisible();
        await page.locator('#advanced-settings-toggle').click();
        await expect(page.locator('#style-preset')).toBeVisible();
        await expect(page.locator('#provider-preset')).toBeVisible();
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  test.describe('Options Page', () => {
    test('should load options page', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        await expect(page.locator('.options-container')).toBeVisible();
        await expect(page.locator('.options-header h1')).toHaveText('Web2Comics Settings');
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('should have navigation tabs including Prompts', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);

        const navButtons = page.locator('.nav-btn');
        await expect(navButtons).toHaveCount(6);
        await expect(navButtons.nth(0)).toHaveText('General');
        await expect(navButtons.nth(1)).toHaveText('Providers');
        await expect(navButtons.nth(2)).toHaveText('Prompts');
        await expect(navButtons.nth(3)).toHaveText('Storage');
        await expect(navButtons.nth(4)).toHaveText('Connections');
        await expect(navButtons.nth(5)).toHaveText('About');
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('should show current provider cards and OpenAI model selectors', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options/options.html`);
        await page.locator('.nav-btn[data-section="providers"]').click();

        const providerCards = page.locator('.provider-card');
        await expect(providerCards).toHaveCount(5);
        await expect(page.locator('.provider-card[data-provider="openai"]')).toBeVisible();
        await expect(page.locator('.provider-card[data-provider="gemini-free"]')).toBeVisible();
        await expect(page.locator('.provider-card[data-provider="cloudflare-free"]')).toBeVisible();
        await expect(page.locator('.provider-card[data-provider="openrouter"]')).toBeVisible();
        await expect(page.locator('.provider-card[data-provider="huggingface"]')).toBeVisible();

        const openaiCard = page.locator('.provider-card[data-provider="openai"]');
        await expect(openaiCard.locator('#openai-text-model')).toBeVisible();
        await expect(openaiCard.locator('#openai-image-model')).toBeVisible();
        await expect(openaiCard.locator('#openai-image-quality')).toBeVisible();
        await expect(openaiCard.locator('#openai-image-size')).toBeVisible();
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  test.describe('Side Panel', () => {
    test('should load side panel and show Web2Comics header', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

        await expect(page.locator('.viewer-container')).toBeVisible();
        await expect(page.locator('.viewer-header h1')).toHaveText('Web2Comics');
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('should have primary view tabs and history sidebar (no settings/actions sidebar sections)', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('#mode-comic-btn')).toBeVisible();
        await expect(page.locator('#mode-history-btn')).toBeVisible();

        const toggleBtns = page.locator('#comic-view-shell .view-mode-toggle .toggle-btn');
        await expect(toggleBtns).toHaveCount(3);
        await expect(toggleBtns.nth(0)).toHaveText('Strip View');
        await expect(toggleBtns.nth(1)).toHaveText('Carousel');
        await expect(toggleBtns.nth(2)).toHaveText('Panel View');

        const sidebar = page.locator('.sidebar');
        await expect(sidebar).toHaveCount(1);
        await expect(sidebar.locator('h3')).toContainText('History');
        await expect(sidebar.locator('text=Settings')).toHaveCount(0);
        await expect(sidebar.locator('text=Actions')).toHaveCount(0);
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });
});

test.describe('Manifest Validation', () => {
  test('should have valid manifest structure', () => {
    const manifest = readJson('manifest.json');

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Web2Comics');
    expect(manifest.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('contextMenus');
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect(manifest.background.service_worker).toBe('background/service-worker.js');
  });
});

test.describe('File Structure', () => {
  const requiredFiles = [
    'manifest.json',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'sidepanel/sidepanel.html',
    'sidepanel/sidepanel.css',
    'sidepanel/sidepanel.js',
    'options/options.html',
    'options/options.css',
    'options/options.js',
    'background/service-worker.js',
    'content/content-script.js',
    'providers/gemini-provider.js',
    'providers/openai-provider.js',
    'providers/cloudflare-provider.js',
    'shared/types.js'
  ];

  for (const file of requiredFiles) {
    test(`should have ${file}`, () => {
      expect(fs.existsSync(path.join(EXTENSION_PATH, file))).toBe(true);
    });
  }
});
