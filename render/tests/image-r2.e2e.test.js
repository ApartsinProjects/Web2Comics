const fs = require('fs');
const os = require('os');
const path = require('path');
const { generatePanelsWithRuntimeConfig } = require('../src/generate');
const { R2ImageStorageManager } = require('../src/image-storage');

const runR2 = String(process.env.RUN_R2_E2E || '').toLowerCase() === 'true';

function hasR2Env() {
  return Boolean(
    String(process.env.R2_S3_ENDPOINT || '').trim()
    && String(process.env.R2_BUCKET || '').trim()
    && String(process.env.R2_ACCESS_KEY_ID || '').trim()
    && String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
  );
}

async function waitForStatus(predicate, timeoutMs = 10000, stepMs = 250) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

describe('image R2 real e2e', () => {
  const shouldRun = runR2 && hasR2Env();

  (shouldRun ? it : it.skip)('stores generated panel images in R2 and fetches bytes back', async () => {
    const previousFake = process.env.RENDER_BOT_FAKE_GENERATOR;
    process.env.RENDER_BOT_FAKE_GENERATOR = 'true';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-r2-image-e2e-'));
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const cfg = path.join(tmp, 'cfg.yml');
    fs.writeFileSync(cfg, 'generation:\n  panel_count: 3\nruntime:\n  retries: 1\nproviders:\n  text:\n    provider: gemini\n    model: gemini-2.5-flash\n');

    const prefix = `images/test-${Date.now()}`;
    const statusKey = `status/test-${Date.now()}-image-storage-status.json`;
    const runtime = {
      repoRoot: path.resolve(__dirname, '../..'),
      outDir,
      imageStatusFile: path.join(tmp, 'image-status.json'),
      imageCapacityBytes: 100000,
      imageCleanupThresholdRatio: 0.5,
      fetchTimeoutMs: 10000,
      debugArtifacts: false,
      r2Endpoint: process.env.R2_S3_ENDPOINT,
      r2Bucket: process.env.R2_BUCKET,
      r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
      r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      r2ImagePrefix: prefix,
      r2ImageStatusKey: statusKey
    };

    try {
      const result = await generatePanelsWithRuntimeConfig('r2 e2e generation test', runtime, cfg);
      expect(result.panelMessages.length).toBe(3);

      const manager = new R2ImageStorageManager({
        endpoint: runtime.r2Endpoint,
        bucket: runtime.r2Bucket,
        accessKeyId: runtime.r2AccessKeyId,
        secretAccessKey: runtime.r2SecretAccessKey,
        prefix,
        statusKey,
        capacityBytes: runtime.imageCapacityBytes,
        cleanupThresholdRatio: runtime.imageCleanupThresholdRatio
      });
      const status = await waitForStatus(async () => {
        const next = await manager.loadStatus();
        if (Number(next?.imageCount || 0) > 0 && Array.isArray(next.images) && next.images.length > 0) {
          return next;
        }
        return null;
      }, 20000, 300);
      expect(status).toBeTruthy();
      expect(status.imageCount).toBeGreaterThan(0);
      expect(status.images[0].key).toContain(prefix);

      const bytes = await manager.fetchImageBytesByKey(status.images[0].key);
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(0);
    } finally {
      if (previousFake == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previousFake;
    }
  }, 120000);
});
