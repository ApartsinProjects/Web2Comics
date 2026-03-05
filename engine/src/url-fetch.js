const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function sanitizeFileToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

function buildSnapshotPath(url, outputPath, explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const outResolved = path.resolve(outputPath || 'engine/out/comic.png');
  const outDir = path.dirname(outResolved);
  const outBase = path.basename(outResolved, path.extname(outResolved));
  const slug = sanitizeFileToken(url);
  return path.join(outDir, `${outBase}.snapshot.${slug}.html`);
}

async function fetchUrlToHtmlSnapshot(url, snapshotPath, options = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error(`URL must start with http:// or https:// (got: ${target})`);
  }

  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 45000));
  const waitUntil = String(options.waitUntil || 'domcontentloaded');
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  await fs.promises.mkdir(path.dirname(resolvedSnapshotPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(target, { waitUntil, timeout: timeoutMs });
    // Try to let lazy content render without stalling too long.
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(10000, timeoutMs) });
    } catch (_) {}

    const html = await page.content();
    await fs.promises.writeFile(resolvedSnapshotPath, html, 'utf8');
    const title = await page.title();
    return {
      snapshotPath: resolvedSnapshotPath,
      finalUrl: page.url(),
      title: String(title || '').trim()
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  sanitizeFileToken,
  buildSnapshotPath,
  fetchUrlToHtmlSnapshot
};
