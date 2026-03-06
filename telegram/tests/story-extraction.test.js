const {
  normalizeImageExtractor,
  normalizeVoiceExtractor,
  detectStoryExtractionSource,
  extractStoryFromSource
} = require('../src/story-extraction');

describe('story extraction phase', () => {
  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body || {})
    };
  }

  it('normalizes image extractor values', () => {
    expect(normalizeImageExtractor('')).toBe('gemini');
    expect(normalizeImageExtractor('openai')).toBe('openai');
    expect(normalizeImageExtractor('unknown')).toBe('gemini');
  });

  it('normalizes voice extractor values', () => {
    expect(normalizeVoiceExtractor('')).toBe('assemblyai');
    expect(normalizeVoiceExtractor('assemblyai')).toBe('assemblyai');
    expect(normalizeVoiceExtractor('unknown')).toBe('assemblyai');
  });

  it('detects source types from text/url/document/photo', () => {
    expect(detectStoryExtractionSource({}, 'https://example.com/page').type).toBe('html_url');
    expect(detectStoryExtractionSource({}, 'https://example.com/file.pdf').type).toBe('pdf_url');
    expect(detectStoryExtractionSource({}, 'https://example.com/pic.jpg').type).toBe('image_url');
    expect(detectStoryExtractionSource({ document: { mime_type: 'application/pdf', file_id: 'x' } }, '').type).toBe('pdf_file');
    expect(detectStoryExtractionSource({ photo: [{ file_id: 'a' }] }, '').type).toBe('image_file');
    expect(detectStoryExtractionSource({ voice: { file_id: 'v1' } }, '').type).toBe('audio_file');
    expect(detectStoryExtractionSource({}, 'https://example.com/speech.ogg').type).toBe('audio_url');
    expect(detectStoryExtractionSource({}, 'plain text story').type).toBe('text');
  });

  it('extracts text source directly', async () => {
    const out = await extractStoryFromSource({ type: 'text', text: 'A simple narrative.' }, {});
    expect(out.sourceType).toBe('text');
    expect(out.text).toContain('A simple narrative');
  });

  it('extracts image source in fake mode', async () => {
    const prev = process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR;
    process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR = 'true';
    try {
      const out = await extractStoryFromSource({
        type: 'image_file',
        imageBytes: Buffer.from([1, 2, 3, 4]),
        fileName: 'a.png'
      }, { config: { generation: { image_extractor: 'gemini' } }, runtime: {} });
      expect(out.sourceType).toBe('image_file');
      expect(String(out.text || '').length).toBeGreaterThan(50);
    } finally {
      if (prev == null) delete process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR;
      else process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR = prev;
    }
  });

  it('extracts voice source in fake mode', async () => {
    const prev = process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR;
    process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR = 'true';
    try {
      const out = await extractStoryFromSource({
        type: 'audio_file',
        audioBytes: Buffer.from([1, 2, 3, 4]),
        fileName: 'a.ogg'
      }, { config: { generation: { voice_extractor: 'assemblyai' } }, runtime: {} });
      expect(out.sourceType).toBe('audio_file');
      expect(String(out.text || '').length).toBeGreaterThan(40);
    } finally {
      if (prev == null) delete process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR;
      else process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR = prev;
    }
  });

  it('uses AssemblyAI speech_models payload (not deprecated speech_model)', async () => {
    const prevKey = process.env.ASSEMBLYAI_API_KEY;
    const prevFake = process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR;
    process.env.ASSEMBLYAI_API_KEY = 'test-key';
    delete process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR;

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/v2/upload')) return jsonResponse(200, { upload_url: 'https://upload.example/audio' });
      if (u.includes('/v2/transcript/') && init?.method === 'GET') {
        return jsonResponse(200, { status: 'completed', text: 'A transcribed voice story with enough characters to pass threshold checks in tests.' });
      }
      if (u.includes('/v2/transcript') && init?.method === 'POST') return jsonResponse(200, { id: 'tr_123' });
      return jsonResponse(500, { error: 'unexpected fetch in test' });
    };

    try {
      const out = await extractStoryFromSource({
        type: 'audio_file',
        audioBytes: Buffer.from([1, 2, 3, 4, 5]),
        fileName: 'voice.ogg'
      }, {
        config: { generation: { voice_extractor: 'assemblyai', voice_extractor_assemblyai_model: 'nano' } },
        runtime: { fetchTimeoutMs: 10000 }
      });

      expect(out.sourceType).toBe('audio_file');
      const createCall = calls.find((c) => c.url.includes('/v2/transcript') && c.init?.method === 'POST');
      expect(createCall).toBeTruthy();
      const payload = JSON.parse(String(createCall.init.body || '{}'));
      expect(Array.isArray(payload.speech_models)).toBe(true);
      expect(payload.speech_models[0]).toBe('universal-2');
      expect(payload.speech_model).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
      if (prevKey == null) delete process.env.ASSEMBLYAI_API_KEY;
      else process.env.ASSEMBLYAI_API_KEY = prevKey;
      if (prevFake == null) delete process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR;
      else process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR = prevFake;
    }
  });
});
