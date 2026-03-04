const { parseArgs, randomSecret } = require('../scripts/lib');

describe('render deploy helpers', () => {
  it('parses --key value args', () => {
    const parsed = parseArgs(['--render-api-key', 'abc', '--plan', 'free']);
    expect(parsed['render-api-key']).toBe('abc');
    expect(parsed.plan).toBe('free');
  });

  it('creates random secret', () => {
    const s = randomSecret(40);
    expect(s.length).toBe(40);
  });
});
