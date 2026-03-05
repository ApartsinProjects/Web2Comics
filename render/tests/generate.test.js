const fs = require('fs');
const os = require('os');
const path = require('path');
const { shouldInstallPlaywrightBrowser, inventStoryText, generatePanelsWithRuntimeConfig } = require('../src/generate');

describe('render generate helpers', () => {
  it('detects missing playwright browser error', () => {
    const err = new Error("browserType.launch: Executable doesn't exist at /some/path/chrome-headless-shell");
    expect(shouldInstallPlaywrightBrowser(err)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    const err = new Error('network timeout');
    expect(shouldInstallPlaywrightBrowser(err)).toBe(false);
  });

  it('builds invented story in fake-generator mode', async () => {
    const previous = process.env.RENDER_BOT_FAKE_GENERATOR;
    process.env.RENDER_BOT_FAKE_GENERATOR = 'true';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-invent-'));
      const cfg = path.join(tmp, 'cfg.yml');
      fs.writeFileSync(cfg, 'generation:\n  panel_count: 3\nruntime:\n  retries: 1\nproviders:\n  text:\n    provider: gemini\n    model: gemini-2.5-flash\n');
      const expanded = await inventStoryText('A small seed', cfg);
      expect(String(expanded)).toContain('Unexpected turn');
      expect(String(expanded)).toContain('A small seed');
    } finally {
      if (previous == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previous;
    }
  });

  it('builds ordered panel outputs in fake-generator mode', async () => {
    const previous = process.env.RENDER_BOT_FAKE_GENERATOR;
    process.env.RENDER_BOT_FAKE_GENERATOR = 'true';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-panels-'));
      const outDir = path.join(tmp, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const cfg = path.join(tmp, 'cfg.yml');
      fs.writeFileSync(cfg, 'generation:\n  panel_count: 3\nruntime:\n  retries: 1\nproviders:\n  text:\n    provider: gemini\n    model: gemini-2.5-flash\n');
      const result = await generatePanelsWithRuntimeConfig(
        'Panel ordering test story',
        { repoRoot: process.cwd(), outDir, fetchTimeoutMs: 20000, debugArtifacts: false },
        cfg
      );
      expect(result.panelMessages.length).toBe(3);
      expect(result.panelMessages[0].caption).toContain('1.');
      expect(result.panelMessages[1].caption).toContain('2.');
      expect(result.panelMessages[2].caption).toContain('3.');
      expect(fs.existsSync(result.panelMessages[0].imagePath)).toBe(true);
    } finally {
      if (previous == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previous;
    }
  });
});
