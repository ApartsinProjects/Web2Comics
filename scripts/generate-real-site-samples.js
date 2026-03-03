const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env.e2e.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    process.env[key] = value;
  }
}
loadLocalEnvFile();

function hasReal(value, invalids = []) {
  if (!value) return false;
  if (/^REPLACE_WITH_/i.test(value)) return false;
  return !invalids.includes(String(value));
}

const KEYS = {
  openai: process.env.OPENAI_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
  openrouter: process.env.OPENROUTER_API_KEY || '',
  huggingface: process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_INFERENCE_API_TOKEN || '',
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  cloudflareEmail: process.env.CLOUDFLARE_EMAIL || '',
  cloudflareApiKey: process.env.CLOUDFLARE_API_KEY || ''
};

const providerAvailable = {
  openai: hasReal(KEYS.openai, ['sk-test-openai-key']),
  'gemini-free': hasReal(KEYS.gemini),
  openrouter: hasReal(KEYS.openrouter),
  huggingface: hasReal(KEYS.huggingface, ['hf_test_key']),
  'cloudflare-free': hasReal(KEYS.cloudflareAccountId) && (hasReal(KEYS.cloudflareApiToken) || (hasReal(KEYS.cloudflareEmail) && hasReal(KEYS.cloudflareApiKey)))
};

const activeProviders = Object.entries(providerAvailable).filter(([, ok]) => ok).map(([id]) => id);
if (!activeProviders.length) {
  console.error('No real providers configured.');
  process.exit(2);
}

const EXTENSION_PATH = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.resolve(__dirname, '..', 'samples', `real-provider-site-comics-${stamp}`);

const CASES = [
  { category: 'Global News', name: 'CNN', url: 'https://www.cnn.com', objective: 'news-recap', style: 'newspaper-strip', language: 'en' },
  { category: 'Public News', name: 'BBC News', url: 'https://www.bbc.com/news', objective: 'timeline', style: 'noir', language: 'de' },
  { category: 'Reference', name: 'Wikipedia AI', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence', objective: 'learn-step-by-step', style: 'ligne-claire', language: 'fr' },
  { category: 'Developer Docs', name: 'MDN JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', objective: 'study-guide', style: 'pixel', language: 'es' },
  { category: 'Open Source Docs', name: 'GitHub Docs', url: 'https://docs.github.com/en/get-started/start-your-journey/about-github-and-git', objective: 'how-to-guide', style: 'manga', language: 'ja' },
  { category: 'Science', name: 'NASA News', url: 'https://www.nasa.gov/news/all-news/', objective: 'summarize', style: 'watercolor', language: 'pt' },
  { category: 'Government', name: 'USA.gov', url: 'https://www.usa.gov', objective: 'key-facts', style: 'woodcut-print', language: 'ru' },
  { category: 'Public Radio', name: 'NPR News', url: 'https://www.npr.org/sections/news/', objective: 'compare-views', style: 'superhero', language: 'he' },
  { category: 'Web Engineering', name: 'web.dev Lazy Loading', url: 'https://web.dev/articles/browser-level-image-lazy-loading', objective: 'debate-map', style: 'cyberpunk-neon', language: 'zh' },
  { category: 'Education', name: 'Khan Academy', url: 'https://www.khanacademy.org', objective: 'explain-like-im-five', style: 'clay-stopmotion', language: 'auto' }
];

function slug(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function resolveImageProvider(textProvider) {
  if (textProvider === 'openrouter') {
    if (providerAvailable.openai) return 'openai';
    if (providerAvailable['cloudflare-free']) return 'cloudflare-free';
    if (providerAvailable['gemini-free']) return 'gemini-free';
  }
  if (textProvider === 'huggingface' && !providerAvailable.huggingface) {
    return providerAvailable.openai ? 'openai' : textProvider;
  }
  return textProvider;
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  return new URL(worker.url()).host;
}

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-real-samples-'));
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

async function setupStorage(context, extensionId, item) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  const imageProvider = resolveImageProvider(item.provider_text);
  await p.evaluate(async (payload) => {
    const apiKeys = {};
    if (payload.keys.openai) apiKeys.openai = payload.keys.openai;
    if (payload.keys.gemini) apiKeys.gemini = payload.keys.gemini;
    if (payload.keys.openrouter) apiKeys.openrouter = payload.keys.openrouter;
    if (payload.keys.huggingface) apiKeys.huggingface = payload.keys.huggingface;
    if (payload.keys.cloudflareApiToken) apiKeys.cloudflare = payload.keys.cloudflareApiToken;

    await chrome.storage.local.set({
      onboardingComplete: true,
      apiKeys,
      cloudflareConfig: {
        accountId: payload.keys.cloudflareAccountId || '',
        apiToken: payload.keys.cloudflareApiToken || '',
        email: payload.keys.cloudflareEmail || '',
        apiKey: payload.keys.cloudflareApiKey || ''
      },
      settings: {
        panelCount: 3,
        detailLevel: 'low',
        styleId: payload.style,
        captionLength: 'short',
        activeTextProvider: payload.providerText,
        activeImageProvider: payload.providerImage,
        characterConsistency: false,
        maxCacheSize: 100,
        autoOpenSidePanel: true,
        objective: payload.objective,
        outputLanguage: payload.language
      }
    });
  }, {
    keys: KEYS,
    style: item.style,
    objective: item.objective,
    language: item.language,
    providerText: item.provider_text,
    providerImage: imageProvider
  });
  await p.close();
}

async function getPageText(page) {
  const text = await page.evaluate(() => {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    return (root?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  });
  return String(text || '');
}

async function startGenerationAndWait(context, extensionId, sourcePage, item) {
  await sourcePage.waitForTimeout(2000);
  let sourceText = await getPageText(sourcePage);
  if (sourceText.length < 120) {
    await sourcePage.waitForTimeout(4000);
    sourceText = await getPageText(sourcePage);
  }
  if (sourceText.length < 120) {
    sourceText = `Fallback source text for ${item.url}. ` + 'Context '.repeat(120);
  }

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });

  const imageProvider = resolveImageProvider(item.provider_text);
  const startResult = await extensionPage.evaluate(async (payload) => {
    return chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      payload: {
        text: payload.text,
        url: payload.url,
        title: payload.title,
        settings: {
          panel_count: 3,
          detail_level: 'low',
          style_id: payload.style,
          caption_len: 'short',
          provider_text: payload.providerText,
          provider_image: payload.providerImage,
          objective: payload.objective,
          output_language: payload.language
        }
      }
    });
  }, {
    text: sourceText.slice(0, 12000),
    url: sourcePage.url(),
    title: await sourcePage.title(),
    style: item.style,
    providerText: item.provider_text,
    providerImage: imageProvider,
    objective: item.objective,
    language: item.language
  });

  if (!startResult || !startResult.success) {
    await extensionPage.close();
    throw new Error('START_GENERATION failed');
  }

  const currentJob = await extensionPage.evaluate(async () => {
    const timeoutMs = 8 * 60 * 1000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      if (currentJob && ['completed', 'failed', 'canceled'].includes(currentJob.status)) return currentJob;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  });

  await extensionPage.close();
  return currentJob;
}

async function exportFromSidePanel(context, extensionId, outPngPath) {
  const side = await context.newPage();
  try {
    await side.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await side.waitForFunction(() => {
      const btn = document.getElementById('download-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 20000 });

    await side.evaluate(() => {
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

    await side.click('#download-btn');
    const captured = await side.waitForFunction(() => window.__capturedCompositeDownload, null, { timeout: 20000 });
    const downloadObj = await captured.jsonValue();
    const dataUrl = String(downloadObj.href || '');
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!match) throw new Error('Did not capture PNG data URL from download');
    fs.mkdirSync(path.dirname(outPngPath), { recursive: true });
    fs.writeFileSync(outPngPath, Buffer.from(match[1], 'base64'));
    return { bytes: fs.statSync(outPngPath).size, downloadName: downloadObj.download || '' };
  } finally {
    await side.close();
  }
}

async function collectDiagnostics(context, extensionId) {
  const p = await context.newPage();
  try {
    await p.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    return await p.evaluate(async () => {
      const { currentJob, debugLogs, history } = await chrome.storage.local.get(['currentJob', 'debugLogs', 'history']);
      return {
        currentJob,
        historyCount: Array.isArray(history) ? history.length : 0,
        debugLogsTail: Array.isArray(debugLogs) ? debugLogs.slice(-40) : []
      };
    });
  } finally {
    await p.close();
  }
}

(async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const providersRoundRobin = activeProviders.slice();
  const runList = CASES.map((item, idx) => ({
    ...item,
    provider_text: providersRoundRobin[idx % providersRoundRobin.length]
  }));

  const results = [];
  console.log('[real-samples] active providers:', activeProviders.join(', '));

  for (let i = 0; i < runList.length; i++) {
    const item = runList[i];
    console.log(`[real-samples] ${i + 1}/${runList.length} ${item.name} (${item.category}) provider=${item.provider_text}`);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      const extensionId = await getExtensionId(context);
      await setupStorage(context, extensionId, item);

      const page = await context.newPage();
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 120000 });

      const job = await startGenerationAndWait(context, extensionId, page, item);
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectDiagnostics(context, extensionId);
        const errPath = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${slug(item.name)}-diagnostics.json`);
        fs.writeFileSync(errPath, JSON.stringify(diagnostics, null, 2), 'utf8');
        results.push({
          ok: false,
          ...item,
          provider_image: resolveImageProvider(item.provider_text),
          error: `Generation status: ${job?.status || 'none'}${job?.error ? ' | ' + job.error : ''}`,
          diagnostics: path.relative(path.resolve(__dirname, '..'), errPath).replace(/\\/g, '/')
        });
        continue;
      }

      const fileBase = `${String(i + 1).padStart(2, '0')}-${slug(item.name)}`;
      const outPng = path.join(OUT_DIR, `${fileBase}.png`);
      const exportInfo = await exportFromSidePanel(context, extensionId, outPng);

      const meta = {
        storyTitle: String(job.storyboard?.title || ''),
        storyDescription: String(job.storyboard?.description || ''),
        panelCount: Array.isArray(job.storyboard?.panels) ? job.storyboard.panels.length : 0,
        sourceUrl: item.url,
        sourceTitle: item.name,
        providerText: item.provider_text,
        providerImage: resolveImageProvider(item.provider_text),
        objective: item.objective,
        language: item.language,
        style: item.style,
        bytes: exportInfo.bytes,
        output: path.relative(path.resolve(__dirname, '..'), outPng).replace(/\\/g, '/')
      };
      fs.writeFileSync(path.join(OUT_DIR, `${fileBase}.json`), JSON.stringify(meta, null, 2), 'utf8');

      results.push({ ok: true, ...meta, category: item.category, name: item.name });
    } catch (error) {
      results.push({
        ok: false,
        ...item,
        provider_image: resolveImageProvider(item.provider_text),
        error: error && error.message ? error.message : String(error)
      });
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: 'real-providers-extension-run',
    providersAvailable: providerAvailable,
    activeProviders,
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const readme = [];
  readme.push('# Real Provider Sample Comics');
  readme.push('');
  readme.push(`Created at: ${manifest.createdAt}`);
  readme.push(`Total: ${manifest.total}, Success: ${manifest.success}, Failed: ${manifest.failed}`);
  readme.push('');
  readme.push('| # | Category | Site | Text Provider | Image Provider | Objective | Style | Lang | Output | Status |');
  readme.push('|---|----------|------|---------------|----------------|-----------|-------|------|--------|--------|');
  results.forEach((r, idx) => {
    const output = r.output || '-';
    const status = r.ok ? 'OK' : `FAIL: ${String(r.error || '').replace(/\|/g, '/')}`;
    readme.push(`| ${idx + 1} | ${r.category || '-'} | ${r.name || r.sourceTitle || '-'} | ${r.providerText || r.provider_text || '-'} | ${r.providerImage || r.provider_image || '-'} | ${r.objective || '-'} | ${r.style || '-'} | ${r.language || '-'} | ${output} | ${status} |`);
  });
  readme.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme.join('\n'), 'utf8');

  console.log(`[real-samples] done: ${manifest.success}/${manifest.total} successful`);
  console.log(`[real-samples] output: ${OUT_DIR}`);

  if (manifest.failed > 0) {
    process.exitCode = 2;
  }
})();
