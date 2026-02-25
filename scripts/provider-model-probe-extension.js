const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, '../.env.e2e.local');
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

const EXT_DIR = path.resolve(__dirname, '..');
const OUT_BASE = path.resolve(__dirname, '../test-results/provider-model-probe-extension');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeMessage(err) {
  if (!err) return '';
  return String(err.message || err).slice(0, 1000);
}

function hasValue(v) {
  return !!String(v || '').trim();
}

async function getExtensionId(context) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers()[0];
    if (worker) return new URL(worker.url()).host;
    try {
      const awaited = await context.waitForEvent('serviceworker', { timeout: 5000 });
      if (awaited) return new URL(awaited.url()).host;
    } catch (_) {
      // retry
    }
  }
  throw new Error('Timed out waiting for extension service worker');
}

async function seedCredentials(page) {
  const payload = {
    apiKeys: {},
    cloudflareConfig: {}
  };
  if (hasValue(process.env.OPENAI_API_KEY)) payload.apiKeys.openai = process.env.OPENAI_API_KEY;
  if (hasValue(process.env.GEMINI_API_KEY)) payload.apiKeys.gemini = process.env.GEMINI_API_KEY;
  if (hasValue(process.env.OPENROUTER_API_KEY)) payload.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
  const hf = process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_INFERENCE_API_TOKEN || '';
  if (hasValue(hf)) payload.apiKeys.huggingface = hf;
  if (hasValue(process.env.CLOUDFLARE_API_TOKEN)) payload.apiKeys.cloudflare = process.env.CLOUDFLARE_API_TOKEN;

  payload.cloudflareConfig = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    email: process.env.CLOUDFLARE_EMAIL || '',
    apiKey: process.env.CLOUDFLARE_API_KEY || ''
  };

  await page.evaluate(async (seed) => {
    await chrome.storage.local.set(seed);
  }, payload);
}

async function probeViaExtension(page, providerId, mode, model) {
  const started = Date.now();
  try {
    const response = await page.evaluate(async ({ providerId, mode, model }) => {
      return await chrome.runtime.sendMessage({
        type: 'TEST_PROVIDER_MODEL',
        payload: { providerId, mode, model }
      });
    }, { providerId, mode, model });

    return {
      providerId,
      mode,
      model,
      ok: !!response?.success,
      elapsedMs: Date.now() - started,
      response: response || null,
      error: response?.error || null
    };
  } catch (error) {
    return {
      providerId,
      mode,
      model,
      ok: false,
      elapsedMs: Date.now() - started,
      response: null,
      error: safeMessage(error)
    };
  }
}

function summarize(results) {
  const summary = {};
  for (const r of results) {
    summary[r.providerId] ||= {};
    summary[r.providerId][r.mode] ||= { ok: [], fail: [] };
    if (r.ok) {
      summary[r.providerId][r.mode].ok.push(r.model);
    } else {
      summary[r.providerId][r.mode].fail.push({ model: r.model, error: r.error || r.response?.error || '' });
    }
  }
  return summary;
}

async function main() {
  const stamp = nowStamp();
  const outDir = path.join(OUT_BASE, stamp);
  ensureDir(outDir);

  const matrix = [
    { providerId: 'openai', mode: 'text', models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'] },
    { providerId: 'openai', mode: 'image', models: ['dall-e-2', 'dall-e-3'] },
    { providerId: 'gemini-free', mode: 'text', models: ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'] },
    { providerId: 'gemini-free', mode: 'image', models: ['gemini-2.5-flash-image', 'gemini-2.0-flash-exp-image-generation'] },
    { providerId: 'cloudflare-free', mode: 'text', models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-8b-instruct-fast'] },
    { providerId: 'cloudflare-free', mode: 'image', models: ['@cf/black-forest-labs/flux-1-schnell', '@cf/bytedance/stable-diffusion-xl-lightning'] },
    { providerId: 'openrouter', mode: 'text', models: ['openai/gpt-oss-20b:free', 'google/gemma-3-4b-it:free', 'openrouter/auto'] },
    { providerId: 'openrouter', mode: 'image', models: ['google/gemini-2.5-flash-image-preview', 'google/gemini-2.5-flash-image', 'openai/gpt-image-1'] },
    { providerId: 'huggingface', mode: 'text', models: ['mistralai/Mistral-7B-Instruct-v0.2', 'meta-llama/Llama-3.3-70B-Instruct'] },
    { providerId: 'huggingface', mode: 'image', models: ['black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-xl-base-1.0'] }
  ];

  const userDataDir = path.resolve(__dirname, `../test-results/.pw-provider-probe-ext-${stamp}`);
  ensureDir(userDataDir);

  let context;
  const results = [];
  const startedAt = new Date().toISOString();
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--no-sandbox'
      ]
    });
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await seedCredentials(page);

    for (const group of matrix) {
      for (const model of group.models) {
        process.stdout.write(`[ext-probe] ${group.providerId}/${group.mode}: ${model} ... `);
        const r = await probeViaExtension(page, group.providerId, group.mode, model);
        results.push(r);
        process.stdout.write(`${r.ok ? 'OK' : 'FAIL'} (${r.elapsedMs}ms)\n`);
      }
    }

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      extensionInterface: 'TEST_PROVIDER_MODEL',
      extensionId,
      environment: {
        hasOpenAI: hasValue(process.env.OPENAI_API_KEY),
        hasGemini: hasValue(process.env.GEMINI_API_KEY),
        hasOpenRouter: hasValue(process.env.OPENROUTER_API_KEY),
        hasHuggingFace: hasValue(process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_INFERENCE_API_TOKEN),
        hasCloudflareAccountId: hasValue(process.env.CLOUDFLARE_ACCOUNT_ID),
        hasCloudflareToken: hasValue(process.env.CLOUDFLARE_API_TOKEN)
      },
      results,
      summary: summarize(results)
    };

    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, 'provider-model-probe-extension-results.json'), JSON.stringify(report, null, 2));
    const lines = [];
    for (const [provider, modes] of Object.entries(report.summary)) {
      lines.push(`[${provider}]`);
      for (const [mode, data] of Object.entries(modes)) {
        lines.push(`  ${mode} ok: ${data.ok.join(', ') || '(none)'}`);
        for (const f of data.fail) {
          lines.push(`  ${mode} fail: ${f.model} -> ${String(f.error || '').slice(0, 200)}`);
        }
      }
      lines.push('');
    }
    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, 'provider-model-probe-extension-summary.txt'), lines.join('\n'));
    console.log(`\nExtension-interface probe results written to: ${outDir}`);
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Extension-interface provider probe failed:', error);
  process.exitCode = 1;
});
