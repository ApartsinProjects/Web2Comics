const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sharp = require('sharp');
const { execSync } = require('child_process');
const { runComicEngine, runComicEnginePanels, withRetries } = require('../../engine/src');
const { loadConfig } = require('../../engine/src/config');
const { generateTextWithProvider } = require('../../engine/src/providers');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput } = require('./message-utils');
const { createImageStorageManagerFromEnv } = require('./image-storage');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBAp6R9gAAAABJRU5ErkJggg==';
const SUPPORTED_OUTPUT_LANGS = new Set(['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'he']);
const PANEL_WATERMARK_TEXT = 'made with Web2Comics';
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-exp-image-generation';

const PROVIDER_REQUIRED_ENV = {
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  huggingface: ['HUGGINGFACE_INFERENCE_API_TOKEN']
};

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

function writeTinyPng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
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
    const htmlLang = data.match(/<html[^>]*\blang\s*=\s*["']?([a-zA-Z_-]{2,15})/i);
    const metaLang = data.match(/<meta[^>]+http-equiv\s*=\s*["']content-language["'][^>]*content\s*=\s*["']([^"']+)["']/i);
    const detected = normalizeLanguageCode((htmlLang && htmlLang[1]) || (metaLang && metaLang[1]) || '');
    if (detected) return detected;
    return detectLanguageFromText(data.replace(/<[^>]+>/g, ' ').slice(0, 4000));
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
    await storage.recordImages(imagePaths);
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

async function prepareInput(text, runtime) {
  const parsed = classifyMessageInput(text);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(runtime.outDir, { recursive: true });

  if (parsed.kind === 'empty') {
    throw new Error('Empty message. Send plain text or full URL.');
  }

  if (parsed.kind === 'url') {
    const outputPath = path.join(runtime.outDir, `render-url-${ts}.png`);
    const snapshotPath = buildSnapshotPath(parsed.value, outputPath, '');
    let snap;
    try {
      snap = await fetchUrlToHtmlSnapshot(parsed.value, snapshotPath, {
        timeoutMs: runtime.fetchTimeoutMs,
        waitUntil: 'domcontentloaded'
      });
    } catch (error) {
      if (!shouldInstallPlaywrightBrowser(error)) throw error;
      installPlaywrightChromium();
      snap = await fetchUrlToHtmlSnapshot(parsed.value, snapshotPath, {
        timeoutMs: runtime.fetchTimeoutMs,
        waitUntil: 'domcontentloaded'
      });
    }
    return {
      kind: 'url',
      inputPath: snap.snapshotPath,
      outputPath,
      titleOverride: `Render Comic: ${new URL(snap.finalUrl || parsed.value).hostname}`,
      summary: snap.finalUrl || parsed.value,
      sourceText: ''
    };
  }

  const inputPath = path.join(runtime.outDir, `render-text-${ts}.txt`);
  const outputPath = path.join(runtime.outDir, `render-text-${ts}.png`);
  fs.writeFileSync(inputPath, parsed.value, 'utf8');
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
    writeTinyPng(outPath);
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

  const prep = await prepareInput(text, runtime);
  const loaded = loadConfig(effectiveConfigPath);
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
    summary: prep.summary
  };
}

async function generatePanelsWithRuntimeConfig(text, runtime, effectiveConfigPath, options = {}) {
  const loadedConfig = loadConfig(effectiveConfigPath);
  const watermarkEnabled = resolvePanelWatermarkEnabled(loadedConfig.config);

  if (isFakeGeneratorEnabled()) {
    await maybeFakeDelay();
    const parsed = classifyMessageInput(text);
    if (parsed.kind === 'empty') throw new Error('Empty message. Send plain text or full URL.');
    if (parsed.kind === 'url' && isFakeUrlFetchFailureEnabled()) {
      throw new Error('URL fetch failed (forced test mode)');
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const scope = resolvePanelOutputScope(runtime, options, ts);
    const panelCount = 3;
    const panelMessages = [];
    const writtenPaths = [];
    const buildAndEmit = async (i) => {
      const imagePath = path.join(scope.baseDir, `panel-${i + 1}.png`);
      writeTinyPng(imagePath);
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
    const order = outOfOrder ? [2, 0, 1] : [0, 1, 2];
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

  const prep = await prepareInput(text, runtime);
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
    consistencyReferenceImagePath
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
  const targetLanguage = resolveInventLanguage(seed, config);
  const inventTemperature = resolveInventTemperature(config);
  const objective = String(config?.generation?.objective || 'summarize').trim();
  const stylePrompt = String(config?.generation?.style_prompt || '').trim();
  const objectiveOverride = String(config?.generation?.objective_prompt_overrides?.[objective] || '').trim();
  const customStoryPrompt = String(config?.generation?.custom_story_prompt || '').trim();
  const prompt = [
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
    `Seed story:`,
    seed
  ].filter(Boolean).join('\n');

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
  resolvePanelWatermarkEnabled,
  isProviderOrModelFailure,
  shouldFallbackToGemini,
  shouldPreemptiveFallbackToGemini,
  sanitizeInventedStoryText,
  applyPanelWatermark,
  shouldInstallPlaywrightBrowser,
  inventStoryText
};
