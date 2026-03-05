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

function isFakeGeneratorEnabled() {
  return String(process.env.RENDER_BOT_FAKE_GENERATOR || '').trim().toLowerCase() === 'true';
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

  const result = await runComicEngine({
    rootDir: runtime.repoRoot,
    inputPath: prep.inputPath,
    configPath: runtimeConfigPath,
    outputPath: prep.outputPath,
    debugDir,
    titleOverride: prep.titleOverride
  });

  return {
    ...result,
    outputLanguage: resolvedLanguage,
    kind: prep.kind,
    summary: prep.summary
  };
}

async function generatePanelsWithRuntimeConfig(text, runtime, effectiveConfigPath, options = {}) {
  if (isFakeGeneratorEnabled()) {
    await maybeFakeDelay();
    const parsed = classifyMessageInput(text);
    if (parsed.kind === 'empty') throw new Error('Empty message. Send plain text or full URL.');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const scope = resolvePanelOutputScope(runtime, options, ts);
    const panelCount = 3;
    const panelMessages = [];
    const writtenPaths = [];
    for (let i = 0; i < panelCount; i += 1) {
      const imagePath = path.join(scope.baseDir, `panel-${i + 1}.png`);
      writeTinyPng(imagePath);
      try {
        const marked = await applyPanelWatermark(fs.readFileSync(imagePath));
        fs.writeFileSync(imagePath, marked);
      } catch (_) {}
      writtenPaths.push(imagePath);
      const caption = `${i + 1}(${panelCount}) Fake panel ${i + 1}`;
      const panelMessage = {
        index: i + 1,
        caption,
        imagePath
      };
      panelMessages.push(panelMessage);
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady(panelMessage);
      }
    }
    recordGeneratedImagesInBackground(runtime, writtenPaths);
    return {
      panelCount,
      elapsedMs: 5,
      kind: parsed.kind,
      summary: parsed.kind === 'url' ? parsed.value : `text (${parsed.value.length} chars)`,
      panelMessages,
      storyboard: {
        panels: panelMessages.map((p) => ({
          index: p.index,
          caption: p.caption,
          beat: '',
          imagePrompt: p.caption
        }))
      }
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

  const panelMessages = [];
  const writtenPaths = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const scope = resolvePanelOutputScope(runtime, options, ts);

  const detailed = await runComicEnginePanels({
    rootDir: runtime.repoRoot,
    inputPath: prep.inputPath,
    configPath: runtimeConfigPath,
    debugDir,
    titleOverride: prep.titleOverride,
    onPanelReady: async ({ index, total, panel, image }) => {
      const imagePath = path.join(scope.baseDir, `panel-${index + 1}.png`);
      const markedBuffer = await applyPanelWatermark(image.buffer);
      fs.writeFileSync(imagePath, markedBuffer);
      writtenPaths.push(imagePath);
      const captionText = String(panel?.caption || '').trim();
      const beatText = String(panel?.beat || '').trim();
      const caption = beatText
        ? `${index + 1}(${total}) ${captionText}\n${beatText}`
        : `${index + 1}(${total}) ${captionText}`;
      const panelMessage = {
        index: index + 1,
        caption: caption.slice(0, 1000),
        imagePath
      };
      panelMessages[index] = panelMessage;
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady(panelMessage);
      }
    }
  });

  recordGeneratedImagesInBackground(runtime, writtenPaths);

  return {
    panelCount: detailed.storyboard?.panels?.length || panelMessages.filter(Boolean).length,
    elapsedMs: detailed.elapsedMs,
    outputLanguage: resolvedLanguage,
    kind: prep.kind,
    summary: prep.summary,
    panelMessages: panelMessages.filter(Boolean),
    storyboard: detailed.storyboard || null
  };
}

async function inventStoryText(seedText, effectiveConfigPath) {
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
  const prompt = [
    'You are a creative comic writer.',
    'Expand the seed into an engaging short narrative that is easy to storyboard into comic panels.',
    'Add at least two unexpected but coherent twists.',
    'Keep characters and timeline consistent.',
    `Write the output strictly in language code "${targetLanguage}".`,
    'Return plain text only (no JSON, no markdown headings).',
    '',
    `Seed story:`,
    seed
  ].join('\n');

  const runtimeConfig = {
    ...(config.runtime || {}),
    text_temperature: inventTemperature
  };

  return withRetries(
    () => generateTextWithProvider(config.providers.text, prompt, runtimeConfig),
    config.runtime.retries,
    'Story invention'
  ).then((generated) => sanitizeInventedStoryText(generated));
}

module.exports = {
  generateWithRuntimeConfig,
  generatePanelsWithRuntimeConfig,
  detectLanguageFromText,
  detectLanguageFromHtmlFile,
  resolveOutputLanguage,
  resolveInventLanguage,
  resolveInventTemperature,
  sanitizeInventedStoryText,
  applyPanelWatermark,
  shouldInstallPlaywrightBrowser,
  inventStoryText
};
