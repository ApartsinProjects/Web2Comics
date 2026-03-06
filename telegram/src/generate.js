const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sharp = require('sharp');
const { execSync } = require('child_process');
const { runComicEngine, runComicEnginePanels, withRetries } = require('../../engine/src');
const { loadConfig } = require('../../engine/src/config');
const { extractFromHtml } = require('../../engine/src/input');
const { generateTextWithProvider } = require('../../engine/src/providers');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput } = require('./message-utils');
const { createImageStorageManagerFromEnv } = require('./image-storage');
const { URL_EXTRACT_MIN_CHARS } = require('./data/thresholds');

const SUPPORTED_OUTPUT_LANGS = new Set(['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'he']);
const PANEL_WATERMARK_TEXT = 'made with Web2Comics';
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-exp-image-generation';
const GEMINI_URL_EXTRACT_MODEL = 'gemini-3-flash-preview';
const GEMINI_ENRICH_MODEL = 'gemini-2.5-flash';
const URL_EXTRACTOR_VALUES = new Set(['gemini', 'chromium', 'firecrawl', 'jina', 'driftbot', 'diffbot']);
const URL_EXTRACTOR_PRIORITY = ['gemini', 'firecrawl', 'jina', 'driftbot', 'chromium'];
const ENRICHMENT_PROVIDER_VALUES = new Set([
  'wikipedia', 'wikidata', 'dbpedia', 'gdelt', 'googlekg',
  'jina', 'firecrawl', 'driftbot', 'gemini',
  'brave', 'tavily', 'exa', 'serper', 'serpapi'
]);
let playwrightInstallPromise = null;
let playwrightChromiumReady = false;

const PROVIDER_REQUIRED_ENV = {
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  huggingface: ['HUGGINGFACE_INFERENCE_API_TOKEN'],
  cohere: ['COHERE_API_KEY']
};

function trimForLog(value, maxLen = 300) {
  const raw = String(value == null ? '' : value);
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}...`;
}

function normalizeUrlExtractor(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'gemini';
  if (value === 'ai') return 'gemini';
  if (value === 'browser') return 'chromium';
  if (value === 'diffbot') return 'driftbot';
  if (URL_EXTRACTOR_VALUES.has(value)) return value;
  return 'gemini';
}

function getConfiguredUrlExtractor(config) {
  return normalizeUrlExtractor(config?.generation?.url_extractor || config?.generation?.extractor || 'gemini');
}

function getUrlExtractorAttemptOrder(selectedExtractor) {
  const selected = normalizeUrlExtractor(selectedExtractor);
  return [selected, ...URL_EXTRACTOR_PRIORITY].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
}

function normalizeEnrichmentProvider(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'wikipedia';
  if (value === 'diffbot') return 'driftbot';
  if (ENRICHMENT_PROVIDER_VALUES.has(value)) return value;
  return 'wikipedia';
}

function resolveShortPromptWordThreshold(config) {
  const raw = Number(config?.generation?.short_prompt_word_threshold);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(3, Math.min(24, Math.floor(raw)));
}

function resolveMaxContextItems(config) {
  const raw = Number(config?.generation?.max_context_items);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(12, Math.floor(raw)));
}

function resolveMaxEnrichmentChars(config) {
  const raw = Number(config?.generation?.max_enrichment_chars);
  if (!Number.isFinite(raw)) return 800;
  return Math.max(200, Math.min(4000, Math.floor(raw)));
}

function resolveIncludeSources(config) {
  const raw = config?.generation?.include_sources;
  if (raw == null) return true;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return true;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveAutoEnrichEnabled(config) {
  const raw = config?.generation?.auto_enrich_short_story_prompts;
  if (raw == null) return true;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return true;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getUrlExtractionFailureReason(extracted) {
  const title = String(extracted?.title || '').trim();
  const text = String(extracted?.text || '').trim();
  const blockedReason = String(extracted?.blockedReason || '').trim();
  if (blockedReason) {
    return `web page is blocked or gated (${blockedReason})`;
  }
  if (text.length < URL_EXTRACT_MIN_CHARS) {
    return `not enough readable story text extracted (${text.length} chars)`;
  }
  if (/^(just a moment|access denied|please enable javascript)/i.test(`${title} ${text}`)) {
    return 'page appears gated and not readable without browser/session access';
  }
  return '';
}

async function extractStoryFromUrlText(inputUrl, runtime, config = {}, options = {}) {
  const url = String(inputUrl || '').trim();
  if (!url) throw new Error('URL extraction failed: empty URL');
  const selectedExtractor = getConfiguredUrlExtractor(config);
  if (String(process.env.RENDER_BOT_FAKE_URL_EXTRACTOR || '').trim().toLowerCase() === 'true') {
    if (String(process.env.RENDER_BOT_FAKE_URL_FETCH_FAIL || '').trim().toLowerCase() === 'true') {
      throw new Error('URL fetch failed (forced test mode)');
    }
    const text = 'A protagonist encounters a problem, follows clues, and reaches a clear resolution in a concise narrative arc suitable for comics. The story includes setting, conflict, turning point, and outcome.';
    return {
      extractorSelected: selectedExtractor,
      extractorUsed: selectedExtractor,
      text,
      title: 'Synthetic URL Story',
      inputPath: ''
    };
  }
  const attemptOrder = getUrlExtractorAttemptOrder(selectedExtractor);
  let lastError = null;

  for (const extractor of attemptOrder) {
    try {
      if (extractor === 'gemini') {
        const extracted = await extractStoryViaGeminiUrlContext(url, runtime, config);
        const text = String(extracted?.text || '').trim();
        if (text.length < URL_EXTRACT_MIN_CHARS) {
          throw new Error(`URL extraction failed: not enough readable story text extracted (${text.length} chars)`);
        }
        if (selectedExtractor !== extractor && typeof options.onExtractorFallback === 'function') {
          await options.onExtractorFallback({ from: selectedExtractor, to: extractor, reason: 'extractor_failure' });
        }
        return { extractorSelected: selectedExtractor, extractorUsed: extractor, text, title: String(extracted?.title || '').trim(), inputPath: '' };
      }
      if (extractor === 'firecrawl') {
        const extracted = await extractStoryViaFirecrawl(url, runtime);
        const text = String(extracted?.text || '').trim();
        if (text.length < URL_EXTRACT_MIN_CHARS) {
          throw new Error(`URL extraction failed: not enough readable story text extracted (${text.length} chars)`);
        }
        if (selectedExtractor !== extractor && typeof options.onExtractorFallback === 'function') {
          await options.onExtractorFallback({ from: selectedExtractor, to: extractor, reason: 'extractor_failure' });
        }
        return { extractorSelected: selectedExtractor, extractorUsed: extractor, text, title: String(extracted?.title || '').trim(), inputPath: '' };
      }
      if (extractor === 'jina') {
        const extracted = await extractStoryViaJina(url, runtime);
        const text = String(extracted?.text || '').trim();
        if (text.length < URL_EXTRACT_MIN_CHARS) {
          throw new Error(`URL extraction failed: not enough readable story text extracted (${text.length} chars)`);
        }
        if (selectedExtractor !== extractor && typeof options.onExtractorFallback === 'function') {
          await options.onExtractorFallback({ from: selectedExtractor, to: extractor, reason: 'extractor_failure' });
        }
        return { extractorSelected: selectedExtractor, extractorUsed: extractor, text, title: String(extracted?.title || '').trim(), inputPath: '' };
      }
      if (extractor === 'driftbot') {
        const extracted = await extractStoryViaDriftbot(url, runtime);
        const text = String(extracted?.text || '').trim();
        if (text.length < URL_EXTRACT_MIN_CHARS) {
          throw new Error(`URL extraction failed: not enough readable story text extracted (${text.length} chars)`);
        }
        if (selectedExtractor !== extractor && typeof options.onExtractorFallback === 'function') {
          await options.onExtractorFallback({ from: selectedExtractor, to: extractor, reason: 'extractor_failure' });
        }
        return { extractorSelected: selectedExtractor, extractorUsed: extractor, text, title: String(extracted?.title || '').trim(), inputPath: '' };
      }

      const snapshotPath = buildSnapshotPath(url, path.join(runtime.outDir, `render-url-${Date.now()}.png`), '');
      let snap;
      try {
        snap = await fetchUrlToHtmlSnapshot(url, snapshotPath, {
          timeoutMs: runtime.fetchTimeoutMs,
          waitUntil: 'domcontentloaded'
        });
      } catch (error) {
        if (!shouldInstallPlaywrightBrowser(error)) throw error;
        await ensurePlaywrightChromiumInstalledAsync('url_extraction_missing_browser');
        snap = await fetchUrlToHtmlSnapshot(url, snapshotPath, {
          timeoutMs: runtime.fetchTimeoutMs,
          waitUntil: 'domcontentloaded'
        });
      }
      const html = await fs.promises.readFile(snap.snapshotPath, 'utf8');
      const extracted = extractFromHtml(html, {});
      const failureReason = getUrlExtractionFailureReason(extracted);
      if (failureReason) throw new Error(`URL extraction failed: ${failureReason}`);
      const text = String(extracted?.text || '').trim();
      if (text.length < URL_EXTRACT_MIN_CHARS) {
        throw new Error(`URL extraction failed: not enough readable story text extracted (${text.length} chars)`);
      }
      if (selectedExtractor !== extractor && typeof options.onExtractorFallback === 'function') {
        await options.onExtractorFallback({ from: selectedExtractor, to: extractor, reason: 'extractor_failure' });
      }
      return {
        extractorSelected: selectedExtractor,
        extractorUsed: extractor,
        text,
        title: String(extracted?.title || snap?.title || '').trim(),
        inputPath: snap.snapshotPath
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('URL extraction failed');
}

function getGeminiApiKey() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('Missing GEMINI_API_KEY for Gemini URL extractor');
  return key;
}

function getFirecrawlApiKey() {
  const key = String(process.env.FIRECRAWL_API_KEY || '').trim();
  if (!key) throw new Error('Missing FIRECRAWL_API_KEY for Firecrawl URL extractor');
  return key;
}

function getJinaApiKey() {
  const key = String(process.env.JINA_API_KEY || '').trim();
  if (!key) throw new Error('Missing JINA_API_KEY for Jina URL extractor');
  return key;
}

function getDriftbotApiKey() {
  const key = String(process.env.DRIFTBOT_API_KEY || process.env.DIFFBOT_API_KEY || '').trim();
  if (!key) throw new Error('Missing DRIFTBOT_API_KEY for Driftbot URL extractor');
  return key;
}

function getBraveSearchApiKey() {
  const key = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!key) throw new Error('Missing BRAVE_SEARCH_API_KEY for Brave enrichment');
  return key;
}

function getTavilyApiKey() {
  const key = String(process.env.TAVILY_API_KEY || '').trim();
  if (!key) throw new Error('Missing TAVILY_API_KEY for Tavily enrichment');
  return key;
}

function getExaApiKey() {
  const key = String(process.env.EXA_API_KEY || '').trim();
  if (!key) throw new Error('Missing EXA_API_KEY for Exa enrichment');
  return key;
}

function getSerperApiKey() {
  const key = String(process.env.SERPER_API_KEY || '').trim();
  if (!key) throw new Error('Missing SERPER_API_KEY for Serper enrichment');
  return key;
}

function getSerpApiKey() {
  const key = String(process.env.SERPAPI_API_KEY || '').trim();
  if (!key) throw new Error('Missing SERPAPI_API_KEY for SerpAPI enrichment');
  return key;
}

function getGoogleKgApiKey() {
  const key = String(process.env.GOOGLE_KG_API_KEY || '').trim();
  if (!key) throw new Error('Missing GOOGLE_KG_API_KEY for Google KG enrichment');
  return key;
}

function parseGeminiTextResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => String(p?.text || '')).filter(Boolean).join('\n').trim();
}

async function extractStoryViaGeminiUrlContext(url, runtime, config) {
  const apiKey = getGeminiApiKey();
  const model = String(config?.generation?.url_extractor_gemini_model || GEMINI_URL_EXTRACT_MODEL).trim();
  const prompt = [
    'Use URL context tool to read the page and extract the most interesting story from it.',
    'Return detailed narrative text only (no markdown, no JSON, no bullets, no section titles).',
    'Preserve important facts, sequence, actors, and context.',
    `URL: ${url}`
  ].join('\n');
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ url_context: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  if (!response.ok) {
    const reason = String(json?.error?.message || raw || `HTTP ${response.status}`).slice(0, 800);
    throw new Error(`Gemini URL extractor failed (${response.status}): ${reason}`);
  }
  const extractedText = parseGeminiTextResponse(json);
  if (!extractedText) throw new Error('Gemini URL extractor returned empty text');
  return {
    text: extractedText,
    title: String(json?.candidates?.[0]?.content?.parts?.[0]?.title || '').trim(),
    metadata: { provider: 'gemini', model }
  };
}

async function extractStoryViaFirecrawl(url, runtime) {
  const apiKey = getFirecrawlApiKey();
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  if (!response.ok) {
    const reason = String(json?.error || json?.message || raw || `HTTP ${response.status}`).slice(0, 800);
    throw new Error(`Firecrawl URL extractor failed (${response.status}): ${reason}`);
  }
  if (json && json.success === false) {
    const reason = String(json?.error || json?.message || 'request failed').slice(0, 800);
    throw new Error(`Firecrawl URL extractor failed: ${reason}`);
  }
  const extractedText = String(
    json?.data?.markdown
    || json?.data?.content
    || json?.data?.text
    || ''
  ).trim();
  if (!extractedText) throw new Error('Firecrawl URL extractor returned empty text');
  return {
    text: extractedText,
    title: String(json?.data?.metadata?.title || json?.data?.title || '').trim(),
    metadata: { provider: 'firecrawl' }
  };
}

async function extractStoryViaJina(url, runtime) {
  const apiKey = getJinaApiKey();
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const endpoint = `https://r.jina.ai/${String(url || '').trim()}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'X-No-Cache': 'true'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  if (!response.ok) {
    const reason = String(raw || `HTTP ${response.status}`).slice(0, 800);
    throw new Error(`Jina URL extractor failed (${response.status}): ${reason}`);
  }
  let title = '';
  let extractedText = '';
  try {
    const json = raw ? JSON.parse(raw) : null;
    title = String(json?.data?.title || json?.title || '').trim();
    extractedText = String(json?.data?.content || json?.data?.text || json?.content || json?.text || '').trim();
  } catch (_) {
    extractedText = String(raw || '').trim();
  }
  if (!extractedText) throw new Error('Jina URL extractor returned empty text');
  return {
    text: extractedText,
    title,
    metadata: { provider: 'jina' }
  };
}

async function extractStoryViaDriftbot(url, runtime) {
  const apiKey = getDriftbotApiKey();
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const endpoint = `https://api.diffbot.com/v3/article?token=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(String(url || '').trim())}&discussion=false`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  if (!response.ok) {
    const reason = String(json?.error || json?.message || raw || `HTTP ${response.status}`).slice(0, 800);
    throw new Error(`Driftbot URL extractor failed (${response.status}): ${reason}`);
  }
  const first = (json?.objects && json.objects[0]) || {};
  const extractedText = String(
    first?.text
    || first?.html
    || ''
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!extractedText) throw new Error('Driftbot URL extractor returned empty text');
  return {
    text: extractedText,
    title: String(first?.title || '').trim(),
    metadata: { provider: 'driftbot' }
  };
}

function isFakeGeneratorEnabled() {
  return String(process.env.RENDER_BOT_FAKE_GENERATOR || '').trim().toLowerCase() === 'true';
}

function isFakeGeneratorOutOfOrderEnabled() {
  return String(process.env.RENDER_BOT_FAKE_OUT_OF_ORDER || '').trim().toLowerCase() === 'true';
}

function isFakeUrlFetchFailureEnabled() {
  return String(process.env.RENDER_BOT_FAKE_URL_FETCH_FAIL || '').trim().toLowerCase() === 'true';
}

async function maybeFakeDelay() {
  const delayMs = Math.max(0, Number(process.env.RENDER_BOT_FAKE_GENERATOR_DELAY_MS || 0));
  if (!delayMs) return;
  await new Promise((r) => setTimeout(r, delayMs));
}

async function writeFakePanelPng(filePath, index = 0, total = 1) {
  const safeTotal = Math.max(1, Number(total || 1));
  const safeIndex = Math.max(0, Number(index || 0));
  const hueBase = Math.floor((safeIndex % safeTotal) * (360 / safeTotal));
  const r = Math.floor(110 + (Math.sin((hueBase + 0) * (Math.PI / 180)) * 70));
  const g = Math.floor(110 + (Math.sin((hueBase + 120) * (Math.PI / 180)) * 70));
  const b = Math.floor(110 + (Math.sin((hueBase + 240) * (Math.PI / 180)) * 70));
  const png = await sharp({
    create: {
      width: 1024,
      height: 640,
      channels: 3,
      background: { r, g, b }
    }
  })
    .png()
    .toBuffer();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

function shouldInstallPlaywrightBrowser(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes("browsertype.launch: executable doesn't exist")
    || msg.includes('please run the following command to download new browsers')
    || msg.includes('chrome-headless-shell');
}

function normalizeLanguageCode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'iw') return 'he';
  if (v === 'jp') return 'ja';
  if (v === 'cn') return 'zh';
  const main = v.split(/[-_]/)[0];
  return SUPPORTED_OUTPUT_LANGS.has(main) ? main : '';
}

function detectLanguageFromText(text) {
  const s = String(text || '').trim();
  if (!s) return '';

  if (/[\u0590-\u05FF]/.test(s)) return 'he';
  if (/[\u0400-\u04FF]/.test(s)) return 'ru';
  if (/[\uAC00-\uD7AF]/.test(s)) return 'ko';
  if (/[\u3040-\u30FF]/.test(s)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(s)) return 'zh';

  const lower = ` ${s.toLowerCase()} `;
  const score = (words) => words.reduce((acc, w) => acc + (lower.includes(` ${w} `) ? 1 : 0), 0);
  const candidates = [
    { code: 'es', words: ['el', 'la', 'de', 'que', 'en', 'los', 'las'] },
    { code: 'fr', words: ['le', 'la', 'les', 'des', 'une', 'est', 'pour'] },
    { code: 'de', words: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein'] },
    { code: 'it', words: ['il', 'lo', 'la', 'gli', 'che', 'per', 'una'] },
    { code: 'pt', words: ['que', 'de', 'para', 'uma', 'com', 'não', 'os'] }
  ];
  let best = { code: '', points: 0 };
  candidates.forEach((c) => {
    const points = score(c.words);
    if (points > best.points) best = { code: c.code, points };
  });
  if (best.points >= 2) return best.code;

  return 'en';
}

function detectLanguageFromHtmlFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8').slice(0, 200000);
    const detectFromTokenList = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return '';
      const tokens = text
        .split(/[,\s;|]+/)
        .map((v) => String(v || '').trim())
        .filter(Boolean);
      for (const token of tokens) {
        const normalized = normalizeLanguageCode(token);
        if (normalized && normalized !== 'auto') return normalized;
      }
      const direct = normalizeLanguageCode(text);
      if (direct && direct !== 'auto') return direct;
      return '';
    };

    const candidates = [];
    const htmlLang = data.match(/<html[^>]*\b(?:lang|xml:lang)\s*=\s*["']?([^"'\s>]+)/i);
    if (htmlLang && htmlLang[1]) candidates.push(htmlLang[1]);
    const ogLocaleA = data.match(/<meta[^>]*\b(?:property|name)\s*=\s*["']og:locale["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i);
    if (ogLocaleA && ogLocaleA[1]) candidates.push(ogLocaleA[1]);
    const ogLocaleB = data.match(/<meta[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\b(?:property|name)\s*=\s*["']og:locale["']/i);
    if (ogLocaleB && ogLocaleB[1]) candidates.push(ogLocaleB[1]);
    const metaLanguageA = data.match(/<meta[^>]*\bname\s*=\s*["']language["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i);
    if (metaLanguageA && metaLanguageA[1]) candidates.push(metaLanguageA[1]);
    const metaLanguageB = data.match(/<meta[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']language["']/i);
    if (metaLanguageB && metaLanguageB[1]) candidates.push(metaLanguageB[1]);
    const metaLangA = data.match(/<meta[^>]*\bhttp-equiv\s*=\s*["']content-language["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i);
    if (metaLangA && metaLangA[1]) candidates.push(metaLangA[1]);
    const metaLangB = data.match(/<meta[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bhttp-equiv\s*=\s*["']content-language["']/i);
    if (metaLangB && metaLangB[1]) candidates.push(metaLangB[1]);
    const hreflangMatches = data.matchAll(/<link[^>]*\bhreflang\s*=\s*["']([^"']+)["'][^>]*>/gi);
    for (const m of hreflangMatches) {
      const v = String((m && m[1]) || '').trim().toLowerCase();
      if (!v || v === 'x-default') continue;
      candidates.push(v);
    }

    let detected = '';
    for (const c of candidates) {
      detected = detectFromTokenList(c);
      if (detected) break;
    }
    if (detected) return detected;

    // Remove non-content blocks before script-based fallback.
    const textOnly = data
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 8000);
    return detectLanguageFromText(textOnly);
  } catch (_) {
    return '';
  }
}

function resolveOutputLanguage(rawInputText, prep, config) {
  const configured = normalizeLanguageCode(config?.generation?.output_language || '');
  if (configured && configured !== 'auto') {
    return configured;
  }

  if (prep?.kind === 'url' && prep?.inputPath) {
    const fromHtml = detectLanguageFromHtmlFile(prep.inputPath);
    if (fromHtml) return fromHtml;
  }

  const fromText = detectLanguageFromText(prep?.sourceText || rawInputText || '');
  if (fromText) return fromText;
  return 'en';
}

function buildConfigPathForResolvedLanguage(effectiveConfigPath, config, outputLanguage) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (!next.generation || typeof next.generation !== 'object') next.generation = {};
  next.generation.output_language = outputLanguage;
  const base = path.resolve(effectiveConfigPath);
  const ext = path.extname(base) || '.yml';
  const stem = path.basename(base, ext);
  const outPath = path.join(path.dirname(base), `${stem}.lang-${outputLanguage}${ext}`);
  fs.writeFileSync(outPath, yaml.dump(next, { lineWidth: 140 }), 'utf8');
  return outPath;
}

function resolveInventLanguage(seedText, config) {
  const configured = normalizeLanguageCode(config?.generation?.output_language || '');
  if (configured && configured !== 'auto') return configured;
  const detected = detectLanguageFromText(seedText);
  return detected || 'en';
}

function resolveInventTemperature(config) {
  const raw = Number(config?.generation?.invent_temperature);
  if (!Number.isFinite(raw)) return 0.95;
  return Math.max(0, Math.min(2, raw));
}

function splitPromptWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function extractSeedEntities(seedText, config) {
  const words = splitPromptWords(seedText);
  const threshold = Math.max(1, resolveShortPromptWordThreshold(config));
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'with',
    'story', 'write', 'make', 'invent', 'about', 'from', 'short'
  ]);
  const out = [];
  for (const rawWord of words) {
    const token = String(rawWord || '').replace(/[^\p{L}\p{N}_-]/gu, '').trim();
    if (!token) continue;
    if (token.length <= 1) continue;
    if (stopWords.has(token.toLowerCase())) continue;
    out.push(token);
    if (out.length >= threshold) break;
  }
  return out;
}

function isShortStoryPrompt(seedText, config) {
  const seed = String(seedText || '').trim();
  if (!seed) return false;
  const words = splitPromptWords(seed);
  const threshold = resolveShortPromptWordThreshold(config);
  if (words.length <= threshold) return true;
  const hasSentenceEnding = /[.!?]/.test(seed);
  const entities = extractSeedEntities(seed, config);
  if (!hasSentenceEnding && words.length <= Math.max(threshold + 2, 12) && entities.length >= 1) {
    return true;
  }
  return false;
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch (_) {
    return null;
  }
}

function boundedText(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function buildEnrichedSeedText(seed, enrichment, config) {
  const maxChars = resolveMaxEnrichmentChars(config);
  const maxItems = resolveMaxContextItems(config);
  const includeSources = resolveIncludeSources(config);
  const facts = Array.isArray(enrichment?.items) ? enrichment.items : [];
  const related = Array.isArray(enrichment?.related) ? enrichment.related : [];
  const sources = Array.isArray(enrichment?.sources) ? enrichment.sources : [];
  const factLines = facts
    .map((v) => boundedText(v, 220))
    .filter(Boolean)
    .slice(0, maxItems);
  const relatedLines = related
    .map((v) => boundedText(v, 120))
    .filter(Boolean)
    .slice(0, maxItems);

  const lines = [
    'Original user prompt:',
    String(seed || '').trim(),
    '',
    'Retrieved context:',
    ...(factLines.length ? factLines.map((v) => `- ${v}`) : ['- (none)']),
    '',
    'Related entities or concepts:',
    ...(relatedLines.length ? relatedLines.map((v) => `- ${v}`) : ['- (none)']),
    '',
    'Instruction:',
    'Use the above only as grounding and inspiration. Generate an original fictional story.'
  ];

  if (includeSources && sources.length) {
    const sourceLines = sources
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
    if (sourceLines.length) {
      lines.push('');
      lines.push('Sources:');
      sourceLines.forEach((s) => lines.push(`- ${s}`));
    }
  }

  return boundedText(lines.join('\n'), maxChars);
}

async function fetchWikipediaEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const query = encodeURIComponent(String(seed || '').trim());
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&srlimit=${maxItems}&format=json&utf8=1&origin=*`;
  const searchRes = await fetchImpl(searchUrl, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  if (!searchRes.ok) throw new Error(`Wikipedia search failed (${searchRes.status})`);
  const searchJson = parseJsonLoose(await searchRes.text()) || {};
  const rows = Array.isArray(searchJson?.query?.search) ? searchJson.query.search.slice(0, maxItems) : [];
  if (!rows.length) throw new Error('Wikipedia enrichment returned no matches');
  const items = [];
  const related = [];
  const sources = [];
  for (const row of rows) {
    const title = String(row?.title || '').trim();
    if (!title) continue;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    try {
      const sRes = await fetchImpl(summaryUrl, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (!sRes.ok) continue;
      const sJson = parseJsonLoose(await sRes.text()) || {};
      const extract = String(sJson?.extract || '').trim();
      if (extract) items.push(extract);
      related.push(title);
      sources.push(String(sJson?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`));
    } catch (_) {}
  }
  if (!items.length) throw new Error('Wikipedia enrichment returned empty summaries');
  return { provider: 'wikipedia', items, related, sources };
}

async function fetchJinaEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const endpoint = `https://s.jina.ai/${encodeURIComponent(String(seed || '').trim())}`;
  const headers = {
    Accept: 'text/plain',
    'X-No-Cache': 'true'
  };
  const key = String(process.env.JINA_API_KEY || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetchImpl(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Jina enrichment failed (${res.status})`);
  const raw = String(await res.text() || '').trim();
  if (!raw) throw new Error('Jina enrichment returned empty text');
  const lines = raw
    .split(/\r?\n/)
    .map((v) => String(v || '').trim())
    .filter((v) => v && !/^https?:\/\//i.test(v))
    .slice(0, maxItems);
  if (!lines.length) throw new Error('Jina enrichment has no usable lines');
  return { provider: 'jina', items: lines, related: extractSeedEntities(seed, config), sources: [endpoint] };
}

async function fetchGeminiEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const apiKey = getGeminiApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const model = String(config?.generation?.enrichment_gemini_model || GEMINI_ENRICH_MODEL).trim();
  const prompt = [
    'Return JSON only with keys: items (string[]), related (string[]), sources (string[]).',
    `Provide up to ${maxItems} concise factual context items for creative grounding.`,
    'Do not write a story.',
    `Seed: ${String(seed || '').trim()}`
  ].join('\n');
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini enrichment failed (${res.status})`);
  const parsed = parseJsonLoose(parseGeminiTextResponse(parseJsonLoose(raw) || {})) || parseJsonLoose(raw) || {};
  const items = Array.isArray(parsed?.items) ? parsed.items.map((v) => String(v || '').trim()).filter(Boolean).slice(0, maxItems) : [];
  const related = Array.isArray(parsed?.related) ? parsed.related.map((v) => String(v || '').trim()).filter(Boolean).slice(0, maxItems) : [];
  const sources = Array.isArray(parsed?.sources) ? parsed.sources.map((v) => String(v || '').trim()).filter(Boolean).slice(0, maxItems) : [];
  if (!items.length) throw new Error('Gemini enrichment returned no items');
  return { provider: 'gemini', items, related, sources };
}

async function fetchFirecrawlEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getFirecrawlApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const res = await fetchImpl('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      query: String(seed || '').trim(),
      limit: maxItems
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Firecrawl enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.data) ? json.data.slice(0, maxItems) : [];
  const items = rows
    .map((r) => String(r?.snippet || r?.description || r?.markdown || '').trim())
    .filter(Boolean);
  const related = rows
    .map((r) => String(r?.title || '').trim())
    .filter(Boolean);
  const sources = rows
    .map((r) => String(r?.url || '').trim())
    .filter(Boolean);
  if (!items.length) throw new Error('Firecrawl enrichment returned no items');
  return { provider: 'firecrawl', items, related, sources };
}

async function fetchDriftbotEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getDriftbotApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const sanitizedSeed = String(seed || '').replace(/"/g, '').trim();
  const entities = extractSeedEntities(sanitizedSeed, config);
  const primary = entities[0] || sanitizedSeed;
  const dqlQueries = [
    `strict:name:"${primary}"`,
    `name:"${primary}"`,
    `allDescriptions:"${sanitizedSeed}"`
  ];
  const errors = [];
  let rows = [];

  for (const dql of dqlQueries) {
    const endpoint = `https://kg.diffbot.com/kg/v3/dql?token=${encodeURIComponent(key)}&query=${encodeURIComponent(dql)}&size=${maxItems}`;
    const res = await fetchImpl(endpoint, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text();
    const json = parseJsonLoose(raw) || {};
    if (!res.ok) {
      const msg = String(json?.message || raw || `HTTP ${res.status}`).slice(0, 300);
      errors.push(`${dql}: ${res.status} ${msg}`);
      continue;
    }
    rows = Array.isArray(json?.data) ? json.data.slice(0, maxItems) : [];
    if (rows.length) break;
  }

  const items = rows
    .map((r) => {
      const entity = r?.entity || r || {};
      const allDescriptions = Array.isArray(entity?.allDescriptions) ? entity.allDescriptions : [];
      const firstAllDescription = String(allDescriptions[0] || '').trim();
      return String(entity?.summary || entity?.description || firstAllDescription || r?.description || '').trim();
    })
    .filter(Boolean);
  const related = rows
    .map((r) => {
      const entity = r?.entity || r || {};
      const allNames = Array.isArray(entity?.allNames) ? entity.allNames : [];
      return String(entity?.name || allNames[0] || r?.name || '').trim();
    })
    .filter(Boolean);
  const sources = rows
    .map((r) => {
      const entity = r?.entity || r || {};
      return String(entity?.homepageUri || entity?.wikipediaUri || entity?.siteUri || r?.diffbotUri || entity?.id || '').trim();
    })
    .filter(Boolean);
  if (!items.length) {
    const details = errors.length ? ` (${errors.join(' | ')})` : '';
    throw new Error(`Driftbot enrichment returned no items${details}`);
  }
  return { provider: 'driftbot', items, related, sources };
}

async function fetchWikidataEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const query = encodeURIComponent(String(seed || '').trim());
  const endpoint = `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&limit=${maxItems}&search=${query}&origin=*`;
  const res = await fetchImpl(endpoint, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Wikidata enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.search) ? json.search.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.description || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.label || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.concepturi || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Wikidata enrichment returned no items');
  return { provider: 'wikidata', items, related, sources };
}

async function fetchDbpediaEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const query = encodeURIComponent(String(seed || '').trim());
  const endpoint = `https://lookup.dbpedia.org/api/search?query=${query}&maxResults=${maxItems}`;
  const res = await fetchImpl(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`DBpedia enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.docs) ? json.docs.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.comment?.[0] || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.label?.[0] || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.resource?.[0] || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('DBpedia enrichment returned no items');
  return { provider: 'dbpedia', items, related, sources };
}

async function fetchGdeltEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const query = encodeURIComponent(String(seed || '').trim());
  const endpoint = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&format=json&maxrecords=${maxItems}`;
  const res = await fetchImpl(endpoint, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`GDELT enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.articles) ? json.articles.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.seendate || '').trim() ? `${String(r?.seendate || '').trim()}: ${String(r?.title || '').trim()}` : String(r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.sourcecountry || r?.domain || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.url || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('GDELT enrichment returned no items');
  return { provider: 'gdelt', items, related, sources };
}

async function fetchGoogleKgEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getGoogleKgApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const query = encodeURIComponent(String(seed || '').trim());
  const endpoint = `https://kgsearch.googleapis.com/v1/entities:search?query=${query}&limit=${maxItems}&languages=en&key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(endpoint, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Google KG enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.itemListElement) ? json.itemListElement.slice(0, maxItems) : [];
  const items = rows
    .map((r) => String(r?.result?.description || r?.result?.detailedDescription?.articleBody || '').trim())
    .filter(Boolean);
  const related = rows.map((r) => String(r?.result?.name || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.result?.detailedDescription?.url || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Google KG enrichment returned no items');
  return { provider: 'googlekg', items, related, sources };
}

async function fetchBraveEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getBraveSearchApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(String(seed || '').trim())}&count=${maxItems}`;
  const res = await fetchImpl(endpoint, {
    method: 'GET',
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Brave enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.web?.results) ? json.web.results.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.description || r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.title || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.url || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Brave enrichment returned no items');
  return { provider: 'brave', items, related, sources };
}

async function fetchTavilyEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getTavilyApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query: String(seed || '').trim(),
      max_results: maxItems,
      include_answer: false
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Tavily enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.results) ? json.results.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.content || r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.title || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.url || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Tavily enrichment returned no items');
  return { provider: 'tavily', items, related, sources };
}

async function fetchExaEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getExaApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const res = await fetchImpl('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      query: String(seed || '').trim(),
      numResults: maxItems,
      useAutoprompt: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Exa enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.results) ? json.results.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.text || r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.title || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.url || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Exa enrichment returned no items');
  return { provider: 'exa', items, related, sources };
}

async function fetchSerperEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getSerperApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const res = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: String(seed || '').trim(), num: maxItems }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`Serper enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.organic) ? json.organic.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.snippet || r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.title || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.link || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('Serper enrichment returned no items');
  return { provider: 'serper', items, related, sources };
}

async function fetchSerpApiEnrichment(seed, config, runtime, fetchImpl = fetch) {
  const key = getSerpApiKey();
  const maxItems = resolveMaxContextItems(config);
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const endpoint = `https://serpapi.com/search.json?q=${encodeURIComponent(String(seed || '').trim())}&num=${maxItems}&api_key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(endpoint, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  const json = parseJsonLoose(raw) || {};
  if (!res.ok) throw new Error(`SerpAPI enrichment failed (${res.status})`);
  const rows = Array.isArray(json?.organic_results) ? json.organic_results.slice(0, maxItems) : [];
  const items = rows.map((r) => String(r?.snippet || r?.title || '').trim()).filter(Boolean);
  const related = rows.map((r) => String(r?.title || '').trim()).filter(Boolean);
  const sources = rows.map((r) => String(r?.link || '').trim()).filter(Boolean);
  if (!items.length) throw new Error('SerpAPI enrichment returned no items');
  return { provider: 'serpapi', items, related, sources };
}

async function runStoryEnrichment(seedText, config, runtime, options = {}) {
  const selected = normalizeEnrichmentProvider(config?.generation?.enrichment_provider || 'wikipedia');
  const fallback = normalizeEnrichmentProvider(config?.generation?.enrichment_fallback_provider || 'gemini');
  const preferred = [
    'wikipedia', 'wikidata', 'dbpedia', 'gdelt', 'googlekg',
    'jina', 'firecrawl', 'driftbot', 'gemini', 'brave', 'tavily', 'exa', 'serper', 'serpapi'
  ];
  const order = [selected, fallback, ...preferred].filter((v, i, arr) => v && arr.indexOf(v) === i);
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const errors = [];
  const attemptedProviders = [];

  for (const provider of order) {
    attemptedProviders.push(provider);
    try {
      if (provider === 'wikipedia') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchWikipediaEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'wikidata') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchWikidataEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'dbpedia') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchDbpediaEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'gdelt') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchGdeltEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'googlekg') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchGoogleKgEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'jina') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchJinaEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'firecrawl') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchFirecrawlEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'brave') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchBraveEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'tavily') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchTavilyEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'exa') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchExaEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'serper') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchSerperEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'serpapi') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchSerpApiEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'driftbot') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchDriftbotEnrichment(seedText, config, runtime, fetchImpl) };
      if (provider === 'gemini') return { selectedProvider: selected, usedProvider: provider, attemptedProviders, ...await fetchGeminiEnrichment(seedText, config, runtime, fetchImpl) };
    } catch (error) {
      errors.push(`${provider}: ${String(error?.message || error)}`);
    }
  }
  return {
    selectedProvider: selected,
    usedProvider: '',
    attemptedProviders,
    items: [],
    related: [],
    sources: [],
    error: errors.join(' | ')
  };
}

function buildInventStoryPrompt(config, seedText) {
  const cfg = config && typeof config === 'object' ? config : {};
  const seed = String(seedText || '').trim();
  const targetLanguage = resolveInventLanguage(seed, cfg);
  const objective = String(cfg?.generation?.objective || 'summarize').trim();
  const stylePrompt = String(cfg?.generation?.style_prompt || '').trim();
  const objectiveOverride = String(cfg?.generation?.objective_prompt_overrides?.[objective] || '').trim();
  const customStoryPrompt = String(cfg?.generation?.custom_story_prompt || '').trim();
  return [
    'You are a creative comic writer.',
    'Expand the seed into an engaging short narrative that is easy to storyboard into comic panels.',
    'Add at least two unexpected but coherent twists.',
    'Keep characters and timeline consistent.',
    `Objective: ${objective}`,
    `Style: ${stylePrompt || 'not specified'}`,
    objectiveOverride ? `Objective-specific instructions: ${objectiveOverride}` : '',
    customStoryPrompt ? `Custom user story prompt: ${customStoryPrompt}` : '',
    `Write the output strictly in language code "${targetLanguage}".`,
    'Return plain text only (no JSON, no markdown headings).',
    '',
    'Seed story:',
    seed
  ].filter(Boolean).join('\n');
}

function resolvePanelWatermarkEnabled(config) {
  const raw = config?.generation?.panel_watermark;
  if (raw == null) return true;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return true;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function sanitizeInventedStoryText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const cleaned = [];
  for (const line of lines) {
    let next = String(line || '').trim();
    if (!next) continue;
    if (/^#{1,6}\s+/.test(next)) continue;
    if (/^(storyboard|comic storyboard|story board)\s*:?\s*$/i.test(next)) continue;
    next = next
      .replace(/^\**\s*panel\s+[a-z0-9ivx]+\s*[\])}.:-]?\s*/i, '')
      .replace(/^\**\s*scene\s+[a-z0-9ivx]+\s*[\])}.:-]?\s*/i, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\s*\d+\s*[.)-]\s+/, '')
      .trim();
    if (!next) continue;
    cleaned.push(next);
  }
  return cleaned.length ? cleaned.join('\n') : raw;
}

function installPlaywrightChromium() {
  execSync('npx playwright install chromium', {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env }
  });
}

async function ensurePlaywrightChromiumInstalledAsync(reason = 'runtime') {
  if (playwrightChromiumReady) return;
  if (playwrightInstallPromise) return playwrightInstallPromise;
  playwrightInstallPromise = (async () => {
    const startedAt = Date.now();
    console.log('[render-bot] playwright_install_start', JSON.stringify({ reason }));
    try {
      installPlaywrightChromium();
      playwrightChromiumReady = true;
      console.log('[render-bot] playwright_install_done', JSON.stringify({
        reason,
        elapsedMs: Date.now() - startedAt
      }));
    } finally {
      playwrightInstallPromise = null;
    }
  })();
  return playwrightInstallPromise;
}

function warmupPlaywrightChromiumInBackground(reason = 'startup') {
  ensurePlaywrightChromiumInstalledAsync(reason).catch((error) => {
    console.warn('[render-bot] playwright_warmup_failed', JSON.stringify({
      reason,
      message: trimForLog(error && error.message ? error.message : String(error), 800)
    }));
  });
}

function hasGeminiKey() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function providerHasRequiredEnv(providerName) {
  const provider = String(providerName || '').trim().toLowerCase();
  const required = PROVIDER_REQUIRED_ENV[provider] || [];
  if (!required.length) return true;
  return required.every((k) => String(process.env[k] || '').trim());
}

function isProviderOrModelFailure(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (!msg) return false;
  const providerHints = ['gemini', 'openai', 'openrouter', 'cloudflare', 'hugging face', 'huggingface', 'provider', 'model'];
  const errorHints = [
    'unsupported',
    'missing',
    'authentication error',
    'invalid api key',
    'invalid model',
    'not found',
    'failed (401)',
    'failed (403)',
    'failed (404)',
    'failed (429)',
    'for cloudflare',
    'for openai',
    'for openrouter',
    'for gemini',
    'for hugging face'
  ];
  return providerHints.some((h) => msg.includes(h)) && errorHints.some((h) => msg.includes(h));
}

function shouldFallbackToGemini(config, error) {
  if (!hasGeminiKey()) return false;
  const textProvider = String(config?.providers?.text?.provider || '').trim().toLowerCase();
  const imageProvider = String(config?.providers?.image?.provider || '').trim().toLowerCase();
  const nonGemini = textProvider !== 'gemini' || imageProvider !== 'gemini';
  if (!nonGemini) return false;
  if (!error) return false;
  return isProviderOrModelFailure(error);
}

function shouldPreemptiveFallbackToGemini(config) {
  if (!hasGeminiKey()) return false;
  const textProvider = String(config?.providers?.text?.provider || '').trim().toLowerCase();
  const imageProvider = String(config?.providers?.image?.provider || '').trim().toLowerCase();
  const textMissing = textProvider && textProvider !== 'gemini' && !providerHasRequiredEnv(textProvider);
  const imageMissing = imageProvider && imageProvider !== 'gemini' && !providerHasRequiredEnv(imageProvider);
  return textMissing || imageMissing;
}

function withGeminiProviders(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (!next.providers || typeof next.providers !== 'object') next.providers = {};
  if (!next.providers.text || typeof next.providers.text !== 'object') next.providers.text = {};
  if (!next.providers.image || typeof next.providers.image !== 'object') next.providers.image = {};
  next.providers.text.provider = 'gemini';
  next.providers.text.model = GEMINI_TEXT_MODEL;
  next.providers.text.api_key_env = 'GEMINI_API_KEY';
  next.providers.image.provider = 'gemini';
  next.providers.image.model = GEMINI_IMAGE_MODEL;
  next.providers.image.api_key_env = 'GEMINI_API_KEY';
  return next;
}

function providerPairLabel(config) {
  const textProvider = String(config?.providers?.text?.provider || '-').trim().toLowerCase();
  const imageProvider = String(config?.providers?.image?.provider || '-').trim().toLowerCase();
  return `${textProvider}/${imageProvider}`;
}

async function notifyFallback(options, payload) {
  if (!options || typeof options.onFallback !== 'function') return;
  await options.onFallback(payload);
}

function writeGeminiFallbackConfigPath(configPath, config) {
  const base = path.resolve(configPath);
  const ext = path.extname(base) || '.yml';
  const stem = path.basename(base, ext);
  const outPath = path.join(path.dirname(base), `${stem}.fallback-gemini${ext}`);
  fs.writeFileSync(outPath, yaml.dump(withGeminiProviders(config), { lineWidth: 140 }), 'utf8');
  return outPath;
}

async function recordGeneratedImages(runtime, imagePaths) {
  const storage = createImageStorageManagerFromEnv({
    statusFilePath: runtime.imageStatusFile,
    capacityBytes: runtime.imageCapacityBytes,
    cleanupThresholdRatio: runtime.imageCleanupThresholdRatio,
    r2Endpoint: runtime.r2Endpoint,
    r2Bucket: runtime.r2Bucket,
    r2AccessKeyId: runtime.r2AccessKeyId,
    r2SecretAccessKey: runtime.r2SecretAccessKey,
    r2Prefix: runtime.r2ImagePrefix,
    r2StatusKey: runtime.r2ImageStatusKey
  });
  try {
    const status = await storage.recordImages(imagePaths);
    const count = Array.isArray(imagePaths) ? imagePaths.length : 0;
    const totalBytes = Number(status && status.totalBytes ? status.totalBytes : 0);
    console.log('[render-bot] image bookkeeping saved', JSON.stringify({
      count,
      totalBytes,
      firstPath: count ? String(imagePaths[0] || '') : ''
    }));
  } catch (error) {
    console.error('[render-bot] image storage write failed:', error && error.message ? error.message : String(error));
  }
}

function recordGeneratedImagesInBackground(runtime, imagePaths) {
  recordGeneratedImages(runtime, imagePaths).catch((error) => {
    console.error('[render-bot] image bookkeeping failed:', error && error.message ? error.message : String(error));
  });
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizePathPart(value, fallback) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  const safe = raw
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || String(fallback || 'unknown');
}

function resolvePanelOutputScope(runtime, options, ts) {
  const userPart = sanitizePathPart(options?.userId, 'global');
  const generationPart = sanitizePathPart(options?.generationId, `gen-${ts}`);
  const baseDir = path.join(runtime.outDir, 'users', userPart, 'generations', generationPart);
  fs.mkdirSync(baseDir, { recursive: true });
  return { userPart, generationPart, baseDir };
}

async function applyPanelWatermark(imageBuffer) {
  const input = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer || '');
  if (!input.length) return input;
  const meta = await sharp(input).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) return input;

  const fontSize = Math.max(11, Math.min(17, Math.round(width * 0.012)));
  const margin = Math.max(8, Math.round(width * 0.012));
  const y = Math.max(fontSize + 4, height - margin);
  const x = Math.max(margin, width - margin);
  const text = escapeXml(PANEL_WATERMARK_TEXT);
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${x}" y="${y}" text-anchor="end"
    font-family="Arial, sans-serif"
    font-size="${fontSize}"
    fill="rgba(255,255,255,0.32)"
    stroke="rgba(0,0,0,0.26)"
    stroke-width="0.7">${text}</text>
</svg>`;

  return sharp(input)
    .composite([{ input: Buffer.from(svg, 'utf8'), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function prepareInput(text, runtime, config = {}, options = {}) {
  const parsed = classifyMessageInput(text);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.promises.mkdir(runtime.outDir, { recursive: true });

  if (parsed.kind === 'empty') {
    throw new Error('Empty message. Send plain text or full URL.');
  }

  if (parsed.kind === 'url') {
    const selectedExtractor = getConfiguredUrlExtractor(config);
    const attemptOrder = getUrlExtractorAttemptOrder(selectedExtractor);
    console.log('[render-bot] url_input_detected', JSON.stringify({
      url: trimForLog(parsed.value, 500),
      fetchTimeoutMs: Number(runtime.fetchTimeoutMs || 0),
      extractorSelected: selectedExtractor,
      extractorAttemptOrder: attemptOrder.join('->')
    }));
    const outputPath = path.join(runtime.outDir, `render-url-${ts}.png`);
    const extracted = await extractStoryFromUrlText(parsed.value, runtime, config, {
      onExtractorFallback: options.onExtractorFallback
    });
    const extractedText = String(extracted?.text || '').trim();
    const inputPath = path.join(runtime.outDir, `render-url-${sanitizePathPart(extracted?.extractorUsed, 'extractor')}-${ts}.txt`);
    await fs.promises.writeFile(inputPath, extractedText, 'utf8');
    console.log('[render-bot] url_extractor_success', JSON.stringify({
      inputUrl: trimForLog(parsed.value, 500),
      extractorSelected: selectedExtractor,
      extractorUsed: String(extracted?.extractorUsed || '').trim(),
      extractedChars: extractedText.length
    }));
    return {
      kind: 'url',
      inputPath,
      outputPath,
      titleOverride: `Render Comic: ${new URL(parsed.value).hostname}`,
      summary: parsed.value,
      sourceText: extractedText,
      extractorSelected: String(extracted?.extractorSelected || selectedExtractor).trim(),
      extractorUsed: String(extracted?.extractorUsed || selectedExtractor).trim()
    };
  }

  const inputPath = path.join(runtime.outDir, `render-text-${ts}.txt`);
  const outputPath = path.join(runtime.outDir, `render-text-${ts}.png`);
  await fs.promises.writeFile(inputPath, parsed.value, 'utf8');
  return {
    kind: 'text',
    inputPath,
    outputPath,
    titleOverride: 'Render Comic',
    summary: `text (${parsed.value.length} chars)`,
    sourceText: parsed.value
  };
}

async function generateWithRuntimeConfig(text, runtime, effectiveConfigPath) {
  if (isFakeGeneratorEnabled()) {
    await maybeFakeDelay();
    const parsed = classifyMessageInput(text);
    if (parsed.kind === 'empty') throw new Error('Empty message. Send plain text or full URL.');
    if (parsed.kind === 'url' && isFakeUrlFetchFailureEnabled()) {
      throw new Error('URL fetch failed (forced test mode)');
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(runtime.outDir, `render-fake-${ts}.png`);
    await writeFakePanelPng(outPath, 0, 1);
    return {
      configPath: effectiveConfigPath,
      inputPath: '',
      outputPath: outPath,
      storyboardTitle: 'Render Comic',
      panelCount: 3,
      imageBytes: fs.statSync(outPath).size,
      width: 1,
      height: 1,
      elapsedMs: 5,
      kind: parsed.kind,
      summary: parsed.kind === 'url' ? parsed.value : `text (${parsed.value.length} chars)`
    };
  }

  const loaded = loadConfig(effectiveConfigPath);
  const prep = await prepareInput(text, runtime, loaded.config);
  const resolvedLanguage = resolveOutputLanguage(text, prep, loaded.config);
  const runtimeConfigPath = (normalizeLanguageCode(loaded.config?.generation?.output_language || '') === 'auto')
    ? buildConfigPathForResolvedLanguage(effectiveConfigPath, loaded.config, resolvedLanguage)
    : effectiveConfigPath;
  const debugDir = runtime.debugArtifacts
    ? path.join(runtime.outDir, path.basename(prep.outputPath, '.png') + '-debug')
    : '';

  let configPathForRun = runtimeConfigPath;
  let configForRun = loadConfig(configPathForRun).config;
  if (shouldPreemptiveFallbackToGemini(configForRun)) {
    configPathForRun = writeGeminiFallbackConfigPath(configPathForRun, configForRun);
    configForRun = loadConfig(configPathForRun).config;
  }
  let result;
  try {
    result = await runComicEngine({
      rootDir: runtime.repoRoot,
      inputPath: prep.inputPath,
      configPath: configPathForRun,
      outputPath: prep.outputPath,
      debugDir,
      titleOverride: prep.titleOverride
    });
  } catch (error) {
    if (!shouldFallbackToGemini(configForRun, error)) throw error;
    const fallbackPath = writeGeminiFallbackConfigPath(configPathForRun, configForRun);
    result = await runComicEngine({
      rootDir: runtime.repoRoot,
      inputPath: prep.inputPath,
      configPath: fallbackPath,
      outputPath: prep.outputPath,
      debugDir,
      titleOverride: prep.titleOverride
    });
  }

  return {
    ...result,
    outputLanguage: resolvedLanguage,
    kind: prep.kind,
    summary: prep.summary,
    extractorSelected: prep.extractorSelected || '',
    extractorUsed: prep.extractorUsed || ''
  };
}

async function generatePanelsWithRuntimeConfig(text, runtime, effectiveConfigPath, options = {}) {
  const loadedConfig = loadConfig(effectiveConfigPath);
  const watermarkEnabled = resolvePanelWatermarkEnabled(loadedConfig.config);
  const configuredPanelCount = Number(loadedConfig?.config?.generation?.panel_count);
  const panelCount = Number.isFinite(configuredPanelCount) && configuredPanelCount > 0
    ? Math.floor(configuredPanelCount)
    : 3;

  if (isFakeGeneratorEnabled()) {
    await maybeFakeDelay();
    const parsed = classifyMessageInput(text);
    if (parsed.kind === 'empty') throw new Error('Empty message. Send plain text or full URL.');
    if (parsed.kind === 'url' && isFakeUrlFetchFailureEnabled()) {
      throw new Error('URL fetch failed (forced test mode)');
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const scope = resolvePanelOutputScope(runtime, options, ts);
    const panelMessages = [];
    const writtenPaths = [];
    const buildAndEmit = async (i) => {
      const imagePath = path.join(scope.baseDir, `panel-${i + 1}.png`);
      await writeFakePanelPng(imagePath, i, panelCount);
      if (watermarkEnabled) {
        try {
          const marked = await applyPanelWatermark(fs.readFileSync(imagePath));
          fs.writeFileSync(imagePath, marked);
        } catch (_) {}
      }
      writtenPaths.push(imagePath);
      const caption = `${i + 1}(${panelCount}) Fake panel ${i + 1}`;
      const panelMessage = {
        index: i + 1,
        caption,
        imagePath,
        total: panelCount,
        imagePromptUsed: `Fake panel ${i + 1}`
      };
      panelMessages[i] = panelMessage;
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady(panelMessage);
      }
    };

    const outOfOrder = isFakeGeneratorOutOfOrderEnabled();
    const baseOrder = Array.from({ length: panelCount }, (_, i) => i);
    const order = outOfOrder
      ? [
          ...baseOrder.filter((idx) => idx % 2 === 1),
          ...baseOrder.filter((idx) => idx % 2 === 0)
        ]
      : baseOrder;
    for (let j = 0; j < order.length; j += 1) {
      await buildAndEmit(order[j]);
    }
    recordGeneratedImagesInBackground(runtime, writtenPaths);
    return {
      panelCount,
      elapsedMs: 5,
      kind: parsed.kind,
      summary: parsed.kind === 'url' ? parsed.value : `text (${parsed.value.length} chars)`,
      panelMessages: panelMessages.filter(Boolean),
      storyboard: {
        panels: panelMessages.filter(Boolean).map((p) => ({
          index: p.index,
          caption: p.caption,
          beat: '',
          imagePrompt: p.caption
        }))
      },
      consistency: { enabled: false, used: false, reason: 'fake_generator' }
    };
  }

  const prep = await prepareInput(text, runtime, loadedConfig.config, options);
  if (prep.kind === 'url') {
    console.log('[render-bot] panel_generation_from_url', JSON.stringify({
      urlSummary: trimForLog(prep.summary, 500),
      inputPath: prep.inputPath
    }));
  }
  const resolvedLanguage = resolveOutputLanguage(text, prep, loadedConfig.config);
  const runtimeConfigPath = (normalizeLanguageCode(loadedConfig.config?.generation?.output_language || '') === 'auto')
    ? buildConfigPathForResolvedLanguage(effectiveConfigPath, loadedConfig.config, resolvedLanguage)
    : effectiveConfigPath;
  const debugDir = runtime.debugArtifacts
    ? path.join(runtime.outDir, path.basename(prep.outputPath, '.png') + '-debug')
    : '';

  const panelMessages = [];
  const writtenPaths = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const scope = resolvePanelOutputScope(runtime, options, ts);

  let configPathForRun = runtimeConfigPath;
  let configForRun = loadConfig(configPathForRun).config;
  if (shouldPreemptiveFallbackToGemini(configForRun)) {
    await notifyFallback(options, {
      from: providerPairLabel(configForRun),
      to: 'gemini/gemini',
      reason: 'missing_credentials'
    });
    configPathForRun = writeGeminiFallbackConfigPath(configPathForRun, configForRun);
    configForRun = loadConfig(configPathForRun).config;
  }

  const onPanelReady = async ({ index, total, panel, imagePrompt, image }) => {
      const imagePath = path.join(scope.baseDir, `panel-${index + 1}.png`);
      const finalBuffer = watermarkEnabled
        ? await applyPanelWatermark(image.buffer)
        : image.buffer;
      fs.writeFileSync(imagePath, finalBuffer);
      writtenPaths.push(imagePath);
      const captionText = String(panel?.caption || '').trim();
      const beatText = String(panel?.beat || '').trim();
      const caption = beatText
        ? `${index + 1}(${total}) ${captionText}\n${beatText}`
        : `${index + 1}(${total}) ${captionText}`;
      const panelMessage = {
        index: index + 1,
        caption: caption.slice(0, 1000),
        imagePath,
        total,
        imagePromptUsed: String(imagePrompt || panel?.image_prompt || '').trim()
      };
      panelMessages[index] = panelMessage;
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady(panelMessage);
      }
  };

  let detailed;
  try {
    detailed = await runComicEnginePanels({
      rootDir: runtime.repoRoot,
      inputPath: prep.inputPath,
      configPath: configPathForRun,
      debugDir,
      titleOverride: prep.titleOverride,
      onPanelReady
    });
  } catch (error) {
    if (!shouldFallbackToGemini(configForRun, error) || panelMessages.filter(Boolean).length > 0) throw error;
    await notifyFallback(options, {
      from: providerPairLabel(configForRun),
      to: 'gemini/gemini',
      reason: 'provider_failure',
      error: String(error?.message || error)
    });
    const fallbackPath = writeGeminiFallbackConfigPath(configPathForRun, configForRun);
    detailed = await runComicEnginePanels({
      rootDir: runtime.repoRoot,
      inputPath: prep.inputPath,
      configPath: fallbackPath,
      debugDir,
      titleOverride: prep.titleOverride,
      onPanelReady
    });
  }

  let consistencyReferenceImagePath = '';
  if (detailed && detailed.consistencyReferenceImage && Buffer.isBuffer(detailed.consistencyReferenceImage.buffer)) {
    try {
      const consistencyPath = path.join(scope.baseDir, 'summary-style-reference.png');
      fs.writeFileSync(consistencyPath, detailed.consistencyReferenceImage.buffer);
      consistencyReferenceImagePath = consistencyPath;
      writtenPaths.push(consistencyPath);
    } catch (_) {}
  }

  recordGeneratedImagesInBackground(runtime, writtenPaths);

  return {
    panelCount: detailed.storyboard?.panels?.length || panelMessages.filter(Boolean).length,
    elapsedMs: detailed.elapsedMs,
    outputLanguage: resolvedLanguage,
    kind: prep.kind,
    summary: prep.summary,
    panelMessages: panelMessages.filter(Boolean),
    storyboard: detailed.storyboard || null,
    consistency: detailed.consistency || { enabled: false, used: false, reason: '' },
    consistencyReferenceImagePath,
    extractorSelected: prep.extractorSelected || '',
    extractorUsed: prep.extractorUsed || ''
  };
}

async function inventStoryText(seedText, effectiveConfigPath, options = {}) {
  const seed = String(seedText || '').trim();
  if (!seed) throw new Error('Usage: /invent <story seed>');

  if (isFakeGeneratorEnabled()) {
    return sanitizeInventedStoryText([
      `${seed}`,
      '',
      'A hidden clue changes who the hero can trust.',
      'A quiet side character reveals critical information.',
      'The conflict resolves with an emotional payoff.'
    ].join('\n'));
  }

  const loaded = loadConfig(effectiveConfigPath);
  const config = loaded.config;
  const inventTemperature = resolveInventTemperature(config);
  const autoEnrichEnabled = resolveAutoEnrichEnabled(config);
  const shouldEnrich = autoEnrichEnabled && isShortStoryPrompt(seed, config);
  let promptSeed = seed;
  let enrichmentInfo = null;

  if (shouldEnrich) {
    const enrichment = await runStoryEnrichment(seed, config, config?.runtime || {}, options);
    if (Array.isArray(enrichment?.items) && enrichment.items.length) {
      promptSeed = buildEnrichedSeedText(seed, enrichment, config);
      enrichmentInfo = {
        enabled: true,
        selectedProvider: String(enrichment?.selectedProvider || '').trim(),
        usedProvider: String(enrichment?.usedProvider || '').trim(),
        contextItems: enrichment.items.length,
        fallback: String(enrichment?.selectedProvider || '') !== String(enrichment?.usedProvider || ''),
        reason: enrichment?.error ? String(enrichment.error) : ''
      };
      if (typeof options.onEnrichment === 'function') {
        await options.onEnrichment(enrichmentInfo);
      }
      console.log('[render-bot] story_enrichment_used', JSON.stringify({
        selectedProvider: enrichmentInfo.selectedProvider,
        usedProvider: enrichmentInfo.usedProvider,
        contextItems: enrichmentInfo.contextItems,
        fallback: enrichmentInfo.fallback
      }));
    } else {
      enrichmentInfo = {
        enabled: true,
        selectedProvider: String(enrichment?.selectedProvider || '').trim(),
        usedProvider: '',
        contextItems: 0,
        fallback: false,
        reason: String(enrichment?.error || 'no_context')
      };
      if (typeof options.onEnrichment === 'function') {
        await options.onEnrichment(enrichmentInfo);
      }
      console.warn('[render-bot] story_enrichment_unavailable', JSON.stringify({
        selectedProvider: enrichmentInfo.selectedProvider,
        reason: enrichmentInfo.reason
      }));
    }
  }

  const prompt = buildInventStoryPrompt(config, promptSeed);

  const runtimeConfig = {
    ...(config.runtime || {}),
    text_temperature: inventTemperature
  };

  const runWith = (cfg) => withRetries(
    () => generateTextWithProvider(cfg.providers.text, prompt, runtimeConfig),
    cfg.runtime.retries,
    'Story invention'
  );
  try {
    const generated = await runWith(config);
    return sanitizeInventedStoryText(generated);
  } catch (error) {
    if (!shouldFallbackToGemini(config, error)) throw error;
    await notifyFallback(options, {
      from: `${String(config?.providers?.text?.provider || '-').trim().toLowerCase()}/-`,
      to: 'gemini/-',
      reason: 'provider_failure',
      error: String(error?.message || error)
    });
    const fallbackConfig = withGeminiProviders(config);
    const generated = await runWith(fallbackConfig);
    return sanitizeInventedStoryText(generated);
  }
}

module.exports = {
  generateWithRuntimeConfig,
  generatePanelsWithRuntimeConfig,
  detectLanguageFromText,
  detectLanguageFromHtmlFile,
  resolveOutputLanguage,
  resolveInventLanguage,
  resolveInventTemperature,
  isShortStoryPrompt,
  runStoryEnrichment,
  buildEnrichedSeedText,
  normalizeEnrichmentProvider,
  buildInventStoryPrompt,
  resolvePanelWatermarkEnabled,
  isProviderOrModelFailure,
  shouldFallbackToGemini,
  shouldPreemptiveFallbackToGemini,
  getUrlExtractionFailureReason,
  sanitizeInventedStoryText,
  applyPanelWatermark,
  shouldInstallPlaywrightBrowser,
  inventStoryText,
  extractStoryFromUrlText,
  getUrlExtractorAttemptOrder,
  normalizeUrlExtractor,
  warmupPlaywrightChromiumInBackground
};
