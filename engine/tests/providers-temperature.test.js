const { generateTextWithProvider } = require('../src/providers');

describe('provider text temperature wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.HUGGINGFACE_INFERENCE_API_TOKEN;
  });

  it('passes text_temperature to Cloudflare text provider payload', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-1';
    process.env.CLOUDFLARE_API_TOKEN = 'tok-1';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { response: 'ok' } })
    });
    global.fetch = fetchMock;

    await generateTextWithProvider(
      { provider: 'cloudflare', model: '@cf/meta/llama-3.1-8b-instruct' },
      'hello',
      { timeout_ms: 1000, text_temperature: 1.4 }
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init.body || '{}'));
    expect(body.prompt).toBe('hello');
    expect(body.temperature).toBe(1.4);
  });

  it('returns actionable message for Cloudflare auth errors', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-1';
    process.env.CLOUDFLARE_API_TOKEN = 'tok-1';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        result: null,
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        messages: []
      })
    });

    await expect(generateTextWithProvider(
      { provider: 'cloudflare', model: '@cf/meta/llama-3.1-8b-instruct' },
      'hello',
      { timeout_ms: 1000 }
    )).rejects.toThrow(/Cloudflare text authentication failed/);
  });

  it('passes text_temperature to HuggingFace text provider parameters', async () => {
    process.env.HUGGINGFACE_INFERENCE_API_TOKEN = 'hf-1';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ generated_text: 'ok' })
    });
    global.fetch = fetchMock;

    await generateTextWithProvider(
      { provider: 'huggingface', model: 'mistralai/Mistral-7B-Instruct-v0.2' },
      'hello',
      { timeout_ms: 1000, text_temperature: 1.1 }
    );

    const url = String(fetchMock.mock.calls[0][0] || '');
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init.body || '{}'));
    expect(url).toContain('router.huggingface.co/hf-inference/models/');
    expect(body.inputs).toBe('hello');
    expect(body.parameters.max_new_tokens).toBe(512);
    expect(body.parameters.temperature).toBe(1.1);
  });

  it('migrates deprecated HuggingFace base URL to router endpoint', async () => {
    process.env.HUGGINGFACE_INFERENCE_API_TOKEN = 'hf-1';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ generated_text: 'ok' })
    });
    global.fetch = fetchMock;

    await generateTextWithProvider(
      {
        provider: 'huggingface',
        model: 'mistralai/Mistral-7B-Instruct-v0.2',
        base_url: 'https://api-inference.huggingface.co'
      },
      'hello',
      { timeout_ms: 1000 }
    );

    const url = String(fetchMock.mock.calls[0][0] || '');
    expect(url).toContain('https://router.huggingface.co/hf-inference/models/');
  });
});
