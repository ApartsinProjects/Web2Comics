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

  it('falls back to gemini-2.5-flash-image on daily quota (RPD) 429 errors', async () => {
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
      if (calls.length <= 2) {
        return mockJsonResponse({
          error: {
            message: 'You exceeded your current quota. Request per day (RPD) limit reached. Please migrate to Gemini 2.5 Flash Image.'
          }
        }, 429);
      }
      return mockJsonResponse({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: Buffer.from('fallback-image').toString('base64')
              }
            }]
          }
        }]
      });
    };

    const out = await generateImageWithProvider(
      { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' },
      'Draw a mountain skyline at sunset',
      { timeout_ms: 5000 }
    );
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.mimeType).toBe('image/png');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[0].url).toContain('/models/gemini-2.0-flash-exp-image-generation:generateContent');
    expect(calls.some((c) => c.url.includes('/models/gemini-2.5-flash-image:generateContent'))).toBe(true);
  });

  it('does not switch model on per-minute quota 429 errors', async () => {
    process.env.GEMINI_API_KEY = 'TEST_KEY';
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
      return mockJsonResponse({
        error: {
          message: 'Rate limit exceeded',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                {
                  quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests_per_minute',
                  quotaId: 'GenerateContentRequestsPerMinutePerProjectPerModel',
                  quotaDimensions: { model: 'gemini-2.0-flash-exp-image-generation' }
                }
              ]
            },
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '30s'
            }
          ]
        }
      }, 429);
    };

    await expect(generateImageWithProvider(
      { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' },
      'Draw a futuristic city skyline',
      { timeout_ms: 5000 }
    )).rejects.toThrow('PerMinute');

    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.url.includes('/models/gemini-2.0-flash-exp-image-generation:generateContent'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/models/gemini-2.5-flash-image:generateContent'))).toBe(false);
  });
});
