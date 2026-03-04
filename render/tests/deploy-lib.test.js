const { parseArgs, randomSecret, resolveLatestDeployId } = require('../scripts/lib');

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

  it('resolves latest deploy id from deploy list rows', () => {
    const now = Date.now();
    const rows = [
      { deploy: { id: 'dep-old', createdAt: new Date(now - 60_000).toISOString() } },
      { deploy: { id: 'dep-new', createdAt: new Date(now + 1_000).toISOString() } }
    ];
    expect(resolveLatestDeployId(rows, now)).toBe('dep-new');
  });
});
