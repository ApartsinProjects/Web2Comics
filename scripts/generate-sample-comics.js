const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(__dirname, '..', 'samples', 'site-comics-' + new Date().toISOString().replace(/[:.]/g, '-'));
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zl9kAAAAASUVORK5CYII=';

const SAMPLE_CASES = [
  {
    name: 'CNN Top Stories',
    url: 'https://www.cnn.com',
    objective: 'news-recap',
    style: 'newspaper-strip',
    language: 'en'
  },
  {
    name: 'BBC News',
    url: 'https://www.bbc.com/news',
    objective: 'timeline',
    style: 'noir',
    language: 'de'
  },
  {
    name: 'Wikipedia AI',
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    objective: 'learn-step-by-step',
    style: 'ligne-claire',
    language: 'fr'
  },
  {
    name: 'MDN JavaScript',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    objective: 'study-guide',
    style: 'pixel',
    language: 'es'
  },
  {
    name: 'NPR News',
    url: 'https://www.npr.org/sections/news/',
    objective: 'key-facts',
    style: 'woodcut-print',
    language: 'pt'
  },
  {
    name: 'AP News',
    url: 'https://apnews.com/',
    objective: 'compare-views',
    style: 'superhero',
    language: 'ru'
  },
  {
    name: 'The Guardian',
    url: 'https://www.theguardian.com/international',
    objective: 'debate-map',
    style: 'cyberpunk-neon',
    language: 'he'
  },
  {
    name: 'NASA News',
    url: 'https://www.nasa.gov/news/all-news/',
    objective: 'summarize',
    style: 'watercolor',
    language: 'ja'
  },
  {
    name: 'web.dev',
    url: 'https://web.dev/articles/browser-level-image-lazy-loading',
    objective: 'how-to-guide',
    style: 'manga',
    language: 'zh'
  },
  {
    name: 'GitHub Docs',
    url: 'https://docs.github.com/en/get-started/start-your-journey/about-github-and-git',
    objective: 'explain-like-im-five',
    style: 'clay-stopmotion',
    language: 'auto'
  }
];

function slug(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  return new URL(worker.url()).host;
}

async function installOpenAIMocks(context) {
  let imageCounter = 0;

  await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const userMessage = body.messages?.find((m) => m.role === 'user')?.content || 'content';
    const snippet = String(userMessage).slice(0, 120);
    const storyboard = {
      title: 'Sample Comic Story',
      description: 'Auto-generated sample for site validation',
      panels: [
        { beat_summary: 'Hook', caption: '1. ' + snippet.slice(0, 60), image_prompt: 'Comic opening scene based on source context' },
        { beat_summary: 'Core', caption: '2. Main idea explained clearly.', image_prompt: 'Comic middle scene with key facts' },
        { beat_summary: 'Close', caption: '3. Practical takeaway for reader.', image_prompt: 'Comic ending scene with clear summary' }
      ]
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(storyboard) } }]
      })
    });
  });

  await context.route('https://api.openai.com/v1/images/generations', async (route) => {
    imageCounter += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ url: `https://mock-images.test/panel-${imageCounter}.png` }] })
    });
  });

  await context.route('https://mock-images.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
  });
}

async function setupExtensionStorage(context, extensionId, sampleCase) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ objective, language, style }) => {
    await chrome.storage.local.set({
      onboardingComplete: true,
      apiKeys: { openai: 'sk-test-openai-key' },
      settings: {
        panelCount: 3,
        detailLevel: 'low',
        styleId: style,
        captionLength: 'short',
        activeTextProvider: 'openai',
        activeImageProvider: 'openai',
        characterConsistency: false,
        maxCacheSize: 100,
        autoOpenSidePanel: true,
        textModel: 'gpt-4o-mini',
        imageModel: 'dall-e-2',
        objective: objective,
        outputLanguage: language
      }
    });
  }, { objective: sampleCase.objective, language: sampleCase.language, style: sampleCase.style });
  await page.close();
}

async function getPageText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('article, main, [role="main"]') || document.body;
    return (el?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  });
}

async function startGenerationAndWait(context, extensionId, sourcePage, sampleCase) {
  await sourcePage.waitForTimeout(2500);
  let text = await getPageText(sourcePage);
  if (text.length < 120) {
    await sourcePage.waitForTimeout(2500);
    text = await getPageText(sourcePage);
  }
  if (text.length < 120) text = `Fallback source for ${sampleCase.url}. ` + 'Context '.repeat(100);

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });

  const start = await extensionPage.evaluate(async ({ sourceText, sourceUrl, sourceTitle, objective, language, style }) => {
    return chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      payload: {
        text: sourceText,
        url: sourceUrl,
        title: sourceTitle,
        settings: {
          panel_count: 3,
          detail_level: 'low',
          style_id: style,
          caption_len: 'short',
          provider_text: 'openai',
          provider_image: 'openai',
          objective: objective,
          output_language: language
        }
      }
    });
  }, {
    sourceText: text.slice(0, 5000),
    sourceUrl: sourcePage.url(),
    sourceTitle: await sourcePage.title(),
    objective: sampleCase.objective,
    language: sampleCase.language,
    style: sampleCase.style
  });

  if (!start?.success) throw new Error('START_GENERATION failed');

  const job = await extensionPage.evaluate(async () => {
    const started = Date.now();
    while (Date.now() - started < 60000) {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      if (currentJob && ['completed', 'failed', 'canceled'].includes(currentJob.status)) return currentJob;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  });

  await extensionPage.close();
  return job;
}

async function saveCompositeDownloadFromSidePanel(context, extensionId, outFilePath) {
  const sidePanelPage = await context.newPage();
  try {
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await sidePanelPage.waitForFunction(() => {
      const btn = document.getElementById('download-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    await sidePanelPage.evaluate(() => {
      window.__capturedCompositeDownload = null;
      const proto = HTMLAnchorElement.prototype;
      if (!proto.__webToComicOrigClick) {
        proto.__webToComicOrigClick = proto.click;
        proto.click = function(...args) {
          try {
            if (this && typeof this.download === 'string' && this.download && typeof this.href === 'string' && this.href.startsWith('data:image/png')) {
              window.__capturedCompositeDownload = { href: this.href, download: this.download };
              return;
            }
          } catch (_) {}
          return proto.__webToComicOrigClick.apply(this, args);
        };
      }
    });

    await sidePanelPage.click('#download-btn');
    const captured = await sidePanelPage.waitForFunction(() => window.__capturedCompositeDownload, null, { timeout: 15000 });
    const downloadObj = await captured.jsonValue();
    const dataUrl = String(downloadObj.href || '');
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!match) throw new Error('Composite export did not produce PNG data URL');
    fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
    fs.writeFileSync(outFilePath, Buffer.from(match[1], 'base64'));
    return { bytes: fs.statSync(outFilePath).size, downloadName: downloadObj.download || '' };
  } finally {
    await sidePanelPage.close();
  }
}

async function runCase(sampleCase) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-samples-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  try {
    await installOpenAIMocks(context);
    const extensionId = await getExtensionId(context);
    await setupExtensionStorage(context, extensionId, sampleCase);

    const page = await context.newPage();
    await page.goto(sampleCase.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const job = await startGenerationAndWait(context, extensionId, page, sampleCase);
    if (!job || job.status !== 'completed') {
      throw new Error('Generation failed: ' + JSON.stringify({ status: job?.status, error: job?.error || '' }));
    }

    const fileSlug = slug(sampleCase.name);
    const outPng = path.join(OUT_DIR, `${fileSlug}.png`);
    const exportInfo = await saveCompositeDownloadFromSidePanel(context, extensionId, outPng);

    return {
      ok: true,
      name: sampleCase.name,
      url: sampleCase.url,
      objective: sampleCase.objective,
      style: sampleCase.style,
      language: sampleCase.language,
      panels: Array.isArray(job.storyboard?.panels) ? job.storyboard.panels.length : 0,
      title: String(job.storyboard?.title || ''),
      output: path.relative(path.resolve(__dirname, '..'), outPng).replace(/\\/g, '/'),
      bytes: exportInfo.bytes
    };
  } catch (error) {
    return {
      ok: false,
      name: sampleCase.name,
      url: sampleCase.url,
      objective: sampleCase.objective,
      style: sampleCase.style,
      language: sampleCase.language,
      error: error && error.message ? error.message : String(error)
    };
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

(async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (const sampleCase of SAMPLE_CASES) {
    console.log(`[samples] generating: ${sampleCase.name} -> ${sampleCase.url}`);
    const result = await runCase(sampleCase);
    results.push(result);
    console.log(`[samples] ${sampleCase.name}: ${result.ok ? 'OK' : 'FAIL'}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: 'playwright-extension-mocked-openai',
    outputDir: path.relative(path.resolve(__dirname, '..'), OUT_DIR).replace(/\\/g, '/'),
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const readmeLines = [
    '# Sample Comics (10 Sites)',
    '',
    `Generated at: ${manifest.createdAt}`,
    'Mode: mocked OpenAI provider via extension E2E flow',
    '',
    '| # | Site | Objective | Style | Language | Output | Status |',
    '|---|------|-----------|-------|----------|--------|--------|'
  ];

  results.forEach((r, idx) => {
    const status = r.ok ? 'OK' : `FAIL: ${String(r.error || '').replace(/\|/g, '/')}`;
    const output = r.ok ? r.output : '-';
    readmeLines.push(`| ${idx + 1} | ${r.name} | ${r.objective} | ${r.style} | ${r.language} | ${output} | ${status} |`);
  });
  readmeLines.push('');
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readmeLines.join('\n'), 'utf8');

  console.log(`[samples] done. Success: ${manifest.success}/${manifest.total}`);
  if (manifest.failed > 0) process.exitCode = 2;
})();
