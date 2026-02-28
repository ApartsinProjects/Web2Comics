const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const OUT_BASE = path.resolve(EXTENSION_PATH, 'artifacts', 'screenshots');
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zl9kAAAAASUVORK5CYII=';
const TINY_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  }
  return new URL(worker.url()).host;
}

async function clickIfVisible(page, selector) {
  const el = page.locator(selector);
  if (await el.isVisible().catch(() => false)) {
    const enabled = await el.isEnabled().catch(() => false);
    if (!enabled) return false;
    await el.click();
    return true;
  }
  return false;
}

(async () => {
  const runDir = path.join(OUT_BASE, `cnn-ui-${stamp()}`);
  ensureDir(runDir);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-cnn-shots-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1440, height: 960 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  try {
    const extensionId = await getExtensionId(context);

    const cnnPage = await context.newPage();
    await cnnPage.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await cnnPage.waitForTimeout(3000);
    await cnnPage.screenshot({ path: path.join(runDir, '01-cnn-page.png'), fullPage: true });

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 430, height: 920 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1000);
    await popupPage.screenshot({ path: path.join(runDir, '02-popup-home.png'), fullPage: true });

    await clickIfVisible(popupPage, '#create-comic-btn');
    await popupPage.waitForTimeout(1200);
    await popupPage.screenshot({ path: path.join(runDir, '03-popup-create-default.png'), fullPage: true });

    await clickIfVisible(popupPage, '#content-extra-section summary');
    await popupPage.waitForTimeout(800);
    await popupPage.screenshot({ path: path.join(runDir, '04-popup-source-expanded.png'), fullPage: true });

    await clickIfVisible(popupPage, '#story-picker-btn');
    await popupPage.waitForTimeout(500);
    await popupPage.screenshot({ path: path.join(runDir, '05-popup-story-picker.png'), fullPage: true });
    await clickIfVisible(popupPage, '#close-story-picker-btn');

    await clickIfVisible(popupPage, '#options-extra-section summary');
    await popupPage.waitForTimeout(500);
    await clickIfVisible(popupPage, '#advanced-settings-toggle');
    await popupPage.waitForTimeout(500);
    await popupPage.screenshot({ path: path.join(runDir, '06-popup-customize-expanded.png'), fullPage: true });

    await clickIfVisible(popupPage, '#history-btn');
    await popupPage.waitForTimeout(500);
    await popupPage.screenshot({ path: path.join(runDir, '07-popup-history-modal.png'), fullPage: true });
    await clickIfVisible(popupPage, '#close-history-btn');

    const optionsPage = await context.newPage();
    await optionsPage.setViewportSize({ width: 1400, height: 1000 });
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`, { waitUntil: 'domcontentloaded' });
    await optionsPage.waitForTimeout(800);
    await optionsPage.screenshot({ path: path.join(runDir, '08-options-general.png'), fullPage: true });

    const optionTabs = [
      ['providers', '09-options-providers.png'],
      ['prompts', '10-options-prompts.png'],
      ['storage', '11-options-storage.png'],
      ['connections', '12-options-connections.png'],
      ['about', '13-options-about.png']
    ];
    for (const [tab, file] of optionTabs) {
      await optionsPage.locator(`.nav-btn[data-section="${tab}"]`).click();
      await optionsPage.waitForTimeout(600);
      await optionsPage.screenshot({ path: path.join(runDir, file), fullPage: true });
    }

    const mockStoryboard = {
      title: 'CNN Highlights as Comic',
      source: {
        title: 'CNN - Latest News, Breaking News and Videos',
        url: 'https://www.cnn.com'
      },
      settings: { provider_text: 'gemini-free', provider_image: 'gemini-free' },
      panels: [
        {
          caption: 'Top story summary from CNN front page.',
          beat_summary: 'Headline and key context',
          image_prompt: 'Newsroom scene',
          artifacts: { image_blob_ref: TINY_DATA_URL },
          facts_used: { entities: ['CNN', 'Breaking news'], dates: ['Today'], numbers: ['3 key points'], source_snippet: 'Top headline and context extracted from CNN homepage.' }
        },
        {
          caption: 'Main developments and what changed.',
          beat_summary: 'Developments',
          image_prompt: 'Timeline panel',
          artifacts: { image_blob_ref: TINY_DATA_URL },
          facts_used: { entities: ['US', 'Global'], dates: ['This week'], numbers: ['2 updates'], source_snippet: 'Developments summarized from article sections.' }
        },
        {
          caption: 'What to watch next and why it matters.',
          beat_summary: 'Outlook',
          image_prompt: 'Future outlook',
          artifacts: { image_blob_ref: TINY_DATA_URL },
          facts_used: { entities: ['Analysts'], dates: ['Next 24 hours'], numbers: ['1 major risk'], source_snippet: 'Forward-looking notes from source text.' }
        }
      ]
    };

    const historyItems = [
      {
        id: `comic-${Date.now()}`,
        sourceTitle: 'CNN - Latest News, Breaking News and Videos',
        sourceUrl: 'https://www.cnn.com',
        createdAt: new Date().toISOString(),
        storyboard: mockStoryboard,
        thumbnail: TINY_DATA_URL,
        settings: { provider_text: 'gemini-free', provider_image: 'gemini-free' }
      },
      {
        id: `comic-${Date.now() + 1}`,
        sourceTitle: 'CNN Politics',
        sourceUrl: 'https://www.cnn.com/politics',
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        storyboard: mockStoryboard,
        settings: { provider_text: 'openai', provider_image: 'openai' }
      }
    ];

    const sidepanelStatePage = await context.newPage();
    await sidepanelStatePage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await sidepanelStatePage.evaluate(async ({ historyItems, storyboard }) => {
      await chrome.storage.local.set({
        history: historyItems,
        selectedHistoryComicId: historyItems[0].id,
        currentJob: {
          id: historyItems[0].id,
          status: 'completed',
          sourceTitle: historyItems[0].sourceTitle,
          sourceUrl: historyItems[0].sourceUrl,
          storyboard,
          settings: historyItems[0].settings,
          createdAt: historyItems[0].createdAt,
          completedAt: new Date().toISOString()
        }
      });
    }, { historyItems, storyboard: mockStoryboard });
    await sidepanelStatePage.close();

    const sidepanelPage = await context.newPage();
    await sidepanelPage.setViewportSize({ width: 1600, height: 980 });
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await sidepanelPage.waitForTimeout(1500);
    await sidepanelPage.evaluate(async ({ historyItems, storyboard }) => {
      const viewer = window.__sidepanelViewer;
      if (viewer) {
        await chrome.storage.local.set({ history: historyItems });
        await viewer.loadHistory();
        viewer.currentComicId = historyItems[0] && historyItems[0].id ? String(historyItems[0].id) : '';
        viewer.displayComic(storyboard);
        viewer.updateViewerStats();
      }
    }, { historyItems, storyboard: mockStoryboard });
    await sidepanelPage.waitForTimeout(500);
    await sidepanelPage.screenshot({ path: path.join(runDir, '14-sidepanel-comic-view.png'), fullPage: true });

    await clickIfVisible(sidepanelPage, '#share-btn');
    await sidepanelPage.waitForTimeout(300);
    await sidepanelPage.screenshot({ path: path.join(runDir, '15-sidepanel-share-menu.png'), fullPage: true });

    await clickIfVisible(sidepanelPage, '#mode-history-btn');
    await sidepanelPage.waitForTimeout(600);
    await sidepanelPage.screenshot({ path: path.join(runDir, '16-sidepanel-history-mode.png'), fullPage: true });

    await clickIfVisible(sidepanelPage, '#open-tab-btn');
    await sidepanelPage.waitForTimeout(800);
    const pages = context.pages();
    const fullTab = pages.find((p) => p.url().includes('/sidepanel/sidepanel.html') && p !== sidepanelPage && p !== popupPage && p !== optionsPage && p !== cnnPage);
    if (fullTab) {
      await fullTab.waitForTimeout(800);
      await fullTab.screenshot({ path: path.join(runDir, '17-full-tab-viewer.png'), fullPage: true });
      await fullTab.close().catch(() => {});
    }

    const manifest = {
      capturedAt: new Date().toISOString(),
      extensionId,
      source: 'https://www.cnn.com',
      outputDir: runDir,
      files: fs.readdirSync(runDir).sort()
    };
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(JSON.stringify({ ok: true, outputDir: runDir, files: manifest.files }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
