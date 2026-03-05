const fs = require('fs');
const path = require('path');
const { runComicEngine } = require('../../engine/src');
const { fetchUrlToHtmlSnapshot, buildSnapshotPath } = require('../../engine/src/url-fetch');
const { classifyMessageInput, toSafeToken } = require('./message-utils');

async function buildInputFromMessage(messageText, runtime) {
  const classified = classifyMessageInput(messageText);
  if (classified.kind === 'empty') {
    throw new Error('Message is empty. Send plain text or a full URL (http/https).');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(runtime.outDir, { recursive: true });

  if (classified.kind === 'url') {
    const outputBase = `comic-url-${ts}-${toSafeToken(classified.value, 24)}`;
    const outputPath = path.join(runtime.outDir, `${outputBase}.png`);
    const snapshotPath = buildSnapshotPath(classified.value, outputPath, '');
    const snap = await fetchUrlToHtmlSnapshot(classified.value, snapshotPath, {
      timeoutMs: runtime.fetchTimeoutMs,
      waitUntil: 'domcontentloaded'
    });
    return {
      kind: 'url',
      inputPath: snap.snapshotPath,
      outputPath,
      titleOverride: `${runtime.titlePrefix}: ${new URL(snap.finalUrl || classified.value).hostname}`,
      summary: `URL snapshot: ${snap.finalUrl || classified.value}`,
      debugDir: runtime.debugArtifacts ? path.join(runtime.outDir, `${outputBase}-debug`) : ''
    };
  }

  const outputBase = `comic-text-${ts}`;
  const inputPath = path.join(runtime.outDir, `${outputBase}.txt`);
  const outputPath = path.join(runtime.outDir, `${outputBase}.png`);
  fs.writeFileSync(inputPath, classified.value, 'utf8');
  return {
    kind: 'text',
    inputPath,
    outputPath,
    titleOverride: runtime.titlePrefix,
    summary: `Text input (${classified.value.length} chars)`,
    debugDir: runtime.debugArtifacts ? path.join(runtime.outDir, `${outputBase}-debug`) : ''
  };
}

async function generateComicForMessage(messageText, runtime) {
  const prepared = await buildInputFromMessage(messageText, runtime);
  const result = await runComicEngine({
    rootDir: runtime.repoRoot,
    inputPath: prepared.inputPath,
    configPath: runtime.engineConfigPath,
    outputPath: prepared.outputPath,
    debugDir: prepared.debugDir,
    titleOverride: prepared.titleOverride
  });

  return {
    ...result,
    kind: prepared.kind,
    summary: prepared.summary
  };
}

module.exports = {
  buildInputFromMessage,
  generateComicForMessage
};
