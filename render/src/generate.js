const fs = require('fs');
const path = require('path');
const { runComicEngine } = require('../../engine/src');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput } = require('./message-utils');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBAp6R9gAAAABJRU5ErkJggg==';

function isFakeGeneratorEnabled() {
  return String(process.env.RENDER_BOT_FAKE_GENERATOR || '').trim().toLowerCase() === 'true';
}

function writeTinyPng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
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
    const snap = await fetchUrlToHtmlSnapshot(parsed.value, snapshotPath, {
      timeoutMs: runtime.fetchTimeoutMs,
      waitUntil: 'domcontentloaded'
    });
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

module.exports = {
  generateWithRuntimeConfig
};
