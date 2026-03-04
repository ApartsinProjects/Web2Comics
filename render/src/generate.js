const fs = require('fs');
const path = require('path');
const { runComicEngine } = require('../../engine/src');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput } = require('../../comicbot/src/message-utils');

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
