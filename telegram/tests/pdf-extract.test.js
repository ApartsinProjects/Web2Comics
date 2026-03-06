const {
  normalizePdfExtractor,
  getConfiguredPdfExtractor,
  extractPdfStory
} = require('../src/pdf-extract');

describe('pdf extractor', () => {
  it('normalizes configured provider values', () => {
    expect(normalizePdfExtractor('')).toBe('llamaparse');
    expect(normalizePdfExtractor('llama-parse')).toBe('llamaparse');
    expect(normalizePdfExtractor('llamaparse')).toBe('llamaparse');
    expect(normalizePdfExtractor('unstructured')).toBe('unstructured');
    expect(normalizePdfExtractor('unknown')).toBe('llamaparse');
    expect(getConfiguredPdfExtractor({ generation: { pdf_extractor: 'llamaparse' } })).toBe('llamaparse');
    expect(getConfiguredPdfExtractor({ generation: { pdf_extractor: 'unstructured' } })).toBe('unstructured');
  });

  it('returns extracted text in fake pdf extractor mode', async () => {
    const prev = process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR;
    process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR = 'true';
    try {
      const result = await extractPdfStory(
        { url: 'https://example.com/report.pdf', fileName: 'report.pdf' },
        { fetchTimeoutMs: 20000 },
        { generation: { pdf_extractor: 'llamaparse' } },
        {}
      );
      expect(result.providerSelected).toBe('llamaparse');
      expect(result.providerUsed).toBe('llamaparse');
      expect(String(result.text || '').length).toBeGreaterThan(40);
    } finally {
      if (prev == null) delete process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR;
      else process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR = prev;
    }
  });

  it('supports fake mode with unstructured selected', async () => {
    const prev = process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR;
    process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR = 'true';
    try {
      const result = await extractPdfStory(
        { url: 'https://example.com/report.pdf', fileName: 'report.pdf' },
        { fetchTimeoutMs: 20000 },
        { generation: { pdf_extractor: 'unstructured' } },
        {}
      );
      expect(result.providerSelected).toBe('unstructured');
      expect(result.providerUsed).toBe('unstructured');
      expect(String(result.text || '').length).toBeGreaterThan(40);
    } finally {
      if (prev == null) delete process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR;
      else process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR = prev;
    }
  });
});
