const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadEnv() {
  const p = path.resolve(__dirname, '..', '.env.e2e.local');
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}
loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY || /^REPLACE_WITH_/i.test(GEMINI_API_KEY)) {
  console.error('GEMINI_API_KEY is required for fastest-provider run.');
  process.exit(2);
}

const EXTENSION_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(__dirname, '..', 'samples', 'real-fast-gemini-10sites-2variants-' + new Date().toISOString().replace(/[:.]/g, '-'));
const EXPORT_LAYOUT_PRESET = process.env.SAMPLES_LAYOUT_PRESET || 'polaroid-collage';

const SITES = [
  { category: 'Global News', name: 'CNN', url: 'https://www.cnn.com', language: 'en' },
  { category: 'Public News', name: 'BBC News', url: 'https://www.bbc.com/news', language: 'en' },
  { category: 'Reference', name: 'Wikipedia AI', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence', language: 'en' },
  { category: 'Developer Docs', name: 'MDN JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', language: 'en' },
  { category: 'Open Source Docs', name: 'GitHub Docs', url: 'https://docs.github.com/en/get-started/start-your-journey/about-github-and-git', language: 'en' },
  { category: 'Science', name: 'NASA News', url: 'https://www.nasa.gov/news/all-news/', language: 'en' },
  { category: 'Government', name: 'USA.gov', url: 'https://www.usa.gov', language: 'en' },
  { category: 'Public Radio', name: 'NPR News', url: 'https://www.npr.org/sections/news/', language: 'en' },
  { category: 'Web Engineering', name: 'web.dev', url: 'https://web.dev/articles/browser-level-image-lazy-loading', language: 'es' },
  { category: 'Education', name: 'Khan Academy', url: 'https://www.khanacademy.org', language: 'he' }
];

const VARIANTS = [
  {
    id: 'A',
    label: 'Fact Sprint',
    objective: 'news-recap',
    style: 'newspaper-strip',
    promptTemplates: {
      gemini: {
        storyboard:
          'Create an 8-panel comic storyboard as strict JSON. JSON only.\\n' +
          'Schema: {"title":string,"description":string,"panels":[{"caption":string,"image_prompt":string,"beat_summary":string}]}\\n' +
          'Goal: fast, factual, high-signal summary.\\n' +
          'Use concrete entities, dates, and numbers from content.\\n' +
          'Output language: {{output_language_label}}.\\n' +
          'Source: {{source_title}} ({{source_url}})\\nContent:\\n{{content}}',
        image:
          'Panel {{panel_index}}/{{panel_count}} in concise editorial comic style.\\n' +
          'Caption: {{panel_caption}}\\nSummary: {{panel_summary}}\\n' +
          'Style: {{style_prompt}}\\n' +
          '{{output_language_instruction}}'
      }
    }
  },
  {
    id: 'B',
    label: 'Explain & Learn',
    objective: 'learn-step-by-step',
    style: 'manga',
    promptTemplates: {
      gemini: {
        storyboard:
          'Generate an 8-panel explain-like-tutor comic storyboard in strict JSON only.\\n' +
          'Schema: {"title":string,"description":string,"panels":[{"caption":string,"image_prompt":string,"beat_summary":string}]}\\n' +
          'Panel flow: hook -> context -> key concept -> mechanism -> example -> caveat -> practical tip -> recap.\\n' +
          'Keep each caption short, clear, and grounded in source facts.\\n' +
          'Language: {{output_language_label}}.\\n' +
          'Source: {{source_title}} ({{source_url}})\\nContent:\\n{{content}}',
        image:
          'Educational comic panel {{panel_index}}/{{panel_count}}.\\n' +
          'Teach the idea visually and clearly.\\n' +
          'Caption: {{panel_caption}}\\nSummary: {{panel_summary}}\\n' +
          'Visual style: {{style_prompt}}\\n' +
          '{{output_language_instruction}}'
      }
    }
  }
];

function slug(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  return new URL(worker.url()).host;
}

async function launchContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-fast-gemini-'));
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

async function setStorageForRun(context, extensionId, variant, language) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(async ({ apiKey, variant, language }) => {
    await chrome.storage.local.set({
      onboardingComplete: true,
      apiKeys: { gemini: apiKey },
      promptTemplates: variant.promptTemplates,
      settings: {
        panelCount: 8,
        detailLevel: 'low',
        styleId: variant.style,
        captionLength: 'short',
        activeTextProvider: 'gemini-free',
        activeImageProvider: 'gemini-free',
        geminiTextModel: 'gemini-flash-lite-latest',
        geminiImageModel: 'gemini-2.0-flash-exp-image-generation',
        objective: variant.objective,
        outputLanguage: language,
        autoOpenSidePanel: true
      }
    });
  }, { apiKey: GEMINI_API_KEY, variant, language });
  await p.close();
}

async function getSourceText(page) {
  const text = await page.evaluate(() => {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    return (root?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  });
  return String(text || '');
}

async function runGeneration(context, extensionId, sourcePage, variant, language) {
  await sourcePage.waitForTimeout(2500);
  let text = await getSourceText(sourcePage);
  if (text.length < 150) {
    await sourcePage.waitForTimeout(3500);
    text = await getSourceText(sourcePage);
  }
  if (text.length < 150) text = `Fallback text for ${sourcePage.url()}. ` + 'Context '.repeat(300);

  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });

  const start = await p.evaluate(async ({ text, url, title, variant, language }) => {
    return chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      payload: {
        text,
        url,
        title,
        settings: {
          panel_count: 8,
          detail_level: 'low',
          style_id: variant.style,
          caption_len: 'short',
          provider_text: 'gemini-free',
          provider_image: 'gemini-free',
          text_model: 'gemini-flash-lite-latest',
          image_model: 'gemini-2.0-flash-exp-image-generation',
          objective: variant.objective,
          output_language: language
        }
      }
    });
  }, {
    text: text.slice(0, 22000),
    url: sourcePage.url(),
    title: await sourcePage.title(),
    variant,
    language
  });

  if (!start || !start.success) {
    await p.close();
    throw new Error('START_GENERATION failed');
  }

  const result = await p.evaluate(async () => {
    const timeoutMs = 12 * 60 * 1000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      if (currentJob && ['completed', 'failed', 'canceled'].includes(currentJob.status)) return currentJob;
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  });

  await p.close();
  return result;
}

async function exportPng(context, extensionId, outPng, layoutPreset) {
  const side = await context.newPage();
  try {
    await side.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await side.waitForFunction(() => {
      const btn = document.getElementById('download-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 25000 });

    const appliedLayout = await side.evaluate((requestedLayoutPreset) => {
      const select = document.getElementById('layout-preset-select');
      if (!select || !requestedLayoutPreset) return '';
      const hasOption = Array.from(select.options || []).some((opt) => String(opt.value || '') === String(requestedLayoutPreset));
      if (!hasOption) return String(select.value || '');
      select.value = String(requestedLayoutPreset);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return String(select.value || '');
    }, String(layoutPreset || ''));

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
    const handle = await side.waitForFunction(() => window.__capturedCompositeDownload, null, { timeout: 25000 });
    const captured = await handle.jsonValue();
    const m = String(captured.href || '').match(/^data:image\/png;base64,(.+)$/);
    if (!m) throw new Error('No PNG data url captured');
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.writeFileSync(outPng, Buffer.from(m[1], 'base64'));
    return {
      bytes: fs.statSync(outPng).size,
      downloadName: captured.download || '',
      selectedLayout: appliedLayout || ''
    };
  } finally {
    await side.close();
  }
}

async function collectDiag(context, extensionId) {
  const p = await context.newPage();
  try {
    await p.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    return await p.evaluate(async () => {
      const { currentJob, debugLogs } = await chrome.storage.local.get(['currentJob', 'debugLogs']);
      return { currentJob, debugLogsTail: Array.isArray(debugLogs) ? debugLogs.slice(-80) : [] };
    });
  } finally {
    await p.close();
  }
}

(async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (let siteIndex = 0; siteIndex < SITES.length; siteIndex += 1) {
    const site = SITES[siteIndex];
    for (const variant of VARIANTS) {
      const label = `${String(siteIndex + 1).padStart(2, '0')} ${site.name} / variant ${variant.id}`;
      console.log(`[fast-real] ${label} -> start`);

      const { context, userDataDir } = await launchContext();
      try {
        const extensionId = await getExtensionId(context);
        await setStorageForRun(context, extensionId, variant, site.language);

        const page = await context.newPage();
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 120000 });

        const job = await runGeneration(context, extensionId, page, variant, site.language);
        if (!job || job.status !== 'completed') {
          const diag = await collectDiag(context, extensionId);
          const diagName = `${String(siteIndex + 1).padStart(2, '0')}-${slug(site.name)}-${variant.id.toLowerCase()}-diag.json`;
          fs.writeFileSync(path.join(OUT_DIR, diagName), JSON.stringify(diag, null, 2), 'utf8');
          results.push({
            ok: false,
            site: site.name,
            category: site.category,
            url: site.url,
            language: site.language,
            variant: variant.id,
            objective: variant.objective,
            style: variant.style,
            provider: 'gemini-free',
            error: `status=${job?.status || 'none'}${job?.error ? '; ' + job.error : ''}`,
            diagnostics: `samples/${path.basename(OUT_DIR)}/${diagName}`
          });
          console.log(`[fast-real] ${label} -> FAIL`);
          continue;
        }

        const base = `${String(siteIndex + 1).padStart(2, '0')}-${slug(site.name)}-${variant.id.toLowerCase()}`;
        const pngPath = path.join(OUT_DIR, `${base}.png`);
        const exp = await exportPng(context, extensionId, pngPath, EXPORT_LAYOUT_PRESET);

        const meta = {
          ok: true,
          site: site.name,
          category: site.category,
          url: site.url,
          language: site.language,
          variant: variant.id,
          variantLabel: variant.label,
          objective: variant.objective,
          style: variant.style,
          selectedLayout: exp.selectedLayout || EXPORT_LAYOUT_PRESET,
          provider: 'gemini-free',
          panelCount: Array.isArray(job.storyboard?.panels) ? job.storyboard.panels.length : 0,
          title: String(job.storyboard?.title || ''),
          description: String(job.storyboard?.description || ''),
          output: `samples/${path.basename(OUT_DIR)}/${base}.png`,
          bytes: exp.bytes
        };
        fs.writeFileSync(path.join(OUT_DIR, `${base}.json`), JSON.stringify(meta, null, 2), 'utf8');
        results.push(meta);
        console.log(`[fast-real] ${label} -> OK`);
      } catch (error) {
        results.push({
          ok: false,
          site: site.name,
          category: site.category,
          url: site.url,
          language: site.language,
          variant: variant.id,
          objective: variant.objective,
          style: variant.style,
          provider: 'gemini-free',
          error: error && error.message ? error.message : String(error)
        });
        console.log(`[fast-real] ${label} -> FAIL`);
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: 'real-provider-fastest-gemini',
    constraints: {
      sites: 10,
      englishSites: 8,
      variantsPerSite: 2,
      panelsPerComic: 8,
      exportLayoutPreset: EXPORT_LAYOUT_PRESET,
      provider: 'gemini-free',
      textModel: 'gemini-flash-lite-latest',
      imageModel: 'gemini-2.0-flash-exp-image-generation'
    },
    totalRuns: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const lines = [];
  lines.push('# Real Fast Gemini Samples');
  lines.push('');
  lines.push(`Created: ${manifest.createdAt}`);
  lines.push(`Runs: ${manifest.totalRuns}, Success: ${manifest.success}, Failed: ${manifest.failed}`);
  lines.push('');
  lines.push('| # | Site | Category | Lang | Variant | Objective | Style | Panels | Output | Status |');
  lines.push('|---|------|----------|------|---------|-----------|-------|--------|--------|--------|');
  results.forEach((r, i) => {
    const status = r.ok ? 'OK' : `FAIL: ${String(r.error || '').replace(/\|/g, '/')}`;
    lines.push(`| ${i + 1} | ${r.site} | ${r.category} | ${r.language} | ${r.variant} | ${r.objective} | ${r.style} | ${r.panelCount || 0} | ${r.output || '-'} | ${status} |`);
  });
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), lines.join('\n'), 'utf8');

  console.log(`[fast-real] done: ${manifest.success}/${manifest.totalRuns}`);
  console.log(`[fast-real] output: ${OUT_DIR}`);
  if (manifest.failed > 0) process.exitCode = 2;
})();
