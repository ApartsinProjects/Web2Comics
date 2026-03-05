const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runComicEngine, runComicEnginePanels, withRetries } = require('../../engine/src');
const { loadConfig } = require('../../engine/src/config');
const { generateTextWithProvider } = require('../../engine/src/providers');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput } = require('./message-utils');
const { createImageStorageManagerFromEnv } = require('./image-storage');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBAp6R9gAAAABJRU5ErkJggg==';

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
      summary: snap.finalUrl || parsed.value
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
    summary: `text (${parsed.value.length} chars)`
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
  const debugDir = runtime.debugArtifacts
    ? path.join(runtime.outDir, path.basename(prep.outputPath, '.png') + '-debug')
    : '';

  const result = await runComicEngine({
    rootDir: runtime.repoRoot,
    inputPath: prep.inputPath,
    configPath: effectiveConfigPath,
    outputPath: prep.outputPath,
    debugDir,
    titleOverride: prep.titleOverride
  });

  return {
    ...result,
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
    const panelCount = 3;
    const panelMessages = [];
    const writtenPaths = [];
    for (let i = 0; i < panelCount; i += 1) {
      const imagePath = path.join(runtime.outDir, `render-fake-${ts}-panel-${i + 1}.png`);
      writeTinyPng(imagePath);
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
  const debugDir = runtime.debugArtifacts
    ? path.join(runtime.outDir, path.basename(prep.outputPath, '.png') + '-debug')
    : '';

  const panelMessages = [];
  const writtenPaths = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(runtime.outDir, { recursive: true });

  const detailed = await runComicEnginePanels({
    rootDir: runtime.repoRoot,
    inputPath: prep.inputPath,
    configPath: effectiveConfigPath,
    debugDir,
    titleOverride: prep.titleOverride,
    onPanelReady: async ({ index, total, panel, image }) => {
      const imagePath = path.join(runtime.outDir, `render-${prep.kind}-${ts}-panel-${index + 1}.png`);
      fs.writeFileSync(imagePath, image.buffer);
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
    return [
      'Expanded Storyboard Draft',
      '',
      `${seed}`,
      '',
      'Unexpected turn: a hidden clue changes who the hero can trust.',
      'Unexpected turn: a quiet side character reveals critical information.',
      'Ending beat: the conflict resolves with an emotional payoff.'
    ].join('\n');
  }

  const loaded = loadConfig(effectiveConfigPath);
  const config = loaded.config;
  const prompt = [
    'You are a creative comic writer.',
    'Expand the seed into an engaging short narrative that is easy to storyboard into comic panels.',
    'Add at least two unexpected but coherent twists.',
    'Keep characters and timeline consistent.',
    'Return plain text only (no JSON, no markdown headings).',
    '',
    `Seed story:`,
    seed
  ].join('\n');

  const runtimeConfig = {
    ...(config.runtime || {}),
    text_temperature: 0.95
  };

  return withRetries(
    () => generateTextWithProvider(config.providers.text, prompt, runtimeConfig),
    config.runtime.retries,
    'Story invention'
  );
}

module.exports = {
  generateWithRuntimeConfig,
  generatePanelsWithRuntimeConfig,
  shouldInstallPlaywrightBrowser,
  inventStoryText
};
