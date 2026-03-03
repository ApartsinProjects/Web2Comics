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

async function openDetailsIfClosed(page, selector) {
  await page.locator(selector).evaluate((el) => {
    if (el instanceof HTMLDetailsElement && !el.open) {
      el.open = true;
    }
  });
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

        if (await page.locator('#onboarding-start-btn').isVisible().catch(() => false)) {
          await page.locator('#onboarding-start-btn').click();
        }
        await page.locator('#create-comic-btn').click();

        await expect(page.locator('#main-section')).toBeVisible();
        await expect(page.locator('#generate-btn')).toBeVisible();
        await expect(page.locator('#wizard-readiness')).toBeVisible();
        await openDetailsIfClosed(page, '#options-extra-section');
        await openDetailsIfClosed(page, '#customize-story-card');
        await openDetailsIfClosed(page, '#customize-images-card');

        await expect(page.locator('#panel-count')).toHaveCount(1);
        await expect(page.locator('#objective')).toHaveCount(1);
        await expect(page.locator('#output-language')).toHaveCount(1);
        await expect(page.locator('#provider-preset')).toHaveCount(1);
        await expect(page.locator('#style-preset')).toHaveCount(1);
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
        await expect(navButtons).toHaveCount(5);
        await expect(navButtons.nth(0)).toHaveText('General');
        await expect(navButtons.nth(1)).toHaveText('Providers');
        await expect(navButtons.nth(2)).toHaveText('Prompts');
        await expect(navButtons.nth(3)).toHaveText('Storage');
        await expect(navButtons.nth(4)).toHaveText('About');
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

        await expect(page.locator('#mode-comic-btn')).toHaveCount(1);
        await expect(page.locator('#mode-history-btn')).toHaveCount(1);
        await expect(page.locator('#layout-preset-select')).toHaveCount(1);
        const presetOptionCount = await page.locator('#layout-preset-select option').count();
        expect(presetOptionCount).toBeGreaterThan(0);

        await expect(page.locator('#sidebar')).toHaveCount(1);
        await expect(page.locator('#sidebar .sidebar-section h3')).toContainText('My Collection');
        await expect(page.locator('#sidebar')).not.toContainText('Settings');
        await expect(page.locator('#sidebar')).not.toContainText('Actions');
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('should show single comic view shell with viewer counters', async () => {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

        await expect(page.locator('#comic-view-shell')).toBeVisible();
        await expect(page.locator('.single-view-label')).toHaveText('Comic View');
        await expect(page.locator('#viewer-stat-comics')).toHaveText('0');
        await expect(page.locator('#viewer-stat-panels')).toHaveText('0');
        await expect(page.locator('#viewer-stat-pages')).toHaveText('0');
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
