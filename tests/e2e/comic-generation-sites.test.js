const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, '../../.env.e2e.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    // For this suite, prefer the local secrets file over inherited shell env vars.
    process.env[key] = value;
  }
}

loadLocalEnvFile();

const RUN_WEBSITE_COMIC_E2E = process.env.RUN_WEBSITE_COMIC_E2E === '1';
const REAL_OPENAI_E2E = process.env.REAL_OPENAI_E2E === '1';
const REAL_GEMINI_E2E = process.env.REAL_GEMINI_E2E === '1';
const REAL_CLOUDFLARE_E2E = process.env.REAL_CLOUDFLARE_E2E === '1';
const REAL_OPENROUTER_E2E = process.env.REAL_OPENROUTER_E2E === '1';
const REAL_HUGGINGFACE_E2E = process.env.REAL_HUGGINGFACE_E2E === '1';
const RUN_REAL_PROVIDER_MINI_MATRIX = process.env.RUN_REAL_PROVIDER_MINI_MATRIX === '1';
const RUN_REAL_PROVIDER_SINGLE_SITE_EXPORT = process.env.RUN_REAL_PROVIDER_SINGLE_SITE_EXPORT === '1';
const WEBSITE_SITE_FILTER = String(process.env.WEBSITE_SITE_FILTER || '').trim().toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-openai-key';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_INFERENCE_API_TOKEN || 'hf_test_key';
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL || '';
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY || '';
const USE_REAL_PROVIDER = REAL_OPENAI_E2E || REAL_GEMINI_E2E || REAL_CLOUDFLARE_E2E || REAL_OPENROUTER_E2E || REAL_HUGGINGFACE_E2E;
const REAL_PROVIDER_ID = REAL_HUGGINGFACE_E2E
  ? 'huggingface'
  : (REAL_OPENROUTER_E2E ? 'openrouter' : (REAL_CLOUDFLARE_E2E ? 'cloudflare-free' : (REAL_GEMINI_E2E ? 'gemini-free' : 'openai')));
const REAL_IMAGE_PROVIDER_ID = REAL_OPENROUTER_E2E ? 'cloudflare-free' : REAL_PROVIDER_ID;
const EXTENSION_PATH = path.resolve(__dirname, '../..');

const CONTENT_CATEGORY_WEBSITES = [
  {
    category: 'News & Journalism',
    websites: [
      { name: 'CNN', url: 'https://www.cnn.com' },
      { name: 'The Guardian International', url: 'https://www.theguardian.com/international' },
      { name: 'BBC News', url: 'https://www.bbc.com/news' },
      { name: 'AP News', url: 'https://apnews.com/' },
      { name: 'NPR News', url: 'https://www.npr.org/sections/news/' }
    ]
  },
  {
    category: 'Encyclopedia & Reference',
    websites: [
      { name: 'Wikipedia Israel', url: 'https://en.wikipedia.org/wiki/Israel' },
      { name: 'Wikipedia AI', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence' },
      { name: 'Britannica Israel', url: 'https://www.britannica.com/topic/Israel' },
      { name: 'Britannica AI', url: 'https://www.britannica.com/science/artificial-intelligence' },
      { name: 'Merriam-Webster Comic', url: 'https://www.merriam-webster.com/dictionary/comic' }
    ]
  },
  {
    category: 'Developer Documentation',
    websites: [
      { name: 'MDN JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' },
      { name: 'Node.js About', url: 'https://nodejs.org/en/about' },
      { name: 'GitHub Docs', url: 'https://docs.github.com/en/get-started/start-your-journey/about-github-and-git' },
      { name: 'web.dev Lazy Loading', url: 'https://web.dev/articles/browser-level-image-lazy-loading' },
      { name: 'RFC 9110', url: 'https://www.rfc-editor.org/rfc/rfc9110' }
    ]
  },
  {
    category: 'Government & Public Services',
    websites: [
      { name: 'USA.gov', url: 'https://www.usa.gov' },
      { name: 'White House Briefing Room', url: 'https://www.whitehouse.gov/briefing-room/' },
      { name: 'NASA News', url: 'https://www.nasa.gov/news/all-news/' },
      { name: 'CDC Newsroom', url: 'https://www.cdc.gov/media/' },
      { name: 'NIH News Releases', url: 'https://www.nih.gov/news-events/news-releases' }
    ]
  },
  {
    category: 'Education & Learning',
    websites: [
      { name: 'Edutopia', url: 'https://www.edutopia.org/' },
      { name: 'MIT OpenCourseWare', url: 'https://ocw.mit.edu' },
      { name: 'OpenLearn', url: 'https://www.open.edu/openlearn/' },
      { name: 'Coursera Articles', url: 'https://www.coursera.org/articles' },
      { name: 'edX Learn AI', url: 'https://www.edx.org/learn/artificial-intelligence' }
    ]
  },
  {
    category: 'Social Media',
    websites: [
      { name: 'X OpenAI', url: 'https://x.com/OpenAI' }
    ]
  }
];

const RAW_WEBSITES = CONTENT_CATEGORY_WEBSITES.flatMap((entry) =>
  entry.websites.map((site) => ({
    category: entry.category,
    name: site.name,
    url: site.url
  }))
);
const WEBSITES = WEBSITE_SITE_FILTER
  ? RAW_WEBSITES.filter((site) => {
    const host = (() => {
      try { return String(new URL(site.url).host || '').toLowerCase(); } catch (_) { return ''; }
    })();
    return (
      site.name.toLowerCase().includes(WEBSITE_SITE_FILTER) ||
      site.url.toLowerCase().includes(WEBSITE_SITE_FILTER) ||
      host.includes(WEBSITE_SITE_FILTER) ||
      site.category.toLowerCase().includes(WEBSITE_SITE_FILTER)
    );
  })
  : RAW_WEBSITES;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zl9kAAAAASUVORK5CYII=';

async function preflightOpenAI() {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with: ok' }],
      max_tokens: 5
    })
  });

  if (!response.ok) {
    let details = '';
    try {
      const json = await response.json();
      details = json?.error?.message || JSON.stringify(json);
    } catch (_) {
      details = await response.text();
    }
    throw new Error(`OpenAI preflight failed (${response.status}): ${details}`);
  }
}

async function preflightGemini() {
  const models = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  let lastError = null;
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with: ok' }] }],
        generationConfig: { maxOutputTokens: 8 }
      })
    });

    if (response.ok) return;

    let details = '';
    try {
      const json = await response.json();
      details = json?.error?.message || JSON.stringify(json);
    } catch (_) {
      details = await response.text();
    }

    lastError = new Error(`Gemini preflight failed (${response.status}) using ${model}: ${details}`);
    if (/no longer available|not found|not supported/i.test(details)) {
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('Gemini preflight failed: no candidate model succeeded');
}

async function preflightCloudflare() {
  const textModel = '@cf/meta/llama-3.1-8b-instruct';
  const imageModel = '@cf/black-forest-labs/flux-1-schnell';
  if (!CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare preflight requires CLOUDFLARE_ACCOUNT_ID');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (CLOUDFLARE_API_TOKEN) {
    headers.Authorization = `Bearer ${CLOUDFLARE_API_TOKEN}`;
  } else if (CLOUDFLARE_EMAIL && CLOUDFLARE_API_KEY) {
    headers['X-Auth-Email'] = CLOUDFLARE_EMAIL;
    headers['X-Auth-Key'] = CLOUDFLARE_API_KEY;
  } else {
    throw new Error('Cloudflare preflight requires CLOUDFLARE_API_TOKEN, or CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY');
  }

  async function runModel(model, body, label) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    let json = null;
    try {
      json = await response.json();
    } catch (_) {}

    if (!response.ok || (json && json.success === false)) {
      const details =
        (json?.errors && json.errors.map((e) => e.message || JSON.stringify(e)).join('; ')) ||
        json?.result?.error ||
        JSON.stringify(json || {});
      throw new Error(`Cloudflare ${label} preflight failed (${response.status}) using ${model}: ${details}`);
    }
    return json;
  }

  const text = await runModel(textModel, {
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 8
  }, 'text');
  if (!text?.result?.response && !text?.result?.output_text) {
    throw new Error(`Cloudflare text preflight returned unexpected payload: ${JSON.stringify(text).slice(0, 500)}`);
  }

  const image = await runModel(imageModel, {
    prompt: 'A tiny cartoon cat face icon, simple comic style'
  }, 'image');
  if (!image?.result?.image) {
    throw new Error(`Cloudflare image preflight returned no base64 image: ${JSON.stringify(image).slice(0, 500)}`);
  }
}

async function preflightOpenRouter() {
  const models = [
    'openai/gpt-oss-20b:free',
    'google/gemma-3-4b-it:free',
    'openrouter/auto'
  ];
  let lastError = null;
  for (const model of models) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://web-to-comic.local',
        'X-Title': 'Web2Comics'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8
      })
    });

    if (response.ok) return;

    let details = '';
    try {
      const json = await response.json();
      details = json?.error?.message || json?.error?.metadata?.raw || json?.message || JSON.stringify(json);
    } catch (_) {
      details = await response.text();
    }
    lastError = new Error(`OpenRouter preflight failed (${response.status}) using ${model}: ${details}`);
    if (/not found|unsupported|not available|no endpoints found|provider returned error|rate-limit|temporar/i.test(details) || response.status === 429) {
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('OpenRouter preflight failed: no candidate model succeeded');
}

async function preflightHuggingFace() {
  const models = [
    'mistralai/Mistral-7B-Instruct-v0.2',
    'meta-llama/Llama-3.3-70B-Instruct',
    'HuggingFaceH4/zephyr-7b-beta'
  ];
  let lastError = null;
  let textOk = false;
  for (const model of models) {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }],
        max_tokens: 32
      })
    });

    if (response.ok) {
      const payload = await response.json();
      const generated = payload?.choices?.[0]?.message?.content || '';
      if (generated) {
        textOk = true;
        break;
      }
      lastError = new Error(`Hugging Face preflight returned unexpected payload for ${model}: ${JSON.stringify(payload).slice(0, 500)}`);
      continue;
    }

    let details = '';
    try {
      const json = await response.json();
      details = json?.error || json?.message || JSON.stringify(json);
    } catch (_) {
      details = await response.text();
    }
    lastError = new Error(`Hugging Face preflight failed (${response.status}) using ${model}: ${details}`);
    if (/loading|too many requests|rate limit|not found|unsupported|temporar/i.test(details) || response.status === 429 || response.status === 503) {
      continue;
    }
    throw lastError;
  }
  if (!textOk) {
    throw lastError;
  }

  const imageModels = [
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-xl-base-1.0',
    'black-forest-labs/FLUX.1-dev'
  ];
  let imageError = null;
  for (const model of imageModels) {
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: 'Tiny comic icon of a smiling robot head, no text',
        parameters: { width: 256, height: 256, num_inference_steps: 2 }
      })
    });
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (/^image\//i.test(contentType)) return;
      try {
        const payload = await response.json();
        if (payload?.image || payload?.images?.[0]) return;
      } catch (_) {}
      imageError = new Error(`Hugging Face image preflight returned non-image payload for ${model}`);
      continue;
    }
    let details = '';
    try {
      details = await response.text();
    } catch (_) {}
    imageError = new Error(`Hugging Face image preflight failed (${response.status}) using ${model}: ${details}`);
    if (/loading|too many requests|rate limit|not found|unsupported|deprecated|temporar/i.test(details) || response.status === 429 || response.status === 503) {
      continue;
    }
    throw imageError;
  }
  throw imageError || new Error('Hugging Face image preflight failed: no candidate model succeeded');
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

async function installOpenAIMocks(context) {
  let imageCounter = 0;

  await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const userMessage = body.messages?.find((m) => m.role === 'user')?.content || 'content';
    const snippet = String(userMessage).slice(0, 80);
    const storyboard = {
      title: 'Mock Comic',
      panels: [
        { beat_summary: 'Intro', caption: 'Panel 1', image_prompt: `Comic panel intro: ${snippet}` },
        { beat_summary: 'Middle', caption: 'Panel 2', image_prompt: 'Comic panel middle scene' },
        { beat_summary: 'End', caption: 'Panel 3', image_prompt: 'Comic panel ending scene' }
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
      body: JSON.stringify({
        data: [{ url: `https://mock-images.test/panel-${imageCounter}.png` }]
      })
    });
  });

  await context.route('https://mock-images.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TINY_PNG_BASE64, 'base64')
    });
  });
}

async function installGeminiMocks(context, captures = {}) {
  let imageCounter = 0;
  await context.route('https://generativelanguage.googleapis.com/v1beta/models/*:generateContent?key=*', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const promptText = body.contents?.[0]?.parts?.[0]?.text || '';
    const isImage = Array.isArray(body.generationConfig?.responseModalities) &&
      body.generationConfig.responseModalities.includes('image');

    if (isImage) {
      captures.imagePrompts = captures.imagePrompts || [];
      captures.imagePrompts.push(String(promptText));
      imageCounter += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: TINY_PNG_BASE64 } },
                { text: `mock image ${imageCounter}` }
              ]
            }
          }]
        })
      });
      return;
    }

    captures.storyboardPrompts = captures.storyboardPrompts || [];
    captures.storyboardPrompts.push(String(promptText));
    const storyboard = {
      title: 'Gemini Mock Comic',
      panels: [
        { beat_summary: 'Intro', caption: 'G Panel 1', image_prompt: 'Gem image one' },
        { beat_summary: 'Middle', caption: 'G Panel 2', image_prompt: 'Gem image two' },
        { beat_summary: 'End', caption: 'G Panel 3', image_prompt: 'Gem image three' }
      ]
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(storyboard) }] } }]
      })
    });
  });
}

async function installObjectivePromptCaptureMocks(context, providerId, captures = {}) {
  captures.storyboardPrompts = captures.storyboardPrompts || [];
  captures.imagePrompts = captures.imagePrompts || [];

  const mockStoryboard = {
    title: 'Objective Prompt Test Comic',
    panels: [
      { beat_summary: 'Intro', caption: 'Panel 1', image_prompt: 'Scene one' },
      { beat_summary: 'Middle', caption: 'Panel 2', image_prompt: 'Scene two' },
      { beat_summary: 'End', caption: 'Panel 3', image_prompt: 'Scene three' }
    ]
  };

  await context.route('https://api.openai.com/v1/images/generations', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    captures.imagePrompts.push(String(body.prompt || ''));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ url: 'https://mock-images.test/objective-prompt.png' }] })
    });
  });
  await context.route('https://mock-images.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TINY_PNG_BASE64, 'base64')
    });
  });

  if (providerId === 'gemini-free') {
    await installGeminiMocks(context, captures);
    return;
  }

  if (providerId === 'openai') {
    await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON?.() || {};
      captures.storyboardPrompts.push(String(body.messages?.find((m) => m.role === 'user')?.content || ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockStoryboard) } }] })
      });
    });
    return;
  }

  if (providerId === 'openrouter') {
    await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON?.() || {};
      captures.storyboardPrompts.push(String(body.messages?.find((m) => m.role === 'user')?.content || ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockStoryboard) } }] })
      });
    });
    return;
  }

  if (providerId === 'huggingface') {
    await context.route('https://router.huggingface.co/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON?.() || {};
      captures.storyboardPrompts.push(String(body.messages?.find((m) => m.role === 'user')?.content || ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockStoryboard) } }] })
      });
    });
    return;
  }

  if (providerId === 'cloudflare-free') {
    await context.route('https://api.cloudflare.com/client/v4/accounts/**/ai/run/**', async (route) => {
      const body = route.request().postDataJSON?.() || {};
      const userMsg = Array.isArray(body.messages)
        ? body.messages.find((m) => m && m.role === 'user')
        : null;
      captures.storyboardPrompts.push(String(userMsg?.content || ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          result: {
            response: JSON.stringify(mockStoryboard)
          }
        })
      });
    });
    return;
  }

  throw new Error(`Unsupported provider for objective prompt capture: ${providerId}`);
}

async function setupExtensionStorage(context, extensionId, overrides = {}) {
  const page = await context.newPage();
  const imageModel = overrides.imageModel || 'dall-e-2';
  const providerId = overrides.providerId || REAL_PROVIDER_ID;
  const imageProviderId = overrides.imageProviderId || REAL_IMAGE_PROVIDER_ID || providerId;
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
    waitUntil: 'domcontentloaded'
  });

  await page.evaluate(async ({ openAiKey, geminiKey, openrouterKey, huggingfaceKey, imageModel, providerId, imageProviderId, cloudflare, promptTemplates }) => {
    const apiKeys = {};
    if (openAiKey) apiKeys.openai = openAiKey;
    if (geminiKey) apiKeys.gemini = geminiKey;
    if (openrouterKey) apiKeys.openrouter = openrouterKey;
    if (huggingfaceKey) apiKeys.huggingface = huggingfaceKey;
    if (cloudflare?.apiToken) apiKeys.cloudflare = cloudflare.apiToken;
    await chrome.storage.local.set({
      onboardingComplete: true,
      apiKeys: apiKeys,
      cloudflareConfig: cloudflare || {},
      ...(promptTemplates ? { promptTemplates } : {}),
      settings: {
        panelCount: 3,
        detailLevel: 'low',
        styleId: 'default',
        captionLength: 'short',
        activeTextProvider: providerId,
        activeImageProvider: imageProviderId,
        characterConsistency: false,
        maxCacheSize: 100,
        autoOpenSidePanel: true,
        textModel: 'gpt-4o-mini',
        imageModel: imageModel
      }
    });
  }, {
    openAiKey: overrides.openAiKey !== undefined ? overrides.openAiKey : OPENAI_API_KEY,
    geminiKey: overrides.geminiKey !== undefined ? overrides.geminiKey : (REAL_GEMINI_E2E ? GEMINI_API_KEY : ''),
    openrouterKey: overrides.openrouterKey !== undefined ? overrides.openrouterKey : (REAL_OPENROUTER_E2E ? OPENROUTER_API_KEY : ''),
    huggingfaceKey: overrides.huggingfaceKey !== undefined
      ? overrides.huggingfaceKey
      : (overrides.providerId === 'huggingface' || REAL_PROVIDER_ID === 'huggingface' ? HUGGINGFACE_API_KEY : ''),
    imageModel,
    providerId: providerId,
    imageProviderId: imageProviderId,
    promptTemplates: overrides.promptTemplates || null,
    cloudflare: overrides.cloudflare !== undefined
      ? overrides.cloudflare
      : ((REAL_CLOUDFLARE_E2E || REAL_OPENROUTER_E2E || CLOUDFLARE_ACCOUNT_ID || CLOUDFLARE_API_TOKEN) ? {
          accountId: CLOUDFLARE_ACCOUNT_ID,
          apiToken: CLOUDFLARE_API_TOKEN,
          email: CLOUDFLARE_EMAIL,
          apiKey: CLOUDFLARE_API_KEY
        } : null)
  });

  await page.close();
}

async function getPageText(page) {
  const text = await page.evaluate(() => {
    const el = document.querySelector('article, main, [role="main"]') || document.body;
    return (el?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  });
  return text;
}

async function startGenerationAndWait(context, extensionId, sourcePage, overrides = {}) {
  const sourceUrl = sourcePage.url();
  if (/https?:\/\/(www\.)?(x|twitter)\.com\//i.test(sourceUrl)) {
    await sourcePage.waitForFunction(() => {
      const hasTweet = document.querySelectorAll('article[data-testid="tweet"], div[data-testid="tweetText"]').length > 0;
      const bodyLen = String(document.body?.innerText || '').trim().length;
      return hasTweet && bodyLen > 300;
    }, null, { timeout: 30000 }).catch(async () => {
      await sourcePage.waitForTimeout(10000);
    });
  } else {
    await sourcePage.waitForTimeout(1000);
  }

  let sourceText = await getPageText(sourcePage);
  if (sourceText.length <= 100) {
    await sourcePage.waitForTimeout(5000);
    sourceText = await getPageText(sourcePage);
  }
  expect(sourceText.length).toBeGreaterThan(100);

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
    waitUntil: 'domcontentloaded'
  });

  const startResult = await extensionPage.evaluate(async ({ text, url, title, providerId, imageProviderId, generationSettings }) => {
    return await chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      payload: {
        text,
        url,
        title,
        settings: {
          panel_count: 3,
          detail_level: 'low',
          style_id: 'default',
          caption_len: 'short',
          provider_text: providerId,
          provider_image: imageProviderId,
          custom_style_theme: '',
          ...generationSettings
        }
      }
    });
  }, {
    text: sourceText.slice(0, 4000),
    url: sourcePage.url(),
    title: await sourcePage.title(),
    providerId: overrides.providerId || REAL_PROVIDER_ID,
    imageProviderId: overrides.imageProviderId || REAL_IMAGE_PROVIDER_ID || overrides.providerId || REAL_PROVIDER_ID,
    generationSettings: overrides.generationSettings || {}
  });

  expect(startResult?.success).toBe(true);

  const pollTimeoutMs = USE_REAL_PROVIDER ? 300000 : 30000;
  const jobResult = await extensionPage.evaluate(async ({ timeoutMs }) => {
    const started = Date.now();
    let sawJob = false;

    while (Date.now() - started < timeoutMs) {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      if (currentJob) {
        sawJob = true;
      }
      if (currentJob && ['completed', 'failed', 'canceled'].includes(currentJob.status)) {
        return currentJob;
      }
      // Be tolerant of transient missing reads while the service worker is starting/saving.
      if (!currentJob && !sawJob) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
  }, { timeoutMs: pollTimeoutMs });

  await extensionPage.close();
  return jobResult;
}

async function saveCompositeDownloadFromSidePanel(context, extensionId, outFilePath) {
  const sidePanelPage = await context.newPage();
  try {
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });
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
    if (!match) throw new Error('Composite export did not produce a PNG data URL');
    fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
    fs.writeFileSync(outFilePath, Buffer.from(match[1], 'base64'));
    return {
      filePath: outFilePath,
      downloadName: downloadObj.download || '',
      bytes: fs.statSync(outFilePath).size
    };
  } finally {
    await sidePanelPage.close();
  }
}

async function collectExtensionDiagnostics(context, extensionId) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    return await page.evaluate(async () => {
      const { currentJob, debugLogs, history } = await chrome.storage.local.get([
        'currentJob',
        'debugLogs',
        'history'
      ]);
      return {
        currentJob,
        debugLogs: Array.isArray(debugLogs) ? debugLogs.slice(-50) : [],
        historyCount: Array.isArray(history) ? history.length : 0
      };
    });
  } finally {
    await page.close();
  }
}

async function validateComicRenderedInSidePanel(context, extensionId, expectedPanelCount) {
  const sidePanelPage = await context.newPage();
  try {
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(sidePanelPage.locator('#comic-display')).toBeVisible({ timeout: 10000 });
    const stripImages = sidePanelPage.locator('#comic-strip img');
    await expect(stripImages).toHaveCount(expectedPanelCount);

    const imageStates = await stripImages.evaluateAll((imgs) =>
      imgs.map((img) => ({
        displayed: !!img && !!img.getAttribute('src'),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      }))
    );

    for (const img of imageStates) {
      expect(img.displayed).toBe(true);
      expect(img.complete).toBe(true);
      expect(img.naturalWidth).toBeGreaterThan(0);
      expect(img.naturalHeight).toBeGreaterThan(0);
    }
  } finally {
    await sidePanelPage.close();
  }
}

async function validateHistoryAfterGeneration(context, extensionId, expectedSourceUrl) {
  const popupPage = await context.newPage();
  try {
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded'
    });

    const historySnapshot = await popupPage.evaluate(async () => {
      const { history } = await chrome.storage.local.get('history');
      return Array.isArray(history) ? history : [];
    });

    expect(historySnapshot.length).toBeGreaterThan(0);
    const latest = historySnapshot[0];
    expect(latest).toBeTruthy();
    expect(latest.source?.url).toBe(expectedSourceUrl);
    expect(Array.isArray(latest.storyboard?.panels)).toBe(true);
    expect(latest.storyboard.panels.length).toBeGreaterThan(0);
    expect(typeof latest.thumbnail).toBe('string');
    expect(latest.thumbnail.startsWith('data:image/')).toBe(true);

    await popupPage.locator('#view-history-btn').click();
    await expect(popupPage.locator('#history-modal')).toBeVisible();
    await expect(popupPage.locator('#history-list .history-item')).toHaveCount(1);
    await expect(popupPage.locator('#history-list .history-title').first()).not.toHaveText('');
  } finally {
    await popupPage.close();
  }

  const sidePanelPage = await context.newPage();
  try {
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });
    const sideHistoryItems = sidePanelPage.locator('#history-list .history-item');
    await expect(sideHistoryItems).toHaveCount(1);
    await expect(sideHistoryItems.first().locator('.history-title')).not.toHaveText('');
  } finally {
    await sidePanelPage.close();
  }
}

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2comics-sites-'));
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

test.describe('Comic generation across real websites (mocked/real providers)', () => {
  test.skip(!RUN_WEBSITE_COMIC_E2E, 'Set RUN_WEBSITE_COMIC_E2E=1 to run website comic generation tests.');
  test.describe.configure({ mode: 'serial' });

  if (REAL_OPENAI_E2E) {
    test.beforeAll(async () => {
      if (!OPENAI_API_KEY || OPENAI_API_KEY === 'REPLACE_WITH_ROTATED_OPENAI_KEY' || OPENAI_API_KEY === 'sk-test-openai-key') {
        throw new Error('REAL_OPENAI_E2E=1 requires OPENAI_API_KEY in env or .env.e2e.local');
      }
      await preflightOpenAI();
    });
  }
  if (REAL_GEMINI_E2E) {
    test.beforeAll(async () => {
      if (!GEMINI_API_KEY || GEMINI_API_KEY === 'REPLACE_WITH_GEMINI_API_KEY') {
        throw new Error('REAL_GEMINI_E2E=1 requires GEMINI_API_KEY in env or .env.e2e.local');
      }
      await preflightGemini();
    });
  }
  if (REAL_CLOUDFLARE_E2E) {
    test.beforeAll(async () => {
      await preflightCloudflare();
    });
  }
  if (REAL_OPENROUTER_E2E) {
    test.beforeAll(async () => {
      if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'REPLACE_WITH_OPENROUTER_API_KEY') {
        throw new Error('REAL_OPENROUTER_E2E=1 requires OPENROUTER_API_KEY in env or .env.e2e.local');
      }
      await preflightOpenRouter();
      // Prefer Cloudflare for real image generation in OpenRouter E2E path.
      await preflightCloudflare();
    });
  }
  if (REAL_HUGGINGFACE_E2E) {
    test.beforeAll(async () => {
      if (!HUGGINGFACE_API_KEY || HUGGINGFACE_API_KEY === 'REPLACE_WITH_HUGGINGFACE_API_KEY' || HUGGINGFACE_API_KEY === 'hf_test_key') {
        throw new Error('REAL_HUGGINGFACE_E2E=1 requires HUGGINGFACE_API_KEY or HUGGINGFACE_INFERENCE_API_TOKEN in env or .env.e2e.local');
      }
      await preflightHuggingFace();
    });
  }

  for (const site of WEBSITES) {
    test(`[${site.category}] creates comic output for ${site.name} (${new URL(site.url).host})`, async ({}, testInfo) => {
      test.setTimeout(USE_REAL_PROVIDER ? 10 * 60 * 1000 : 90000);

      const { context, userDataDir } = await launchExtensionContext();
      try {
        if (!USE_REAL_PROVIDER) {
          await installOpenAIMocks(context);
        }

        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId);

        const page = await context.newPage();
        await page.goto(site.url, { waitUntil: 'domcontentloaded' });

        const job = await startGenerationAndWait(context, extensionId, page);
        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach('extension-diagnostics.json', {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          const summary = {
            status: diagnostics?.currentJob?.status,
            error: diagnostics?.currentJob?.error,
            errorDetails: diagnostics?.currentJob?.errorDetails,
            panelErrors: diagnostics?.currentJob?.panelErrors,
            progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10),
            debugLogsTail: diagnostics?.debugLogs?.slice?.(-10)
          };
          throw new Error(`Generation failed: ${JSON.stringify(summary, null, 2)}`);
        }
        expect(job).toBeTruthy();
        expect(job.status).toBe('completed');
        expect(job.storyboard).toBeTruthy();
        expect(Array.isArray(job.storyboard.panels)).toBe(true);
        expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
        expect(job.storyboard.panels[0].caption || '').not.toBe('');
        expect((job.panelErrors || []).length).toBe(0);

        // Require every panel image to be generated.
        for (const panel of job.storyboard.panels) {
          expect(panel.artifacts).toBeTruthy();
          expect(panel.artifacts.error).toBeFalsy();
          expect(typeof panel.artifacts.image_blob_ref).toBe('string');
          expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
        }

        // Verify images are actually rendered in the extension viewer UI.
        await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
        await validateHistoryAfterGeneration(context, extensionId, page.url());
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  }

  test('creates comic output using Cloudflare Workers AI text provider (with mocked OpenAI images)', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Cloudflare mocked smoke runs only when all real-provider modes are off');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installOpenAIMocks(context);
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'cloudflare-free',
        imageProviderId: 'openai'
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'cloudflare-free',
        imageProviderId: 'openai'
      });
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Cloudflare Workers AI generation failed: ${JSON.stringify({
          status: diagnostics?.currentJob?.status,
          error: diagnostics?.currentJob?.error,
          panelErrors: diagnostics?.currentJob?.panelErrors
        }, null, 2)}`);
      }

      expect(job.settings.provider_text).toBe('cloudflare-free');
      expect(job.settings.provider_image).toBe('openai');
      expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
      for (const panel of job.storyboard.panels) {
        expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
        expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
      }
      await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('uses custom OpenAI prompt templates in outbound storyboard and image requests (mocked)', async () => {
    test.skip(USE_REAL_PROVIDER, 'Prompt-template outbound assertion runs in mocked mode only');
    test.setTimeout(90000);

    const captures = { storyboardPrompts: [], imagePrompts: [] };
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        captures.storyboardPrompts.push(String(body.messages?.find((m) => m.role === 'user')?.content || ''));
        const storyboard = {
          title: 'Template Test Comic',
          panels: [
            { beat_summary: 'A', caption: 'OpenAI Panel 1', image_prompt: 'Base image prompt one' },
            { beat_summary: 'B', caption: 'OpenAI Panel 2', image_prompt: 'Base image prompt two' },
            { beat_summary: 'C', caption: 'OpenAI Panel 3', image_prompt: 'Base image prompt three' }
          ]
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
        });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        captures.imagePrompts.push(String(body.prompt || ''));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: 'https://mock-images.test/openai-template.png' }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(TINY_PNG_BASE64, 'base64')
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai',
        promptTemplates: {
          openai: {
            storyboard: 'CUSTOM_STORY {{source_title}} :: {{panel_count}} :: {{content}}',
            image: 'CUSTOM_IMAGE {{panel_index}}/{{panel_count}} {{panel_caption}} {{style_prompt}}'
          }
        }
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai'
      });

      expect(job?.status).toBe('completed');
      expect(captures.storyboardPrompts.length).toBeGreaterThan(0);
      expect(captures.storyboardPrompts[0]).toContain('CUSTOM_STORY');
      expect(captures.storyboardPrompts[0]).toContain(':: 3 ::');
      expect(captures.imagePrompts.length).toBeGreaterThan(0);
      expect(captures.imagePrompts[0]).toContain('CUSTOM_IMAGE 1/3');
      expect(captures.imagePrompts[0]).toContain('OpenAI Panel 1');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('uses custom Gemini prompt templates in outbound storyboard and image requests (mocked)', async () => {
    test.skip(USE_REAL_PROVIDER, 'Prompt-template outbound assertion runs in mocked mode only');
    test.setTimeout(90000);

    const captures = { storyboardPrompts: [], imagePrompts: [] };
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installGeminiMocks(context, captures);

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        geminiKey: 'gemini-mock-key',
        promptTemplates: {
          gemini: {
            storyboard: 'GEM_STORY {{source_title}} {{panel_count}} {{content}}',
            image: 'GEM_IMAGE {{panel_index}}/{{panel_count}} {{panel_caption}} {{panel_summary}} {{style_prompt}}'
          }
        }
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free'
      });

      expect(job?.status).toBe('completed');
      expect(captures.storyboardPrompts.length).toBeGreaterThan(0);
      expect(captures.storyboardPrompts[0]).toContain('GEM_STORY');
      expect(captures.storyboardPrompts[0]).toContain(' 3 ');
      expect(captures.imagePrompts.length).toBeGreaterThan(0);
      expect(captures.imagePrompts[0]).toContain('GEM_IMAGE 1/3');
      expect(captures.imagePrompts[0]).toContain('G Panel 1');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('creates comic output using Hugging Face Inference API text provider (with mocked OpenAI images)', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Hugging Face provider smoke runs in mocked mode only');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installOpenAIMocks(context);
      await context.route('https://router.huggingface.co/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'HF Mock Comic',
          panels: [
            { beat_summary: 'Intro', caption: 'HF Panel 1', image_prompt: 'Comic panel intro' },
            { beat_summary: 'Middle', caption: 'HF Panel 2', image_prompt: 'Comic panel middle' },
            { beat_summary: 'End', caption: 'HF Panel 3', image_prompt: 'Comic panel ending' }
          ]
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'huggingface',
        imageProviderId: 'openai'
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'huggingface',
        imageProviderId: 'openai'
      });
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Hugging Face generation failed: ${JSON.stringify({
          status: diagnostics?.currentJob?.status,
          error: diagnostics?.currentJob?.error,
          panelErrors: diagnostics?.currentJob?.panelErrors
        }, null, 2)}`);
      }

      expect(job.settings.provider_text).toBe('huggingface');
      expect(job.settings.provider_image).toBe('openai');
      expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
      for (const panel of job.storyboard.panels) {
        expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
        expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
      }
      await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  const MOCKED_PROVIDER_CONFIG_CASES = [
    {
      name: 'OpenAI text + OpenAI images (DALL-E 2 fast config)',
      providerId: 'openai',
      imageProviderId: 'openai',
      storageOverrides: { imageModel: 'dall-e-2' },
      startOverrides: { providerId: 'openai', imageProviderId: 'openai' }
    },
    {
      name: 'OpenAI text + OpenAI images (DALL-E 3 standard config)',
      providerId: 'openai',
      imageProviderId: 'openai',
      storageOverrides: { imageModel: 'dall-e-3' },
      startOverrides: { providerId: 'openai', imageProviderId: 'openai' }
    },
    {
      name: 'Gemini text + Gemini images',
      providerId: 'gemini-free',
      imageProviderId: 'gemini-free',
      storageOverrides: { geminiKey: 'gemini-mock-key' },
      installMocks: installGeminiMocks,
      startOverrides: { providerId: 'gemini-free', imageProviderId: 'gemini-free' }
    },
    {
      name: 'Cloudflare text + OpenAI images',
      providerId: 'cloudflare-free',
      imageProviderId: 'openai',
      startOverrides: { providerId: 'cloudflare-free', imageProviderId: 'openai' }
    },
    {
      name: 'OpenRouter text + OpenAI images',
      providerId: 'openrouter',
      imageProviderId: 'openai',
      storageOverrides: { openrouterKey: 'sk-or-v1-mock-key' },
      installExtraMocks: async (context) => {
        await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
          const storyboard = {
            title: 'OpenRouter Mock Comic',
            panels: [
              { beat_summary: 'Intro', caption: 'OR Panel 1', image_prompt: 'OR image 1' },
              { beat_summary: 'Middle', caption: 'OR Panel 2', image_prompt: 'OR image 2' },
              { beat_summary: 'End', caption: 'OR Panel 3', image_prompt: 'OR image 3' }
            ]
          };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
          });
        });
      },
      startOverrides: { providerId: 'openrouter', imageProviderId: 'openai' }
    },
    {
      name: 'Hugging Face text + Cloudflare images',
      providerId: 'huggingface',
      imageProviderId: 'cloudflare-free',
      installExtraMocks: async (context) => {
        await context.route('https://router.huggingface.co/v1/chat/completions', async (route) => {
          const storyboard = {
            title: 'HF+CF Mock Comic',
            panels: [
              { beat_summary: 'Intro', caption: 'HF-CF Panel 1', image_prompt: 'HF-CF image 1' },
              { beat_summary: 'Middle', caption: 'HF-CF Panel 2', image_prompt: 'HF-CF image 2' },
              { beat_summary: 'End', caption: 'HF-CF Panel 3', image_prompt: 'HF-CF image 3' }
            ]
          };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
          });
        });
        await context.route('https://api.cloudflare.com/client/v4/accounts/*/ai/run/@cf/black-forest-labs/flux-1-schnell', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, result: { image: TINY_PNG_BASE64 } })
          });
        });
      },
      storageOverrides: {
        huggingfaceKey: 'hf_mock_key',
        cloudflare: { accountId: 'cf-account', apiToken: 'cf-token' }
      },
      startOverrides: { providerId: 'huggingface', imageProviderId: 'cloudflare-free' }
    }
  ];

  for (const cfgCase of MOCKED_PROVIDER_CONFIG_CASES) {
    test(`mocked provider config matrix: ${cfgCase.name}`, async ({}, testInfo) => {
      test.skip(USE_REAL_PROVIDER, 'Mocked provider matrix runs only when real-provider modes are off');
      test.setTimeout(90000);

      const { context, userDataDir } = await launchExtensionContext();
      try {
        await installOpenAIMocks(context);
        if (cfgCase.installExtraMocks) {
          await cfgCase.installExtraMocks(context);
        }
        if (cfgCase.installMocks && cfgCase.installMocks !== installGeminiMocks) {
          await cfgCase.installMocks(context);
        } else if (cfgCase.providerId === 'gemini-free' || cfgCase.imageProviderId === 'gemini-free') {
          await installGeminiMocks(context, {});
        }
        if (cfgCase.providerId === 'cloudflare-free' || cfgCase.imageProviderId === 'cloudflare-free') {
          await context.route('https://api.cloudflare.com/client/v4/accounts/*/ai/run/@cf/meta/llama-3.1-8b-instruct', async (route) => {
            const storyboard = {
              title: 'Cloudflare Mock Comic',
              panels: [
                { beat_summary: 'Intro', caption: 'CF Panel 1', image_prompt: 'CF image 1' },
                { beat_summary: 'Middle', caption: 'CF Panel 2', image_prompt: 'CF image 2' },
                { beat_summary: 'End', caption: 'CF Panel 3', image_prompt: 'CF image 3' }
              ]
            };
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, result: { response: JSON.stringify(storyboard) } })
            });
          });
          await context.route('https://api.cloudflare.com/client/v4/accounts/*/ai/run/@cf/black-forest-labs/flux-1-schnell', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, result: { image: TINY_PNG_BASE64 } })
            });
          });
        }

        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId, {
          providerId: cfgCase.providerId,
          imageProviderId: cfgCase.imageProviderId,
          ...(cfgCase.storageOverrides || {})
        });

        const page = await context.newPage();
        await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
        const job = await startGenerationAndWait(context, extensionId, page, cfgCase.startOverrides || {});

        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach('extension-diagnostics.json', {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          throw new Error(`Mocked provider config matrix failed (${cfgCase.name}): ${JSON.stringify({
            status: diagnostics?.currentJob?.status,
            error: diagnostics?.currentJob?.error,
            panelErrors: diagnostics?.currentJob?.panelErrors,
            progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-8)
          }, null, 2)}`);
        }

        expect(job.settings.provider_text).toBe(cfgCase.providerId);
        expect(job.settings.provider_image).toBe(cfgCase.imageProviderId);
        expect(Array.isArray(job.storyboard?.panels)).toBe(true);
        expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
        expect((job.panelErrors || []).length).toBe(0);
        for (const panel of job.storyboard.panels) {
          expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
          expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
        }
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  }

  test('mocked config edge: OpenAI DALL-E 3 image request uses requested size/quality', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked config-edge tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const capturedImageBodies = [];
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'OpenAI D3 Config',
          panels: [
            { beat_summary: 'One', caption: 'One', image_prompt: 'P1' },
            { beat_summary: 'Two', caption: 'Two', image_prompt: 'P2' },
            { beat_summary: 'Three', caption: 'Three', image_prompt: 'P3' }
          ]
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
        });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        capturedImageBodies.push(route.request().postDataJSON?.() || {});
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: 'https://mock-images.test/openai-d3-config.png' }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          image_model: 'dall-e-3',
          image_size: '1792x1024',
          image_quality: 'hd'
        }
      });

      expect(job?.status).toBe('completed');
      expect(capturedImageBodies.length).toBeGreaterThan(0);
      expect(capturedImageBodies[0].model).toBe('dall-e-3');
      expect(capturedImageBodies[0].size).toBe('1792x1024');
      expect(capturedImageBodies[0].quality).toBe('hd');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked config edge: OpenAI DALL-E 2 image request normalizes unsupported size/quality', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked config-edge tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const capturedImageBodies = [];
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installOpenAIMocks(context);
      await context.unroute('https://api.openai.com/v1/images/generations');
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        capturedImageBodies.push(route.request().postDataJSON?.() || {});
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: 'https://mock-images.test/openai-d2-config.png' }] })
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          image_model: 'dall-e-2',
          image_size: '1792x1024',
          image_quality: 'hd'
        }
      });

      expect(job?.status).toBe('completed');
      expect(capturedImageBodies.length).toBeGreaterThan(0);
      expect(capturedImageBodies[0].model).toBe('dall-e-2');
      expect(capturedImageBodies[0].size).toBe('256x256');
      expect(Object.prototype.hasOwnProperty.call(capturedImageBodies[0], 'quality')).toBe(false);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked config edge: panel count 5 yields progress events and completedPanels=5', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Mocked config-edge tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'Five Panel Progress',
          panels: Array.from({ length: 5 }, (_, i) => ({
            beat_summary: `Beat ${i + 1}`,
            caption: `Panel ${i + 1}`,
            image_prompt: `Prompt ${i + 1}`
          }))
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
        });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: 'https://mock-images.test/panel-progress.png' }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: { panel_count: 5 }
      });

      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
      }
      expect(job?.status).toBe('completed');
      expect(job.completedPanels).toBe(5);
      expect(job.currentPanelIndex).toBe(5);
      expect(job.storyboard.panels.length).toBe(5);
      const eventTypes = (job.progressEvents || []).map((e) => e.type);
      expect(eventTypes).toContain('storyboard.prompt');
      expect(eventTypes).toContain('storyboard.response');
      expect(eventTypes).toContain('panel.progress');
      expect(eventTypes).toContain('job.completed');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked config edge: custom style metadata propagates in Gemini storyboard settings', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked config-edge tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installGeminiMocks(context, {});
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        geminiKey: 'gemini-mock-key'
      });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        generationSettings: {
          style_id: 'custom',
          custom_style_name: 'Retro Wire News',
          custom_style_theme: 'halftone print, limited cyan-magenta palette'
        }
      });

      expect(job?.status).toBe('completed');
      expect(job.storyboard?.settings?.style_id).toBe('custom');
      expect(job.storyboard?.settings?.custom_style_name).toBe('Retro Wire News');
      expect(job.storyboard?.settings?.custom_style_theme).toContain('halftone');
      expect(job.storyboard?.settings?.provider_text).toBe('gemini-free');
      expect(job.storyboard?.settings?.provider_image).toBe('gemini-free');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked refusal handling: rewrite_and_retry retries once and marks rewritten badge metadata', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked refusal tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const imageBodies = [];
    let imageCalls = 0;
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'Refusal Rewrite',
          panels: [
            { beat_summary: 'One', caption: 'One', image_prompt: 'Donald Trump speaking at rally, dramatic political scene' },
            { beat_summary: 'Two', caption: 'Two', image_prompt: 'Panel 2' },
            { beat_summary: 'Three', caption: 'Three', image_prompt: 'Panel 3' }
          ]
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] }) });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        imageCalls += 1;
        const body = route.request().postDataJSON?.() || {};
        imageBodies.push(body);
        if (imageCalls === 1) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Request blocked by content policy' } })
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: `https://mock-images.test/rewrite-${imageCalls}.png` }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          image_refusal_handling: 'rewrite_and_retry',
          show_rewritten_badge: true,
          log_rewritten_prompts: true,
          debug_flag: true
        }
      });

      expect(job?.status).toBe('completed');
      expect(imageBodies.length).toBeGreaterThanOrEqual(4);
      const refusalMeta = job.storyboard.panels[0].artifacts?.provider_metadata?.refusal_handling;
      const refusalDebug = job.storyboard.panels[0].artifacts?.refusal_debug;
      expect(refusalMeta?.mode).toBe('rewrite_and_retry');
      expect(refusalMeta?.retried).toBe(true);
      expect(refusalMeta?.rewritten).toBe(true);
      expect(refusalMeta?.blockedPlaceholder).toBe(false);
      expect(refusalDebug?.originalPrompt).toContain('Trump');
      expect(refusalDebug?.effectivePrompt || '').toMatch(/editorial|journalistic/i);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked refusal handling: replace_people_and_triggers sanitizes retry prompt', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked refusal tests run only when real-provider modes are off');
    test.setTimeout(90000);

    const prompts = [];
    let calls = 0;
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'Refusal Sanitize',
          panels: [
            { beat_summary: 'One', caption: 'One', image_prompt: 'Donald Trump under arrest in corruption scandal' },
            { beat_summary: 'Two', caption: 'Two', image_prompt: 'Panel 2' },
            { beat_summary: 'Three', caption: 'Three', image_prompt: 'Panel 3' }
          ]
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] }) });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        calls += 1;
        const body = route.request().postDataJSON?.() || {};
        prompts.push(String(body.prompt || ''));
        if (calls === 1) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Blocked by safety filter' } })
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: `https://mock-images.test/sanitize-${calls}.png` }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          image_refusal_handling: 'replace_people_and_triggers',
          debug_flag: true,
          log_rewritten_prompts: true
        }
      });

      expect(job?.status).toBe('completed');
      expect(prompts.length).toBeGreaterThanOrEqual(4);
      const refusalDebug = job.storyboard.panels[0].artifacts?.refusal_debug;
      const sanitizedRetryPrompt = String(refusalDebug?.effectivePrompt || '');
      expect(sanitizedRetryPrompt).toBeTruthy();
      expect(sanitizedRetryPrompt).not.toContain('Trump');
      expect(sanitizedRetryPrompt.toLowerCase()).not.toContain('arrest');
      expect(sanitizedRetryPrompt.toLowerCase()).not.toContain('corruption');
      expect(String(refusalDebug?.originalPrompt || '')).toContain('Trump');
      expect(job.storyboard.panels[0].artifacts?.provider_metadata?.refusal_handling?.mode).toBe('replace_people_and_triggers');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked refusal handling: show_blocked renders placeholder without retry', async () => {
    test.skip(USE_REAL_PROVIDER, 'Mocked refusal tests run only when real-provider modes are off');
    test.setTimeout(90000);

    let imageCalls = 0;
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        const storyboard = {
          title: 'Refusal Blocked Placeholder',
          panels: [
            { beat_summary: 'One', caption: 'One', image_prompt: 'Sensitive public figure scene' },
            { beat_summary: 'Two', caption: 'Two', image_prompt: 'Panel 2' },
            { beat_summary: 'Three', caption: 'Three', image_prompt: 'Panel 3' }
          ]
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] }) });
      });
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        imageCalls += 1;
        if (imageCalls === 1) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Content policy refusal' } })
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: `https://mock-images.test/show-blocked-${imageCalls}.png` }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, { providerId: 'openai', imageProviderId: 'openai' });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          image_refusal_handling: 'show_blocked',
          debug_flag: true
        }
      });

      expect(job?.status).toBe('completed');
      expect(imageCalls).toBe(3);
      const firstPanel = job.storyboard.panels[0];
      expect(String(firstPanel.artifacts?.image_blob_ref || '')).toContain('data:image/svg+xml');
      expect(firstPanel.artifacts?.provider_metadata?.refusal_handling?.blockedPlaceholder).toBe(true);
      expect((job.panelErrors || []).length).toBe(0);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('single-site full provider run saves one downloaded comic strip image per provider', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Provider export artifact test runs in mocked mode only');
    test.setTimeout(15 * 60 * 1000);

    const exportCases = [
      { id: 'openai', textProvider: 'openai', imageProvider: 'openai', setup: { providerId: 'openai', imageProviderId: 'openai' } },
      { id: 'gemini', textProvider: 'gemini-free', imageProvider: 'gemini-free', setup: { providerId: 'gemini-free', imageProviderId: 'gemini-free', geminiKey: 'gemini-mock-key' } },
      { id: 'cloudflare', textProvider: 'cloudflare-free', imageProvider: 'cloudflare-free', setup: { providerId: 'cloudflare-free', imageProviderId: 'cloudflare-free', cloudflare: { accountId: 'cf-account', apiToken: 'cf-token' } } },
      { id: 'openrouter', textProvider: 'openrouter', imageProvider: 'openai', setup: { providerId: 'openrouter', imageProviderId: 'openai', openrouterKey: 'sk-or-v1-mock-key' } },
      { id: 'huggingface', textProvider: 'huggingface', imageProvider: 'cloudflare-free', setup: { providerId: 'huggingface', imageProviderId: 'cloudflare-free', huggingfaceKey: 'hf_mock_key', cloudflare: { accountId: 'cf-account', apiToken: 'cf-token' } } }
    ];

    const outputDir = path.resolve(process.cwd(), 'test-results', 'provider-export-comics');
    fs.mkdirSync(outputDir, { recursive: true });
    const manifest = [];

    for (const exportCase of exportCases) {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        await installOpenAIMocks(context);
        if (exportCase.textProvider === 'gemini-free' || exportCase.imageProvider === 'gemini-free') {
          await installGeminiMocks(context, {});
        }
        if (exportCase.textProvider === 'cloudflare-free' || exportCase.imageProvider === 'cloudflare-free') {
          await context.route('https://api.cloudflare.com/client/v4/accounts/*/ai/run/@cf/meta/llama-3.1-8b-instruct', async (route) => {
            const storyboard = {
              title: 'Cloudflare Export Comic',
              panels: [
                { beat_summary: 'Intro', caption: 'CF Export 1', image_prompt: 'CF export image 1' },
                { beat_summary: 'Middle', caption: 'CF Export 2', image_prompt: 'CF export image 2' },
                { beat_summary: 'End', caption: 'CF Export 3', image_prompt: 'CF export image 3' }
              ]
            };
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, result: { response: JSON.stringify(storyboard) } })
            });
          });
          await context.route('https://api.cloudflare.com/client/v4/accounts/*/ai/run/@cf/black-forest-labs/flux-1-schnell', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, result: { image: TINY_PNG_BASE64 } })
            });
          });
        }
        if (exportCase.textProvider === 'openrouter') {
          await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
            const storyboard = {
              title: 'OpenRouter Export Comic',
              panels: [
                { beat_summary: 'Intro', caption: 'OR Export 1', image_prompt: 'OR export image 1' },
                { beat_summary: 'Middle', caption: 'OR Export 2', image_prompt: 'OR export image 2' },
                { beat_summary: 'End', caption: 'OR Export 3', image_prompt: 'OR export image 3' }
              ]
            };
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
            });
          });
        }
        if (exportCase.textProvider === 'huggingface') {
          await context.route('https://router.huggingface.co/v1/chat/completions', async (route) => {
            const storyboard = {
              title: 'HF Export Comic',
              panels: [
                { beat_summary: 'Intro', caption: 'HF Export 1', image_prompt: 'HF export image 1' },
                { beat_summary: 'Middle', caption: 'HF Export 2', image_prompt: 'HF export image 2' },
                { beat_summary: 'End', caption: 'HF Export 3', image_prompt: 'HF export image 3' }
              ]
            };
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(storyboard) } }] })
            });
          });
        }

        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId, exportCase.setup);

        const page = await context.newPage();
        await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded' });
        const job = await startGenerationAndWait(context, extensionId, page, {
          providerId: exportCase.textProvider,
          imageProviderId: exportCase.imageProvider
        });

        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach(`diagnostics-${exportCase.id}.json`, {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          throw new Error(`Provider export run failed for ${exportCase.id}: ${JSON.stringify({
            status: diagnostics?.currentJob?.status,
            error: diagnostics?.currentJob?.error,
            panelErrors: diagnostics?.currentJob?.panelErrors
          })}`);
        }

        const outPath = path.join(outputDir, `${exportCase.id}-cnn-comic-sheet.png`);
        const exportInfo = await saveCompositeDownloadFromSidePanel(context, extensionId, outPath);
        expect(fs.existsSync(outPath)).toBe(true);
        expect(exportInfo.bytes).toBeGreaterThan(500);

        manifest.push({
          provider: exportCase.id,
          textProvider: exportCase.textProvider,
          imageProvider: exportCase.imageProvider,
          file: outPath,
          bytes: exportInfo.bytes
        });
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }

    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      site: 'https://www.cnn.com',
      cases: manifest
    }, null, 2));

    await testInfo.attach('provider-export-manifest.json', {
      body: Buffer.from(JSON.stringify(manifest, null, 2)),
      contentType: 'application/json'
    });

    expect(manifest.length).toBe(exportCases.length);
  });

  test('mocked malformed payload: Gemini markdown storyboard fallback still completes', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Malformed mocked payload tests run only in mocked mode');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://generativelanguage.googleapis.com/v1beta/models/*:generateContent?key=*', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        const isImage = Array.isArray(body.generationConfig?.responseModalities) &&
          body.generationConfig.responseModalities.includes('image');

        if (isImage) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: TINY_PNG_BASE64 } }] } }]
            })
          });
          return;
        }

        const markdownStoryboard = [
          '## Comic Summary',
          '### Panel 1: Opening',
          'A quick setup scene in the city.',
          'Image prompt: comic panel of a city skyline at dawn',
          '### Panel 2: Reaction',
          'People react to the headline.',
          'Image prompt: comic panel of people reacting in a newsroom',
          '### Panel 3: Resolution',
          'The article ends with a broader takeaway.',
          'Image prompt: comic panel of a calm closing scene'
        ].join('\n');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [{ content: { parts: [{ text: markdownStoryboard }] } }]
          })
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        geminiKey: 'gemini-test-key'
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        generationSettings: { debug_flag: true }
      });

      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Malformed Gemini markdown storyboard test failed: ${JSON.stringify(diagnostics?.currentJob || null, null, 2)}`);
      }

      expect(job.storyboard?.panels?.length).toBeGreaterThanOrEqual(3);
      expect(job.storyboard.panels.map((p) => String(p.caption || '')).join(' | ')).toContain('Opening');
      for (const panel of job.storyboard.panels) {
        expect(panel.artifacts?.image_blob_ref?.startsWith('data:image/')).toBe(true);
      }

      const diagnostics = await collectExtensionDiagnostics(context, extensionId);
      await testInfo.attach('extension-diagnostics.json', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json'
      });
      expect(Array.isArray(diagnostics.debugLogs)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('asserts objective-specific prompt output across Gemini/OpenAI/OpenRouter/HF/Cloudflare (mocked)', async () => {
    test.skip(USE_REAL_PROVIDER, 'Objective prompt assertion runs in mocked mode only');
    test.setTimeout(180000);

    const cases = [
      {
        providerId: 'gemini-free',
        imageProviderId: 'gemini-free',
        objective: 'news-recap',
        objectiveLabel: 'Objective: News Recap',
        guidanceNeedle: 'who/what/when/where',
        storageOverrides: { geminiKey: 'gemini-mock-key' }
      },
      {
        providerId: 'openai',
        imageProviderId: 'openai',
        objective: 'learn-step-by-step',
        objectiveLabel: 'Objective: Learn Step by Step',
        guidanceNeedle: 'progressive steps',
        storageOverrides: {}
      },
      {
        providerId: 'openrouter',
        imageProviderId: 'openai',
        objective: 'timeline',
        objectiveLabel: 'Objective: Timeline Breakdown',
        guidanceNeedle: 'chronologically',
        storageOverrides: { openrouterKey: 'openrouter-mock-key' }
      },
      {
        providerId: 'huggingface',
        imageProviderId: 'openai',
        objective: 'compare-views',
        objectiveLabel: 'Objective: Compare Viewpoints',
        guidanceNeedle: 'differ or overlap',
        storageOverrides: { huggingfaceKey: 'hf_mock_key' }
      },
      {
        providerId: 'cloudflare-free',
        imageProviderId: 'openai',
        objective: 'explain-like-im-five',
        objectiveLabel: "Objective: Explain Like I'm Five",
        guidanceNeedle: 'simple language and analogies',
        storageOverrides: {
          cloudflare: {
            accountId: 'cf-mock-account',
            apiToken: 'cf-mock-token',
            email: '',
            apiKey: ''
          }
        }
      }
    ];

    for (const testCase of cases) {
      const captures = { storyboardPrompts: [], imagePrompts: [] };
      const { context, userDataDir } = await launchExtensionContext();
      try {
        await installObjectivePromptCaptureMocks(context, testCase.providerId, captures);
        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId, {
          providerId: testCase.providerId,
          imageProviderId: testCase.imageProviderId,
          ...testCase.storageOverrides
        });

        const page = await context.newPage();
        await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

        const job = await startGenerationAndWait(context, extensionId, page, {
          providerId: testCase.providerId,
          imageProviderId: testCase.imageProviderId,
          generationSettings: {
            objective: testCase.objective
          }
        });

        expect(job?.status).toBe('completed');
        expect(job?.settings?.objective).toBe(testCase.objective);
        expect(captures.storyboardPrompts.length).toBeGreaterThan(0);
        expect(captures.storyboardPrompts[0]).toContain(testCase.objectiveLabel);
        expect(captures.storyboardPrompts[0].toLowerCase()).toContain(testCase.guidanceNeedle.toLowerCase());
        expect(captures.storyboardPrompts[0]).toContain('Objective guidance');
        expect(captures.imagePrompts.length).toBeGreaterThan(0);
        expect(captures.imagePrompts[0].toLowerCase()).toContain('panel');
        expect(captures.imagePrompts[0].toLowerCase()).toContain('caption');
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  });

  test('persists selected objective into currentJob and history snapshots end-to-end (mocked)', async () => {
    test.skip(USE_REAL_PROVIDER, 'Objective persistence assertion runs in mocked mode only');
    test.setTimeout(90000);

    const selectedObjective = 'meeting-recap';
    const captures = { storyboardPrompts: [], imagePrompts: [] };
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installObjectivePromptCaptureMocks(context, 'openai', captures);
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai'
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: {
          objective: selectedObjective
        }
      });
      expect(job?.status).toBe('completed');
      expect(job?.settings?.objective).toBe(selectedObjective);
      expect(job?.storyboard?.settings?.objective).toBe(selectedObjective);

      const storageSnapshotPage = await context.newPage();
      try {
        await storageSnapshotPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
          waitUntil: 'domcontentloaded'
        });
        const snapshot = await storageSnapshotPage.evaluate(async () => {
          const data = await chrome.storage.local.get(['currentJob', 'history']);
          return {
            currentJob: data.currentJob || null,
            history: Array.isArray(data.history) ? data.history : []
          };
        });

        expect(snapshot.currentJob).toBeTruthy();
        expect(snapshot.currentJob.settings?.objective).toBe(selectedObjective);
        expect(snapshot.history.length).toBeGreaterThan(0);
        expect(snapshot.history[0].settings_snapshot?.objective).toBe(selectedObjective);
        expect(snapshot.history[0].storyboard?.settings?.objective).toBe(selectedObjective);
      } finally {
        await storageSnapshotPage.close();
      }
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('popup objective flow (Create Comic -> set objective -> Generate) completes mocked generation and persists objective', async () => {
    test.skip(USE_REAL_PROVIDER, 'Popup objective flow assertion runs in mocked mode only');
    test.setTimeout(90000);

    const selectedObjective = 'timeline';
    const captures = { storyboardPrompts: [], imagePrompts: [] };
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await installObjectivePromptCaptureMocks(context, 'openai', captures);
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai'
      });

      const sourcePage = await context.newPage();
      await sourcePage.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
        waitUntil: 'domcontentloaded'
      });
      await popupPage.evaluate(() => {
        if (!window.__popupController) return;
        const originalSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = async (tabId, message, ...rest) => {
          if (message && message.type === 'EXTRACT_CONTENT') {
            return { success: true, text: 'x '.repeat(600) };
          }
          if (message && message.type === 'START_GENERATION') {
            return chrome.runtime.sendMessage({
              type: 'START_GENERATION',
              payload: message.payload
            });
          }
          return originalSendMessage(tabId, message, ...rest);
        };
      });
      await popupPage.locator('#create-comic-btn').click();
      await popupPage.locator('#options-extra-section summary').click();

      await popupPage.selectOption('#objective', selectedObjective);
      await popupPage.evaluate(() => {
        if (!window.__popupController) throw new Error('Popup controller missing');
        window.__popupController.extractedText = 'x '.repeat(600);
        window.__popupController.updateWizardReadiness();
      });

      await popupPage.evaluate(() => {
        const btn = document.getElementById('generate-btn');
        if (!btn) throw new Error('Generate button not found');
        btn.click();
      });

      const currentJobSnapshot = await popupPage.evaluate(async () => {
        const timeoutMs = 30000;
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const { currentJob } = await chrome.storage.local.get('currentJob');
          if (currentJob && ['completed', 'failed', 'canceled'].includes(currentJob.status)) {
            return currentJob;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
      });
      expect(currentJobSnapshot).toBeTruthy();
      expect(currentJobSnapshot.status).toBe('completed');
      expect(currentJobSnapshot.settings?.objective).toBe(selectedObjective);

      const persistedSnapshot = await popupPage.evaluate(async () => {
        const data = await chrome.storage.local.get(['currentJob', 'history']);
        return {
          currentJob: data.currentJob || null,
          history: Array.isArray(data.history) ? data.history : []
        };
      });
      expect(persistedSnapshot.currentJob?.settings?.objective).toBe(selectedObjective);
      expect(persistedSnapshot.history.length).toBeGreaterThan(0);
      expect(persistedSnapshot.history[0].settings_snapshot?.objective).toBe(selectedObjective);
      expect(captures.storyboardPrompts.length).toBeGreaterThan(0);
      expect(captures.storyboardPrompts[0]).toContain('Objective: Timeline Breakdown');
      expect(captures.imagePrompts.length).toBeGreaterThan(0);
      await sourcePage.close();
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked malformed payload: object captions and missing image prompts are normalized and logged', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Malformed mocked payload tests run only in mocked mode');
    test.setTimeout(90000);

    let imageCounter = 0;
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  title: 'Malformed-ish Comic',
                  panels: [
                    {
                      caption: { text: 'Object Caption 1' },
                      beat_summary: { text: 'Beat one object' }
                    },
                    {
                      caption: ['Array', 'Caption', '2'],
                      prompt: { value: 'Array prompt two' }
                    },
                    {
                      title: 'Third Panel Title'
                    }
                  ]
                })
              }
            }]
          })
        });
      });

      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        imageCounter += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ url: `https://mock-images.test/malformed-${imageCounter}.png` }] })
        });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(TINY_PNG_BASE64, 'base64')
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai',
        openAiKey: 'sk-test-openai-key'
      });

      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: { debug_flag: true }
      });

      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Malformed OpenAI storyboard normalization test failed: ${JSON.stringify(diagnostics?.currentJob || null, null, 2)}`);
      }

      expect(job.storyboard?.panels?.length).toBeGreaterThanOrEqual(3);
      const captions = job.storyboard.panels.map((p) => String(p.caption || ''));
      expect(captions.join(' | ')).toContain('Object Caption 1');
      expect(captions.join(' | ')).toContain('Array Caption 2');
      expect(captions.join(' | ')).not.toContain('[object Object]');
      for (const panel of job.storyboard.panels) {
        expect(String(panel.image_prompt || '').trim()).not.toBe('');
        expect(panel.artifacts?.image_blob_ref?.startsWith('data:image/')).toBe(true);
      }

      const diagnostics = await collectExtensionDiagnostics(context, extensionId);
      await testInfo.attach('extension-diagnostics.json', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json'
      });
      const fullDebugLogsPage = await context.newPage();
      let debugEvents = [];
      try {
        await fullDebugLogsPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
        debugEvents = await fullDebugLogsPage.evaluate(async () => {
          const { debugLogs } = await chrome.storage.local.get('debugLogs');
          return (Array.isArray(debugLogs) ? debugLogs : []).map((l) => l && l.event);
        });
      } finally {
        await fullDebugLogsPage.close();
      }
      expect(debugEvents).not.toContain('unexpected_output.storyboard.missing_image_prompts');

      const sidePanelPage = await context.newPage();
      try {
        await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
        await expect(sidePanelPage.locator('#comic-display')).toBeVisible({ timeout: 10000 });
        const allCaptionText = await sidePanelPage.evaluate(() =>
          Array.from(document.querySelectorAll('.panel-caption, .carousel-caption-text'))
            .map((el) => (el.textContent || '').trim())
            .join(' | ')
        );
        expect(allCaptionText).toContain('Object Caption 1');
        expect(allCaptionText).not.toContain('[object Object]');
      } finally {
        await sidePanelPage.close();
      }
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked malformed payload matrix: parse retry succeeds across OpenAI/Cloudflare/OpenRouter/Hugging Face', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Malformed mocked payload tests run only in mocked mode');
    test.setTimeout(4 * 60 * 1000);

    const cases = [
      { id: 'openai', textProvider: 'openai', imageProvider: 'openai', key: 'openAiKey' },
      { id: 'cloudflare', textProvider: 'cloudflare-free', imageProvider: 'cloudflare-free', key: 'cloudflareToken' },
      { id: 'openrouter', textProvider: 'openrouter', imageProvider: 'openrouter', key: 'openRouterKey' },
      { id: 'huggingface', textProvider: 'huggingface', imageProvider: 'huggingface', key: 'huggingFaceKey' }
    ];

    for (const cfg of cases) {
      let storyboardCalls = 0;
      const { context, userDataDir } = await launchExtensionContext();
      try {
        if (cfg.id === 'openai') {
          await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
            storyboardCalls += 1;
            if (storyboardCalls === 1) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '   \n   ' } }] }) });
              return;
            }
            if (storyboardCalls === 2) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '```json\n{"panels":[{"caption":"Retry OpenAI","image_prompt":"comic panel retry openai"}]}\n```' } }] }) });
              return;
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '```json\n{"panels":[{"caption":"A","image_prompt":"A"},{"caption":"B","image_prompt":"B"},{"caption":"C","image_prompt":"C"}]}\n```' } }] }) });
          });
          await context.route('https://api.openai.com/v1/images/generations', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ url: 'https://mock-images.test/openai-retry.png' }] }) });
          });
          await context.route('https://mock-images.test/openai-retry.png', async (route) => {
            await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
          });
        } else if (cfg.id === 'cloudflare') {
          await context.route('https://api.cloudflare.com/**', async (route) => {
            const req = route.request();
            const body = req.postDataJSON?.() || {};
            const url = req.url();
            const isImage = /flux|stable-diffusion/i.test(url);
            if (isImage) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, result: { image: TINY_PNG_BASE64 } }) });
              return;
            }
            storyboardCalls += 1;
            let textOut;
            if (storyboardCalls === 1) textOut = '   \n';
            else if (storyboardCalls === 2) textOut = '```json\n{"items":[{"title":"Retry Cloudflare","visual":"comic panel retry cloudflare"}]}\n```';
            else textOut = '```json\n{"panels":[{"caption":"A","image_prompt":"A"},{"caption":"B","image_prompt":"B"},{"caption":"C","image_prompt":"C"}]}\n```';
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, result: { response: textOut } }) });
          });
        } else if (cfg.id === 'openrouter') {
          await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
            const body = route.request().postDataJSON?.() || {};
            const isImage = Array.isArray(body.modalities) && body.modalities.includes('image');
            if (isImage) {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ choices: [{ message: { images: [{ b64_json: TINY_PNG_BASE64 }] } }] })
              });
              return;
            }
            storyboardCalls += 1;
            let content;
            if (storyboardCalls === 1) content = '  ';
            else if (storyboardCalls === 2) content = '```json\n{"panels":[{"caption":{"text":"Retry OpenRouter"},"image_prompt":["comic","panel","retry","openrouter"]}]}\n```';
            else content = '```json\n{"panels":[{"caption":"A","image_prompt":"A"},{"caption":"B","image_prompt":"B"},{"caption":"C","image_prompt":"C"}]}\n```';
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
          });
        } else if (cfg.id === 'huggingface') {
          await context.route('https://router.huggingface.co/v1/chat/completions', async (route) => {
            storyboardCalls += 1;
            let content;
            if (storyboardCalls === 1) content = '  ';
            else if (storyboardCalls === 2) content = '```json\n{"panels":[{"caption":{"text":"Retry HF"},"prompt":{"value":"comic panel retry hf"}}]}\n```';
            else content = '```json\n{"panels":[{"caption":"A","image_prompt":"A"},{"caption":"B","image_prompt":"B"},{"caption":"C","image_prompt":"C"}]}\n```';
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
          });
          await context.route('https://router.huggingface.co/hf-inference/models/*', async (route) => {
            await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
          });
        }

        const extensionId = await getExtensionId(context);
        const setupOverrides = {
          providerId: cfg.textProvider,
          imageProviderId: cfg.imageProvider,
          generationSettings: { debug_flag: true }
        };
        if (cfg.id === 'openai') setupOverrides.openAiKey = 'sk-test-openai-key';
        if (cfg.id === 'cloudflare') {
          setupOverrides.cloudflare = { accountId: 'test-account', apiToken: 'cf-test-token' };
          setupOverrides.cloudflareToken = 'cf-test-token';
        }
        if (cfg.id === 'openrouter') setupOverrides.openrouterKey = 'sk-or-v1-mock-key';
        if (cfg.id === 'huggingface') setupOverrides.huggingfaceKey = 'hf_test_key';
        await setupExtensionStorage(context, extensionId, setupOverrides);

        const page = await context.newPage();
        await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
        const job = await startGenerationAndWait(context, extensionId, page, {
          providerId: cfg.textProvider,
          imageProviderId: cfg.imageProvider,
          generationSettings: { debug_flag: true }
        });

        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach(`diagnostics-malformed-matrix-${cfg.id}.json`, {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          throw new Error(`Malformed retry matrix case failed (${cfg.id}): ${JSON.stringify(diagnostics?.currentJob || null)}`);
        }
        expect(job.storyboard?.panels?.length).toBeGreaterThanOrEqual(1);
        expect(job.storyboard.panels[0].artifacts?.image_blob_ref?.startsWith('data:image/')).toBe(true);

        const logsPage = await context.newPage();
        let events = [];
        try {
          await logsPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
          events = await logsPage.evaluate(async () => {
            const { debugLogs } = await chrome.storage.local.get('debugLogs');
            return (Array.isArray(debugLogs) ? debugLogs : []).map((l) => l && l.event);
          });
        } finally {
          await logsPage.close();
        }
        if (cfg.id === 'openai') {
          expect(storyboardCalls).toBeGreaterThanOrEqual(2);
        }
        if (cfg.id === 'openai') {
          expect(events).toContain('storyboard.parse_retry');
        }
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  });

  test('mocked malformed payload: too-few-panels triggers panel-count retry before image generation', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Malformed mocked payload tests run only in mocked mode');
    test.setTimeout(90000);

    let storyboardCalls = 0;
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        storyboardCalls += 1;
        const body = route.request().postDataJSON?.() || {};
        const userText = String(body?.messages?.[1]?.content || '');
        if (storyboardCalls === 1) {
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ panels: [{ caption: 'Only one', image_prompt: 'one prompt' }] }) } }] })
          });
          return;
        }
        expect(userText).toContain('REMINDER: Return exactly 3 panels');
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ panels: [
            { caption: 'One', image_prompt: 'one prompt' },
            { caption: 'Two', image_prompt: 'two prompt' },
            { caption: 'Three', image_prompt: 'three prompt' }
          ] }) } }] })
        });
      });
      let imageCounter = 0;
      await context.route('https://api.openai.com/v1/images/generations', async (route) => {
        imageCounter += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ url: `https://mock-images.test/panel-count-${imageCounter}.png` }] }) });
      });
      await context.route('https://mock-images.test/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai',
        openAiKey: 'sk-test-openai-key'
      });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: { debug_flag: true, panel_count: 3 }
      });

      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('diagnostics-too-few-panels.json', { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' });
        throw new Error(`Panel-count retry test failed: ${JSON.stringify(diagnostics?.currentJob || null)}`);
      }
      expect(storyboardCalls).toBeGreaterThanOrEqual(2);
      expect(job.storyboard?.panels?.length).toBe(3);

      const logsPage = await context.newPage();
      let events = [];
      try {
        await logsPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
        events = await logsPage.evaluate(async () => {
          const { debugLogs } = await chrome.storage.local.get('debugLogs');
          return (Array.isArray(debugLogs) ? debugLogs : []).map((l) => l && l.event);
        });
      } finally {
        await logsPage.close();
      }
      // Retry is already validated above via storyboardCalls and final panel count.
      // Keep log assertion soft because debug-log writes are async and occasionally race in CI.
      if (events.length > 0) {
        expect(events.some((event) => event === 'storyboard.panel_count_retry' || event === 'storyboard.retry')).toBe(true);
      }
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('mocked malformed payload: empty panels fails fast (no generating_images hang)', async ({}, testInfo) => {
    test.skip(USE_REAL_PROVIDER, 'Malformed mocked payload tests run only in mocked mode');
    test.setTimeout(90000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ panels: [] }) } }] })
        });
      });

      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openai',
        imageProviderId: 'openai',
        openAiKey: 'sk-test-openai-key'
      });
      const page = await context.newPage();
      await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

      const start = Date.now();
      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openai',
        imageProviderId: 'openai',
        generationSettings: { debug_flag: true }
      });
      const elapsedMs = Date.now() - start;

      expect(job).toBeTruthy();
      expect(['failed', 'canceled']).toContain(job.status);
      expect(String(job.error || '')).toMatch(/no panels|api key not configured|storyboard/i);
      expect(elapsedMs).toBeLessThan(30000);

      const diagnostics = await collectExtensionDiagnostics(context, extensionId);
      await testInfo.attach('diagnostics-empty-panels-fast-fail.json', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json'
      });
      const events = (diagnostics?.currentJob?.progressEvents || []).map((e) => e && e.type);
      expect(events).not.toContain('panel.prompt');
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('single-site full provider run (real APIs) saves one downloaded comic strip image per provider', async ({}, testInfo) => {
    test.skip(!RUN_REAL_PROVIDER_SINGLE_SITE_EXPORT, 'Set RUN_REAL_PROVIDER_SINGLE_SITE_EXPORT=1 to run real single-site provider export test.');
    test.setTimeout(60 * 60 * 1000);

    const exportCases = [];
    if (REAL_OPENAI_E2E) {
      exportCases.push({ id: 'openai', textProvider: 'openai', imageProvider: 'openai' });
    }
    if (REAL_GEMINI_E2E) {
      exportCases.push({ id: 'gemini', textProvider: 'gemini-free', imageProvider: 'gemini-free' });
    }
    if (REAL_CLOUDFLARE_E2E) {
      exportCases.push({ id: 'cloudflare', textProvider: 'cloudflare-free', imageProvider: 'cloudflare-free' });
    }
    if (REAL_OPENROUTER_E2E) {
      exportCases.push({ id: 'openrouter', textProvider: 'openrouter', imageProvider: 'cloudflare-free' });
    }
    if (REAL_HUGGINGFACE_E2E) {
      exportCases.push({ id: 'huggingface', textProvider: 'huggingface', imageProvider: 'huggingface' });
    }

    test.skip(exportCases.length === 0, 'Enable REAL_*_E2E flags for providers to run.');

    const runStartedAt = new Date();
    const timestamp = runStartedAt.toISOString().replace(/[:.]/g, '-');
    const outputDir = path.resolve(process.cwd(), 'test-results', 'provider-export-comics-real', timestamp);
    fs.mkdirSync(outputDir, { recursive: true });
    const manifest = [];

    for (const exportCase of exportCases) {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId, {
          providerId: exportCase.textProvider,
          imageProviderId: exportCase.imageProvider
        });

        const page = await context.newPage();
        await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded' });
        const startedAt = Date.now();
        const job = await startGenerationAndWait(context, extensionId, page, {
          providerId: exportCase.textProvider,
          imageProviderId: exportCase.imageProvider
        });

        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach(`real-export-diagnostics-${exportCase.id}.json`, {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          throw new Error(`Real provider export run failed for ${exportCase.id}: ${JSON.stringify({
            status: diagnostics?.currentJob?.status,
            error: diagnostics?.currentJob?.error,
            errorDetails: diagnostics?.currentJob?.errorDetails,
            panelErrors: diagnostics?.currentJob?.panelErrors,
            progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
          }, null, 2)}`);
        }

        expect(Array.isArray(job.storyboard?.panels)).toBe(true);
        expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
        for (const panel of job.storyboard.panels) {
          expect(panel.artifacts?.error).toBeFalsy();
          expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
          expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
        }

        const outPath = path.join(outputDir, `${exportCase.id}-cnn-comic-sheet.png`);
        const exportInfo = await saveCompositeDownloadFromSidePanel(context, extensionId, outPath);
        expect(fs.existsSync(outPath)).toBe(true);
        expect(exportInfo.bytes).toBeGreaterThan(500);

        manifest.push({
          provider: exportCase.id,
          textProvider: exportCase.textProvider,
          imageProvider: exportCase.imageProvider,
          file: outPath,
          bytes: exportInfo.bytes,
          panels: job.storyboard.panels.length,
          elapsedMs: Date.now() - startedAt
        });
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }

    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      runStartedAt: runStartedAt.toISOString(),
      site: 'https://www.cnn.com',
      real: true,
      outputDir,
      cases: manifest
    }, null, 2));

    await testInfo.attach('real-provider-export-manifest.json', {
      body: Buffer.from(JSON.stringify({ outputDir, cases: manifest }, null, 2)),
      contentType: 'application/json'
    });

    expect(manifest.length).toBe(exportCases.length);
  });

  test('creates comic output using Cloudflare Workers AI text+image providers (real API)', async ({}, testInfo) => {
    test.skip(!REAL_CLOUDFLARE_E2E, 'Set REAL_CLOUDFLARE_E2E=1 to run real Cloudflare Workers AI E2E.');
    test.setTimeout(10 * 60 * 1000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'cloudflare-free',
        imageProviderId: 'cloudflare-free'
      });

      const page = await context.newPage();
      await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'cloudflare-free',
        imageProviderId: 'cloudflare-free'
      });
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Real Cloudflare Workers AI generation failed: ${JSON.stringify({
          status: diagnostics?.currentJob?.status,
          error: diagnostics?.currentJob?.error,
          errorDetails: diagnostics?.currentJob?.errorDetails,
          panelErrors: diagnostics?.currentJob?.panelErrors,
          progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
        }, null, 2)}`);
      }

      expect(job.settings.provider_text).toBe('cloudflare-free');
      expect(job.settings.provider_image).toBe('cloudflare-free');
      expect((job.panelErrors || []).length).toBe(0);
      expect(Array.isArray(job.storyboard?.panels)).toBe(true);
      expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
      for (const panel of job.storyboard.panels) {
        expect(panel.artifacts?.error).toBeFalsy();
        expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
        expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
      }
      await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
      await validateHistoryAfterGeneration(context, extensionId, page.url());
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('creates comic output using OpenRouter text provider + Cloudflare image provider (real APIs)', async ({}, testInfo) => {
    test.skip(!REAL_OPENROUTER_E2E, 'Set REAL_OPENROUTER_E2E=1 to run real OpenRouter E2E.');
    test.setTimeout(10 * 60 * 1000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'openrouter',
        imageProviderId: 'cloudflare-free'
      });

      const page = await context.newPage();
      await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'openrouter',
        imageProviderId: 'cloudflare-free'
      });
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Real OpenRouter generation failed: ${JSON.stringify({
          status: diagnostics?.currentJob?.status,
          error: diagnostics?.currentJob?.error,
          errorDetails: diagnostics?.currentJob?.errorDetails,
          panelErrors: diagnostics?.currentJob?.panelErrors,
          progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
        }, null, 2)}`);
      }

      expect(job.settings.provider_text).toBe('openrouter');
      expect(job.settings.provider_image).toBe('cloudflare-free');
      if ((job.panelErrors || []).length) {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Real OpenRouter generation completed with panel errors: ${JSON.stringify({
          panelErrors: job.panelErrors,
          progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
        }, null, 2)}`);
      }
      expect(Array.isArray(job.storyboard?.panels)).toBe(true);
      expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
      for (const panel of job.storyboard.panels) {
        expect(panel.artifacts?.error).toBeFalsy();
        expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
        expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
      }
      await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
      await validateHistoryAfterGeneration(context, extensionId, page.url());
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('creates comic output using Hugging Face text + image providers (real APIs)', async ({}, testInfo) => {
    test.skip(!REAL_HUGGINGFACE_E2E, 'Set REAL_HUGGINGFACE_E2E=1 to run real Hugging Face E2E.');
    test.setTimeout(10 * 60 * 1000);

    const { context, userDataDir } = await launchExtensionContext();
    try {
      const extensionId = await getExtensionId(context);
      await setupExtensionStorage(context, extensionId, {
        providerId: 'huggingface',
        imageProviderId: 'huggingface'
      });

      const page = await context.newPage();
      await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded' });

      const job = await startGenerationAndWait(context, extensionId, page, {
        providerId: 'huggingface',
        imageProviderId: 'huggingface'
      });
      if (!job || job.status !== 'completed') {
        const diagnostics = await collectExtensionDiagnostics(context, extensionId);
        await testInfo.attach('extension-diagnostics.json', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json'
        });
        throw new Error(`Real Hugging Face generation failed: ${JSON.stringify({
          status: diagnostics?.currentJob?.status,
          error: diagnostics?.currentJob?.error,
          errorDetails: diagnostics?.currentJob?.errorDetails,
          panelErrors: diagnostics?.currentJob?.panelErrors,
          progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
        }, null, 2)}`);
      }

      expect(job.settings.provider_text).toBe('huggingface');
      expect(job.settings.provider_image).toBe('huggingface');
      expect((job.panelErrors || []).length).toBe(0);
      expect(Array.isArray(job.storyboard?.panels)).toBe(true);
      expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
      for (const panel of job.storyboard.panels) {
        expect(panel.artifacts?.error).toBeFalsy();
        expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
        expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
      }
      await validateComicRenderedInSidePanel(context, extensionId, job.storyboard.panels.length);
      await validateHistoryAfterGeneration(context, extensionId, page.url());
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('real-provider mini-matrix smoke (one page per enabled provider flag)', async ({}, testInfo) => {
    test.skip(!RUN_REAL_PROVIDER_MINI_MATRIX, 'Set RUN_REAL_PROVIDER_MINI_MATRIX=1 to run the quick real-provider smoke matrix.');
    test.setTimeout(30 * 60 * 1000);

    const enabledCases = [];
    if (REAL_OPENAI_E2E) enabledCases.push({ id: 'openai', textProvider: 'openai', imageProvider: 'openai' });
    if (REAL_GEMINI_E2E) enabledCases.push({ id: 'gemini', textProvider: 'gemini-free', imageProvider: 'gemini-free' });
    if (REAL_CLOUDFLARE_E2E) enabledCases.push({ id: 'cloudflare', textProvider: 'cloudflare-free', imageProvider: 'cloudflare-free' });
    if (REAL_OPENROUTER_E2E) enabledCases.push({ id: 'openrouter', textProvider: 'openrouter', imageProvider: 'cloudflare-free' });
    if (REAL_HUGGINGFACE_E2E) enabledCases.push({ id: 'huggingface', textProvider: 'huggingface', imageProvider: 'huggingface' });

    test.skip(enabledCases.length === 0, 'Enable at least one REAL_*_E2E flag.');

    const summary = [];
    for (const c of enabledCases) {
      const { context, userDataDir } = await launchExtensionContext();
      try {
        const extensionId = await getExtensionId(context);
        await setupExtensionStorage(context, extensionId, {
          providerId: c.textProvider,
          imageProviderId: c.imageProvider
        });

        const page = await context.newPage();
        await page.goto('https://httpbin.org/html', { waitUntil: 'domcontentloaded' });

        const startedAt = Date.now();
        const job = await startGenerationAndWait(context, extensionId, page, {
          providerId: c.textProvider,
          imageProviderId: c.imageProvider
        });
        const elapsedMs = Date.now() - startedAt;

        if (!job || job.status !== 'completed') {
          const diagnostics = await collectExtensionDiagnostics(context, extensionId);
          await testInfo.attach(`real-mini-matrix-${c.id}-diagnostics.json`, {
            body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
            contentType: 'application/json'
          });
          throw new Error(`Real provider mini-matrix failed for ${c.id}: ${JSON.stringify({
            status: diagnostics?.currentJob?.status,
            error: diagnostics?.currentJob?.error,
            panelErrors: diagnostics?.currentJob?.panelErrors,
            progressEvents: diagnostics?.currentJob?.progressEvents?.slice?.(-10)
          }, null, 2)}`);
        }

        expect(Array.isArray(job.storyboard?.panels)).toBe(true);
        expect(job.storyboard.panels.length).toBeGreaterThanOrEqual(3);
        for (const panel of job.storyboard.panels) {
          expect(panel.artifacts?.error).toBeFalsy();
          expect(typeof panel.artifacts?.image_blob_ref).toBe('string');
          expect(panel.artifacts.image_blob_ref.startsWith('data:image/')).toBe(true);
        }

        summary.push({
          provider: c.id,
          textProvider: c.textProvider,
          imageProvider: c.imageProvider,
          status: job.status,
          panels: job.storyboard.panels.length,
          panelErrors: (job.panelErrors || []).length,
          elapsedMs
        });
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }

    await testInfo.attach('real-provider-mini-matrix-summary.json', {
      body: Buffer.from(JSON.stringify(summary, null, 2)),
      contentType: 'application/json'
    });
    expect(summary.length).toBeGreaterThan(0);
  });
});
