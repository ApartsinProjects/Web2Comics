const {
  generateTextWithProvider,
  generateImageWithProvider
} = require('../src/providers');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    headers: { get: () => 'application/json' }
  };
}

function imageResponse(buffer, mimeType = 'image/png', status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    headers: { get: (name) => (String(name || '').toLowerCase() === 'content-type' ? mimeType : null) },
    text: async () => ''
  };
}

describe('provider availability coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.HUGGINGFACE_INFERENCE_API_TOKEN;
    delete process.env.HUGGINGFACE_BASE_URL;
  });

  it('supports text generation for all configured providers', async () => {
    process.env.GEMINI_API_KEY = 'gem-key';
    process.env.OPENAI_API_KEY = 'oa-key';
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-acc';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-key';
    process.env.HUGGINGFACE_INFERENCE_API_TOKEN = 'hf-key';

    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'gemini ok' }] } }]
        });
      }
      if (u === 'https://api.openai.com/v1/chat/completions') {
        return jsonResponse({
          choices: [{ message: { content: 'openai ok' } }]
        });
      }
      if (u === 'https://openrouter.ai/api/v1/chat/completions') {
        return jsonResponse({
          choices: [{ message: { content: 'openrouter ok' } }]
        });
      }
      if (u.includes('/ai/run/')) {
        return jsonResponse({ result: { response: 'cloudflare ok' } });
      }
      if (u.includes('router.huggingface.co/hf-inference/models/')) {
        return jsonResponse({ generated_text: 'huggingface ok' });
      }
      return jsonResponse({ message: `unexpected ${u}` }, 404);
    });
    global.fetch = fetchMock;

    const runtime = { timeout_ms: 1000 };
    const rows = [
      { provider: 'gemini', model: 'gemini-2.5-flash', expected: 'gemini ok' },
      { provider: 'openai', model: 'gpt-4o-mini', expected: 'openai ok' },
      { provider: 'openrouter', model: 'openai/gpt-4o-mini', expected: 'openrouter ok' },
      { provider: 'cloudflare', model: '@cf/meta/llama-3.1-8b-instruct', expected: 'cloudflare ok' },
      { provider: 'huggingface', model: 'mistralai/Mistral-7B-Instruct-v0.2', expected: 'huggingface ok' }
    ];

    for (const row of rows) {
      const out = await generateTextWithProvider({ provider: row.provider, model: row.model }, 'ping', runtime);
      expect(out).toContain(row.expected);
    }
  });

  it('supports image generation for all configured providers', async () => {
    process.env.GEMINI_API_KEY = 'gem-key';
    process.env.OPENAI_API_KEY = 'oa-key';
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-acc';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-key';
    process.env.HUGGINGFACE_INFERENCE_API_TOKEN = 'hf-key';

    const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{
            content: { parts: [{ inlineData: { data: pngBytes.toString('base64'), mimeType: 'image/png' } }] }
          }]
        });
      }
      if (u === 'https://api.openai.com/v1/images/generations') {
        return jsonResponse({ data: [{ b64_json: pngBytes.toString('base64') }] });
      }
      if (u === 'https://openrouter.ai/api/v1/images/generations') {
        return jsonResponse({ data: [{ b64_json: pngBytes.toString('base64') }] });
      }
      if (u.includes('/ai/run/')) {
        return jsonResponse({ result: { image: `data:image/png;base64,${pngBytes.toString('base64')}` } });
      }
      if (u.includes('router.huggingface.co/hf-inference/models/')) {
        return imageResponse(pngBytes, 'image/png');
      }
      return jsonResponse({ message: `unexpected ${u}` }, 404);
    });
    global.fetch = fetchMock;

    const runtime = { timeout_ms: 1000 };
    const rows = [
      { provider: 'gemini', model: 'gemini-2.5-flash-image' },
      { provider: 'openai', model: 'gpt-image-1' },
      { provider: 'openrouter', model: 'openai/gpt-image-1' },
      { provider: 'cloudflare', model: '@cf/stabilityai/stable-diffusion-xl-base-1.0' },
      { provider: 'huggingface', model: 'black-forest-labs/FLUX.1-schnell' }
    ];

    for (const row of rows) {
      const out = await generateImageWithProvider({ provider: row.provider, model: row.model }, 'A test prompt', runtime);
      expect(Buffer.isBuffer(out.buffer)).toBe(true);
      expect(out.buffer.length).toBeGreaterThan(0);
    }
  });
});
