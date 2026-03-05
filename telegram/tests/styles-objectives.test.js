const {
  STYLE_PRESETS,
  STYLE_SHORTCUTS,
  getStyleMeta
} = require('../src/data/styles-objectives');

describe('styles-objectives catalog', () => {
  it('maps every built-in style to a slash shortcut', () => {
    const styleIds = Object.keys(STYLE_PRESETS);
    expect(styleIds.length).toBeGreaterThan(10);
    for (const id of styleIds) {
      expect(STYLE_SHORTCUTS[`/${id}`]).toBe(id);
      const meta = getStyleMeta(id);
      expect(String(meta.name || '').trim().length).toBeGreaterThan(0);
      expect(String(meta.description || '').trim().length).toBeGreaterThan(0);
    }
  });

  it('contains expected new presets', () => {
    const expected = ['cinematic', 'anime', 'cyberpunk', 'pixel-art', 'retro-pop', 'clay-3d'];
    for (const id of expected) {
      expect(Object.prototype.hasOwnProperty.call(STYLE_PRESETS, id)).toBe(true);
      expect(STYLE_SHORTCUTS[`/${id}`]).toBe(id);
    }
  });
});
