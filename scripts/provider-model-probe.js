const fs = require('fs');
const path = require('path');

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_INFERENCE_API_TOKEN || '';
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL || '';
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY || '';

const TIMEOUT_MS = 60000;

function ts() {
  return new Date().toISOString();
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error || ''),
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 4).join('\n') : undefined
  };
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const err = new Error(`${label || 'request'} timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
    Promise.resolve(promise).then((value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }, (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function fetchJsonWithTimeout(url, init, label) {
  const res = await withTimeout(fetch(url, init), TIMEOUT_MS, label);
  let bodyText = '';
  let json = null;
  try {
    bodyText = await res.text();
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {}
  return { res, json, bodyText };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function resultOk(extra = {}) {
  return { ok: true, ...extra };
}

function resultFail(extra = {}) {
  return { ok: false, ...extra };
}

async function probeOpenAIText(model) {
  if (!OPENAI_API_KEY) return resultFail({ skipped: true, reason: 'OPENAI_API_KEY missing' });
  try {
    const { res, json, bodyText } = await fetchJsonWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8
      })
    }, `OpenAI text ${model}`);
    if (!res.ok) {
      return resultFail({
        status: res.status,
        error: json?.error?.message || bodyText.slice(0, 500)
      });
    }
    return resultOk({
      status: res.status,
      output: json?.choices?.[0]?.message?.content || ''
    });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function probeOpenAIImage(model) {
  if (!OPENAI_API_KEY) return resultFail({ skipped: true, reason: 'OPENAI_API_KEY missing' });
  try {
    const body = {
      model,
      prompt: 'Tiny comic-style icon: smiling robot face, cyan outline, white background',
      n: 1
    };
    if (model === 'dall-e-2') {
      body.size = '256x256';
    } else {
      body.size = '1024x1024';
      body.quality = 'standard';
    }
    const { res, json, bodyText } = await fetchJsonWithTimeout('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, `OpenAI image ${model}`);
    if (!res.ok) {
      return resultFail({
        status: res.status,
        error: json?.error?.message || bodyText.slice(0, 500)
      });
    }
    const item = json?.data?.[0];
    return resultOk({
      status: res.status,
      hasB64: !!item?.b64_json,
      hasUrl: !!item?.url
    });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function probeGeminiText(model) {
  if (!GEMINI_API_KEY) return resultFail({ skipped: true, reason: 'GEMINI_API_KEY missing' });
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const { res, json, bodyText } = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: ok' }] }],
        generationConfig: { maxOutputTokens: 8 }
      })
    }, `Gemini text ${model}`);
    if (!res.ok) {
      return resultFail({ status: res.status, error: json?.error?.message || bodyText.slice(0, 500) });
    }
    const output = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ') || '';
    return resultOk({ status: res.status, output });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function probeGeminiImage(model) {
  if (!GEMINI_API_KEY) return resultFail({ skipped: true, reason: 'GEMINI_API_KEY missing' });
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const { res, json, bodyText } = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Create a tiny comic icon of a smiling robot head, no text' }] }],
        generationConfig: { maxOutputTokens: 1024, responseModalities: ['image', 'text'] }
      })
    }, `Gemini image ${model}`);
    if (!res.ok) {
      return resultFail({ status: res.status, error: json?.error?.message || bodyText.slice(0, 500) });
    }
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p?.inlineData?.data);
    return resultOk({ status: res.status, hasInlineImage: !!imagePart });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

function cloudflareHeaders() {
  if (CLOUDFLARE_API_TOKEN) {
    return { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
  }
  if (CLOUDFLARE_EMAIL && CLOUDFLARE_API_KEY) {
    return {
      'X-Auth-Email': CLOUDFLARE_EMAIL,
      'X-Auth-Key': CLOUDFLARE_API_KEY,
      'Content-Type': 'application/json'
    };
  }
  return null;
}

async function probeCloudflareModel(model, body, label) {
  if (!CLOUDFLARE_ACCOUNT_ID) return resultFail({ skipped: true, reason: 'CLOUDFLARE_ACCOUNT_ID missing' });
  const headers = cloudflareHeaders();
  if (!headers) return resultFail({ skipped: true, reason: 'Cloudflare auth missing' });
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
    const { res, json, bodyText } = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }, `Cloudflare ${label} ${model}`);
    if (!res.ok || (json && json.success === false)) {
      const err = (json?.errors && json.errors.map((e) => e.message || JSON.stringify(e)).join('; ')) || json?.result?.error || bodyText.slice(0, 500);
      return resultFail({ status: res.status, error: err });
    }
    return resultOk({ status: res.status, result: json?.result || null });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function probeOpenRouterText(model) {
  if (!OPENROUTER_API_KEY) return resultFail({ skipped: true, reason: 'OPENROUTER_API_KEY missing' });
  try {
    const { res, json, bodyText } = await fetchJsonWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://web2comics.local',
        'X-Title': 'Web2Comics'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8
      })
    }, `OpenRouter text ${model}`);
    if (!res.ok) {
      return resultFail({
        status: res.status,
        error: json?.error?.message || json?.error?.metadata?.raw || json?.message || bodyText.slice(0, 500)
      });
    }
    const msg = json?.choices?.[0]?.message || {};
    return resultOk({ status: res.status, output: msg.content || msg.reasoning || '' });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function probeHuggingFaceText(model) {
  if (!HUGGINGFACE_API_KEY) return resultFail({ skipped: true, reason: 'HUGGINGFACE_API_KEY missing' });
  try {
    const { res, json, bodyText } = await fetchJsonWithTimeout('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 16
      })
    }, `HuggingFace text ${model}`);
    if (!res.ok) {
      return resultFail({
        status: res.status,
        error: (typeof json?.error === 'string' ? json.error : json?.message || bodyText.slice(0, 500))
      });
    }
    return resultOk({ status: res.status, output: json?.choices?.[0]?.message?.content || '' });
  } catch (error) {
    return resultFail({ error: safeError(error).message });
  }
}

async function runProbeGroup(provider, mode, models, fn) {
  const results = [];
  for (const model of models) {
    const startedAt = Date.now();
    process.stdout.write(`[probe] ${provider}/${mode}: ${model} ... `);
    const result = await fn(model);
    result.model = model;
    result.startedAt = new Date(startedAt).toISOString();
    result.elapsedMs = Date.now() - startedAt;
    results.push(result);
    process.stdout.write(`${result.ok ? 'OK' : 'FAIL'} (${result.elapsedMs}ms)\n`);
  }
  return results;
}

function summarizeSupport(report) {
  const summary = {};
  for (const [provider, providerData] of Object.entries(report.providers)) {
    summary[provider] = {};
    for (const [mode, entries] of Object.entries(providerData)) {
      const supported = entries.filter((e) => e.ok).map((e) => e.model);
      const unsupported = entries.filter((e) => !e.ok && !e.skipped).map((e) => ({ model: e.model, error: e.error || e.reason || '' }));
      const skipped = entries.filter((e) => e.skipped).map((e) => e.model);
      summary[provider][mode] = { supported, unsupported, skipped };
    }
  }
  return summary;
}

function firstSupported(entries, fallback = '') {
  return (Array.isArray(entries) ? entries.find((e) => e && e.ok) : null)?.model || fallback;
}

function buildRecommendedModelSet(report, outDir) {
  const providers = report.providers || {};
  const recommended = {
    schemaVersion: '1.0',
    generatedAt: ts(),
    sourceReportPath: path.relative(path.resolve(__dirname, '..'), path.join(outDir, 'provider-model-probe-results.json')).replace(/\\/g, '/'),
    sourceSummaryPath: path.relative(path.resolve(__dirname, '..'), path.join(outDir, 'provider-model-probe-summary.txt')).replace(/\\/g, '/'),
    providers: {
      openai: {
        text: firstSupported(providers.openai?.text, 'gpt-4o-mini'),
        image: firstSupported((providers.openai?.image || []).filter((e) => e.model !== 'dall-e-2'), 'dall-e-3')
      },
      gemini: {
        text: firstSupported(providers.gemini?.text, 'gemini-2.5-flash'),
        image: firstSupported((providers.gemini?.image || []).filter((e) => e.model !== 'gemini-2.0-flash'), 'gemini-2.5-flash-image')
      },
      cloudflare: {
        text: firstSupported(providers.cloudflare?.text, '@cf/meta/llama-3.1-8b-instruct'),
        image: firstSupported((providers.cloudflare?.image || []).filter((e) => !String(e.model || '').includes('flux-1-dev')), '@cf/black-forest-labs/flux-1-schnell')
      },
      openrouter: {
        text: firstSupported((providers.openrouter?.text || []).filter((e) => e.model !== 'qwen/qwen3-4b:free'), 'openai/gpt-oss-20b:free')
      },
      huggingface: {
        text: firstSupported((providers.huggingface?.text || []).filter((e) => e.model !== 'HuggingFaceH4/zephyr-7b-beta'), 'mistralai/Mistral-7B-Instruct-v0.2')
      }
    }
  };

  recommended.settings = {
    textModel: recommended.providers.openai.text,
    imageModel: recommended.providers.openai.image,
    geminiTextModel: recommended.providers.gemini.text,
    geminiImageModel: recommended.providers.gemini.image,
    cloudflareTextModel: recommended.providers.cloudflare.text,
    cloudflareImageModel: recommended.providers.cloudflare.image,
    openrouterTextModel: recommended.providers.openrouter.text,
    huggingfaceTextModel: recommended.providers.huggingface.text
  };
  return recommended;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const writeRecommended = args.has('--recommend') || args.has('--mode=recommend');
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../test-results/provider-model-probe', stamp);
  ensureDir(outDir);

  const modelMatrix = {
    openai: {
      text: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      image: ['dall-e-2', 'dall-e-3']
    },
    gemini: {
      text: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'],
      image: ['gemini-2.0-flash-exp-image-generation', 'gemini-2.0-flash', 'gemini-2.5-flash-image']
    },
    cloudflare: {
      text: [
        '@cf/meta/llama-3.1-8b-instruct',
        '@cf/meta/llama-3.1-8b-instruct-fast',
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        '@cf/google/gemma-3-12b-it'
      ],
      image: [
        '@cf/black-forest-labs/flux-1-schnell',
        '@cf/bytedance/stable-diffusion-xl-lightning',
        '@cf/black-forest-labs/flux-1-dev'
      ]
    },
    openrouter: {
      text: ['openai/gpt-oss-20b:free', 'qwen/qwen3-4b:free', 'google/gemma-3-4b-it:free', 'openrouter/auto']
    },
    huggingface: {
      text: [
        'mistralai/Mistral-7B-Instruct-v0.2',
        'Qwen/Qwen2.5-7B-Instruct',
        'meta-llama/Llama-3.1-8B-Instruct',
        'HuggingFaceH4/zephyr-7b-beta',
        'meta-llama/Llama-3.3-70B-Instruct'
      ]
    }
  };

  const report = {
    startedAt: startedAt.toISOString(),
    environment: {
      hasOpenAI: !!OPENAI_API_KEY,
      hasGemini: !!GEMINI_API_KEY,
      hasOpenRouter: !!OPENROUTER_API_KEY,
      hasHuggingFace: !!HUGGINGFACE_API_KEY,
      hasCloudflareAccountId: !!CLOUDFLARE_ACCOUNT_ID,
      hasCloudflareToken: !!CLOUDFLARE_API_TOKEN,
      hasCloudflareGlobalKey: !!CLOUDFLARE_API_KEY
    },
    modelMatrix,
    providers: {}
  };

  report.providers.openai = {
    text: await runProbeGroup('openai', 'text', modelMatrix.openai.text, probeOpenAIText),
    image: await runProbeGroup('openai', 'image', modelMatrix.openai.image, probeOpenAIImage)
  };
  report.providers.gemini = {
    text: await runProbeGroup('gemini', 'text', modelMatrix.gemini.text, probeGeminiText),
    image: await runProbeGroup('gemini', 'image', modelMatrix.gemini.image, probeGeminiImage)
  };
  report.providers.cloudflare = {
    text: await runProbeGroup('cloudflare', 'text', modelMatrix.cloudflare.text, (m) =>
      probeCloudflareModel(m, {
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 16
      }, 'text')),
    image: await runProbeGroup('cloudflare', 'image', modelMatrix.cloudflare.image, (m) =>
      probeCloudflareModel(m, { prompt: 'Tiny comic icon robot head, simple line art, no text' }, 'image'))
  };
  report.providers.openrouter = {
    text: await runProbeGroup('openrouter', 'text', modelMatrix.openrouter.text, probeOpenRouterText)
  };
  report.providers.huggingface = {
    text: await runProbeGroup('huggingface', 'text', modelMatrix.huggingface.text, probeHuggingFaceText)
  };

  report.summary = summarizeSupport(report);
  report.finishedAt = ts();
  report.elapsedMs = new Date(report.finishedAt).getTime() - startedAt.getTime();

  const outFile = path.join(outDir, 'provider-model-probe-results.json');
  writeJson(outFile, report);

  const summaryFile = path.join(outDir, 'provider-model-probe-summary.txt');
  const summaryLines = [];
  for (const [provider, modes] of Object.entries(report.summary)) {
    summaryLines.push(`[${provider}]`);
    for (const [mode, data] of Object.entries(modes)) {
      summaryLines.push(`  ${mode} supported: ${data.supported.join(', ') || '(none)'}`);
      if (data.unsupported.length) {
        for (const u of data.unsupported) {
          summaryLines.push(`  ${mode} unsupported: ${u.model} -> ${u.error}`);
        }
      }
      if (data.skipped.length) {
        summaryLines.push(`  ${mode} skipped: ${data.skipped.join(', ')}`);
      }
    }
    summaryLines.push('');
  }
  fs.writeFileSync(summaryFile, summaryLines.join('\n'));

  if (writeRecommended) {
    const recommended = buildRecommendedModelSet(report, outDir);
    const localFile = path.resolve(__dirname, '../shared/recommended-model-set.local.json');
    writeJson(localFile, recommended);
    const copyInRunDir = path.join(outDir, 'recommended-model-set.local.json');
    writeJson(copyInRunDir, recommended);
    console.log(`Recommended model set written to: ${localFile}`);
  }

  console.log(`\nProbe results written to: ${outDir}`);
}

main().catch((error) => {
  console.error('Provider model probe failed:', error);
  process.exitCode = 1;
});
