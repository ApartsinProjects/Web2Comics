const path = require('path');
const { normalizeConfig, loadConfig } = require('../src/config');

describe('engine config', () => {
  it('applies defaults and normalization', () => {
    const cfg = normalizeConfig({
      generation: { panel_count: 99 },
      runtime: { image_concurrency: 0 }
    });
    expect(cfg.generation.panel_count).toBe(20);
    expect(cfg.runtime.image_concurrency).toBe(1);
    expect(cfg.providers.text.provider).toBeTruthy();
  });

  it('loads yaml file', () => {
    const file = path.resolve(__dirname, '../examples/config.gemini.yml');
    const loaded = loadConfig(file);
    expect(loaded.config.providers.text.provider).toBe('gemini');
    expect(loaded.config.providers.image.provider).toBe('gemini');
  });
});
