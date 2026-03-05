const { parseArgs, randomSecret, resolveLatestDeployId, validateProviderEnv } = require('../scripts/lib');

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

  it('validates provider keys in strict mode', () => {
    const result = validateProviderEnv({
      GEMINI_API_KEY: 'x',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: 'x',
      CLOUDFLARE_ACCOUNT_ID: 'x',
      CLOUDFLARE_API_TOKEN: 'x',
      HUGGINGFACE_INFERENCE_API_TOKEN: 'x'
    }, true);
    expect(result.ok).toBe(false);
    expect(result.missing.includes('OPENAI_API_KEY')).toBe(true);
  });

  it('validates provider keys in non-strict mode', () => {
    const result = validateProviderEnv({
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: 'x'
    }, false);
    expect(result.ok).toBe(true);
    expect(result.missing.length).toBe(0);
  });
});
