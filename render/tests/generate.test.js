const fs = require('fs');
const os = require('os');
const path = require('path');
const { shouldInstallPlaywrightBrowser, inventStoryText } = require('../src/generate');

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
});
