const { parseUserValue, getOptions } = require('../src/options');

describe('render options', () => {
  it('parses numeric path values', () => {
    expect(parseUserValue('generation.panel_count', '6')).toBe(6);
    expect(parseUserValue('runtime.retries', '2')).toBe(2);
    expect(parseUserValue('generation.invent_temperature', '1.25')).toBe(1.25);
  });

  it('returns options list', () => {
    const opts = getOptions('generation.objective');
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.includes('summarize')).toBe(true);
    expect(getOptions('generation.invent_temperature').includes('0.95')).toBe(true);
    expect(getOptions('generation.delivery_mode').includes('media_group')).toBe(true);
  });
});
