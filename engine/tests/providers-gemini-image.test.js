const { generateImageWithProvider } = require('../src/providers');

function mockJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

describe('gemini image provider resilience', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it('retries once with image-only modality when first response is text-only', async () => {
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    const calls = [];
    global.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body || '{}')));
      if (calls.length === 1) {
        return mockJsonResponse({
          candidates: [{ content: { parts: [{ text: 'I can describe this scene instead.' }] } }]
        });
      }
      return mockJsonResponse({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: Buffer.from('png-bytes').toString('base64')
              }
            }]
          }
        }]
      });
    };

    const out = await generateImageWithProvider(
      { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' },
      'Draw a calm skyline at dawn',
      { timeout_ms: 5000 }
    );
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.mimeType).toBe('image/png');
    expect(calls.length).toBe(2);
    expect(calls[0].generationConfig.responseModalities).toEqual(['image', 'text']);
    expect(calls[1].generationConfig.responseModalities).toEqual(['image']);
    expect(String(calls[1].contents?.[0]?.parts?.[0]?.text || '')).toContain('Return image output only');
  });

  it('throws clear error when Gemini still returns no inline image data', async () => {
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    global.fetch = async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: 'Still no image.' }] } }]
    });

    await expect(generateImageWithProvider(
      { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' },
      'Draw a city street',
      { timeout_ms: 5000 }
    )).rejects.toThrow('Gemini image response did not include inline image bytes');
  });
});

