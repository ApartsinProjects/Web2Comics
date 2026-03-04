const { shouldInstallPlaywrightBrowser } = require('../src/generate');

describe('render generate helpers', () => {
  it('detects missing playwright browser error', () => {
    const err = new Error("browserType.launch: Executable doesn't exist at /some/path/chrome-headless-shell");
    expect(shouldInstallPlaywrightBrowser(err)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    const err = new Error('network timeout');
    expect(shouldInstallPlaywrightBrowser(err)).toBe(false);
  });
});
