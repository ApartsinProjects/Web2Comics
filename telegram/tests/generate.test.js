const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  shouldInstallPlaywrightBrowser,
  inventStoryText,
  generatePanelsWithRuntimeConfig,
  detectLanguageFromText,
  detectLanguageFromHtmlFile,
  resolveOutputLanguage,
  resolveInventLanguage,
  resolveInventTemperature,
  isShortStoryPrompt,
  runStoryEnrichment,
  buildEnrichedSeedText,
  normalizeEnrichmentProvider,
  resolvePanelWatermarkEnabled,
  isProviderOrModelFailure,
  shouldFallbackToGemini,
  shouldPreemptiveFallbackToGemini,
  getUrlExtractionFailureReason,
  sanitizeInventedStoryText,
  applyPanelWatermark,
  getUrlExtractorAttemptOrder,
  normalizeUrlExtractor
} = require('../src/generate');

describe('render generate helpers', () => {
  it('detects missing playwright browser error', () => {
    const err = new Error("browserType.launch: Executable doesn't exist at /some/path/chrome-headless-shell");
    expect(shouldInstallPlaywrightBrowser(err)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    const err = new Error('network timeout');
    expect(shouldInstallPlaywrightBrowser(err)).toBe(false);
  });

  it('builds invented story in fake-generator mode', async () => {
    const previous = process.env.RENDER_BOT_FAKE_GENERATOR;
    process.env.RENDER_BOT_FAKE_GENERATOR = 'true';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-invent-'));
      const cfg = path.join(tmp, 'cfg.yml');
      fs.writeFileSync(cfg, 'generation:\n  panel_count: 3\nruntime:\n  retries: 1\nproviders:\n  text:\n    provider: gemini\n    model: gemini-2.5-flash\n');
      const expanded = await inventStoryText('A small seed', cfg);
      expect(String(expanded)).toContain('A small seed');
      expect(String(expanded)).not.toMatch(/panel\s+[a-z0-9ivx]+/i);
    } finally {
      if (previous == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previous;
    }
  });

  it('sanitizes storyboard markers from invented story text', () => {
    const raw = [
      'Storyboard',
      'Panel A: Mina enters a dark hallway.',
      '2) She hears footsteps and freezes.',
      '- A hidden door opens behind her.',
      'Panel B - Her friend appears with a flashlight.',
      'In the end, they solve the mystery together.'
    ].join('\n');
    const cleaned = sanitizeInventedStoryText(raw);
    expect(cleaned).toContain('Mina enters a dark hallway.');
    expect(cleaned).toContain('She hears footsteps and freezes.');
    expect(cleaned).toContain('A hidden door opens behind her.');
    expect(cleaned).toContain('Her friend appears with a flashlight.');
    expect(cleaned).toContain('In the end, they solve the mystery together.');
    expect(cleaned).not.toMatch(/^\s*Storyboard\s*$/im);
    expect(cleaned).not.toMatch(/^\s*Panel\s+[A-Z0-9]/im);
  });

  it('builds ordered panel outputs in fake-generator mode', async () => {
    const previous = process.env.RENDER_BOT_FAKE_GENERATOR;
    process.env.RENDER_BOT_FAKE_GENERATOR = 'true';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-panels-'));
      const outDir = path.join(tmp, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const cfg = path.join(tmp, 'cfg.yml');
      fs.writeFileSync(cfg, 'generation:\n  panel_count: 3\nruntime:\n  retries: 1\nproviders:\n  text:\n    provider: gemini\n    model: gemini-2.5-flash\n');
      const result = await generatePanelsWithRuntimeConfig(
        'Panel ordering test story',
        { repoRoot: process.cwd(), outDir, fetchTimeoutMs: 20000, debugArtifacts: false },
        cfg,
        { userId: 777, generationId: 'gen-test-123' }
      );
      expect(result.panelMessages.length).toBe(3);
      expect(result.panelMessages[0].caption).toContain('1(3)');
      expect(result.panelMessages[1].caption).toContain('2(3)');
      expect(result.panelMessages[2].caption).toContain('3(3)');
      expect(fs.existsSync(result.panelMessages[0].imagePath)).toBe(true);
      const normalized = String(result.panelMessages[0].imagePath).replace(/\\/g, '/');
      expect(normalized).toContain('/users/777/generations/gen-test-123/');
    } finally {
      if (previous == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previous;
    }
  });

  it('detects language from text scripts', () => {
    expect(detectLanguageFromText('שלום עולם')).toBe('he');
    expect(detectLanguageFromText('こんにちは 世界')).toBe('ja');
    expect(detectLanguageFromText('Привет, мир')).toBe('ru');
  });

  it('falls back to english when text language is not clear', () => {
    expect(detectLanguageFromText('Hello world, this is a simple story.')).toBe('en');
    expect(detectLanguageFromText('12345 ???')).toBe('en');
  });

  it('detects language from html lang attribute', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-lang-html-'));
    const htmlPath = path.join(tmp, 'page.html');
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><html lang="he-IL"><head><title>x</title></head><body><p>ignored</p></body></html>',
      'utf8'
    );
    expect(detectLanguageFromHtmlFile(htmlPath)).toBe('he');
  });

  it('detects language from og:locale and content-language signals', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-lang-signals-'));
    const htmlPath = path.join(tmp, 'page.html');
    fs.writeFileSync(
      htmlPath,
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<meta property="og:locale" content="pt_BR" />',
        '<meta http-equiv="content-language" content="pt-BR,en-US" />',
        '</head>',
        '<body><p>ignored</p></body>',
        '</html>'
      ].join(''),
      'utf8'
    );
    expect(detectLanguageFromHtmlFile(htmlPath)).toBe('pt');
  });

  it('detects language from hreflang when lang/meta are missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-lang-hreflang-'));
    const htmlPath = path.join(tmp, 'page.html');
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><html><head><link rel="alternate" hreflang="de-DE" href="/de" /></head><body><p>Hello</p></body></html>',
      'utf8'
    );
    expect(detectLanguageFromHtmlFile(htmlPath)).toBe('de');
  });

  it('resolves auto language from html first, then english fallback', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-lang-auto-'));
    const htmlPath = path.join(tmp, 'page.html');
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><html lang="es"><head></head><body><p>Hello</p></body></html>',
      'utf8'
    );

    expect(resolveOutputLanguage('', { kind: 'url', inputPath: htmlPath, sourceText: '' }, { generation: { output_language: 'auto' } }))
      .toBe('es');
    expect(resolveOutputLanguage('', { kind: 'text', inputPath: '', sourceText: '' }, { generation: { output_language: 'auto' } }))
      .toBe('en');
  });

  it('resolves invent language from configured language', () => {
    expect(resolveInventLanguage('Any seed text', { generation: { output_language: 'he' } })).toBe('he');
  });

  it('resolves invent language from seed text when config is auto', () => {
    expect(resolveInventLanguage('Hola, este cuento empieza en la ciudad.', { generation: { output_language: 'auto' } })).toBe('es');
  });

  it('resolves invent language to english when auto and seed is unclear', () => {
    expect(resolveInventLanguage('12345 ???', { generation: { output_language: 'auto' } })).toBe('en');
  });

  it('resolves invent temperature with clamp and fallback', () => {
    expect(resolveInventTemperature({ generation: { invent_temperature: 1.2 } })).toBe(1.2);
    expect(resolveInventTemperature({ generation: { invent_temperature: 99 } })).toBe(2);
    expect(resolveInventTemperature({ generation: { invent_temperature: -2 } })).toBe(0);
    expect(resolveInventTemperature({ generation: {} })).toBe(0.95);
  });

  it('resolves panel watermark default and explicit values', () => {
    expect(resolvePanelWatermarkEnabled({ generation: {} })).toBe(true);
    expect(resolvePanelWatermarkEnabled({ generation: { panel_watermark: false } })).toBe(false);
    expect(resolvePanelWatermarkEnabled({ generation: { panel_watermark: 'false' } })).toBe(false);
    expect(resolvePanelWatermarkEnabled({ generation: { panel_watermark: '0' } })).toBe(false);
    expect(resolvePanelWatermarkEnabled({ generation: { panel_watermark: 'true' } })).toBe(true);
  });

  it('applies watermark to panel image buffer', async () => {
    const base = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: '#446688'
      }
    }).png().toBuffer();

    const marked = await applyPanelWatermark(base);
    expect(Buffer.isBuffer(marked)).toBe(true);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.equals(base)).toBe(false);

    const metaA = await sharp(base).metadata();
    const metaB = await sharp(marked).metadata();
    expect(metaB.width).toBe(metaA.width);
    expect(metaB.height).toBe(metaA.height);
  });

  it('detects provider/model style failures for fallback', () => {
    expect(isProviderOrModelFailure(new Error('Cloudflare text failed (401): Authentication error'))).toBe(true);
    expect(isProviderOrModelFailure(new Error('Unsupported image provider: custom'))).toBe(true);
    expect(isProviderOrModelFailure(new Error('network timeout while reading file'))).toBe(false);
  });

  it('enables gemini fallback for non-gemini provider errors when GEMINI_API_KEY exists', () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'x';
    try {
      const cfg = {
        providers: {
          text: { provider: 'cloudflare' },
          image: { provider: 'cloudflare' }
        }
      };
      expect(shouldFallbackToGemini(cfg, new Error('Cloudflare text failed (401): Authentication error'))).toBe(true);
      expect(shouldFallbackToGemini(cfg, new Error('random error'))).toBe(false);
    } finally {
      if (prev == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });

  it('enables preemptive fallback when selected provider is missing required env', () => {
    const prevGem = process.env.GEMINI_API_KEY;
    const prevCfAcc = process.env.CLOUDFLARE_ACCOUNT_ID;
    const prevCfTok = process.env.CLOUDFLARE_API_TOKEN;
    process.env.GEMINI_API_KEY = 'x';
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      const cfg = {
        providers: {
          text: { provider: 'cloudflare' },
          image: { provider: 'cloudflare' }
        }
      };
      expect(shouldPreemptiveFallbackToGemini(cfg)).toBe(true);
    } finally {
      if (prevGem == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGem;
      if (prevCfAcc == null) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAcc;
      if (prevCfTok == null) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = prevCfTok;
    }
  });

  it('detects early URL extraction failure reasons', () => {
    expect(getUrlExtractionFailureReason({
      title: 'Just a moment...',
      text: 'Checking if the site connection is secure',
      blockedReason: '/just a moment/i'
    })).toContain('blocked or gated');

    expect(getUrlExtractionFailureReason({
      title: 'Example',
      text: 'Short text only'
    })).toContain('not enough readable story text extracted');

    expect(getUrlExtractionFailureReason({
      title: 'Readable article',
      text: 'A'.repeat(220)
    })).toBe('');
  });

  it('normalizes URL extractor aliases and defaults', () => {
    expect(normalizeUrlExtractor('')).toBe('gemini');
    expect(normalizeUrlExtractor('ai')).toBe('gemini');
    expect(normalizeUrlExtractor('browser')).toBe('chromium');
    expect(normalizeUrlExtractor('chromium')).toBe('chromium');
    expect(normalizeUrlExtractor('firecrawl')).toBe('firecrawl');
    expect(normalizeUrlExtractor('jina')).toBe('jina');
    expect(normalizeUrlExtractor('driftbot')).toBe('driftbot');
    expect(normalizeUrlExtractor('unknown')).toBe('gemini');
  });

  it('builds URL extractor failover order with selected provider first', () => {
    expect(getUrlExtractorAttemptOrder('chromium')).toEqual(['chromium', 'gemini', 'firecrawl', 'jina', 'driftbot']);
    expect(getUrlExtractorAttemptOrder('gemini')).toEqual(['gemini', 'firecrawl', 'jina', 'driftbot', 'chromium']);
    expect(getUrlExtractorAttemptOrder('jina')).toEqual(['jina', 'gemini', 'firecrawl', 'driftbot', 'chromium']);
  });

  it('detects short prompts for enrichment by word threshold', () => {
    expect(isShortStoryPrompt('Tokyo 2100', { generation: { short_prompt_word_threshold: 10 } })).toBe(true);
    expect(isShortStoryPrompt('This is a detailed prompt with many concrete narrative constraints and style notes.', { generation: { short_prompt_word_threshold: 6 } })).toBe(false);
  });

  it('normalizes enrichment provider names with safe default', () => {
    expect(normalizeEnrichmentProvider('jina')).toBe('jina');
    expect(normalizeEnrichmentProvider('wikipedia')).toBe('wikipedia');
    expect(normalizeEnrichmentProvider('')).toBe('wikipedia');
    expect(normalizeEnrichmentProvider('unknown')).toBe('wikipedia');
  });

  it('builds bounded enriched seed text with template sections', () => {
    const out = buildEnrichedSeedText(
      'Tokyo 2100',
      {
        items: ['Tokyo is a megacity with advanced transit and robotics.'],
        related: ['Tokyo', 'Japan', 'future city'],
        sources: ['https://example.com/tokyo']
      },
      { generation: { max_enrichment_chars: 800, max_context_items: 5, include_sources: true } }
    );
    expect(out).toContain('Original user prompt:');
    expect(out).toContain('Retrieved context:');
    expect(out).toContain('Related entities or concepts:');
    expect(out).toContain('Instruction:');
  });

  it('falls back to second enrichment provider when selected provider fails', async () => {
    const fetchImpl = async (url) => {
      const u = String(url || '');
      if (u.includes('api.firecrawl.dev')) {
        return {
          ok: false,
          status: 401,
          async text() { return '{"error":"unauthorized"}'; }
        };
      }
      if (u.includes('wikipedia.org/w/api.php')) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              query: {
                search: [{ title: 'Tokyo' }]
              }
            });
          }
        };
      }
      if (u.includes('wikipedia.org/api/rest_v1/page/summary/')) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              extract: 'Tokyo is the capital of Japan with advanced infrastructure.',
              content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tokyo' } }
            });
          }
        };
      }
      throw new Error(`Unexpected URL ${u}`);
    };

    const result = await runStoryEnrichment(
      'Tokyo 2100',
      { generation: { enrichment_provider: 'firecrawl', enrichment_fallback_provider: 'wikipedia', max_context_items: 3 } },
      { fetchTimeoutMs: 5000 },
      { fetchImpl }
    );

    expect(result.selectedProvider).toBe('firecrawl');
    expect(result.usedProvider).toBe('wikipedia');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('uses fallback DQL query variants for driftbot enrichment', async () => {
    const prev = process.env.DRIFTBOT_API_KEY;
    process.env.DRIFTBOT_API_KEY = 'test-driftbot-key';
    try {
      const requests = [];
      const fetchImpl = async (url) => {
        const u = String(url || '');
        requests.push(u);
        if (u.includes('strict%3Aname')) {
          return {
            ok: false,
            status: 400,
            async text() { return '{"message":"bad dql"}'; }
          };
        }
        if (u.includes('name%3A%22Tokyo%22')) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                data: [
                  {
                    name: 'Tokyo',
                    description: 'Tokyo is a major city with advanced infrastructure.',
                    diffbotUri: 'http://diffbot.com/entity/Tokyo'
                  }
                ]
              });
            }
          };
        }
        return {
          ok: true,
          status: 200,
          async text() { return '{"data":[]}'; }
        };
      };

      const result = await runStoryEnrichment(
        'Tokyo 2100',
        { generation: { enrichment_provider: 'driftbot', enrichment_fallback_provider: 'wikipedia', max_context_items: 3 } },
        { fetchTimeoutMs: 5000 },
        { fetchImpl }
      );

      expect(result.selectedProvider).toBe('driftbot');
      expect(result.usedProvider).toBe('driftbot');
      expect(result.items.length).toBeGreaterThan(0);
      expect(requests.some((u) => u.includes('strict%3Aname'))).toBe(true);
      expect(requests.some((u) => u.includes('name%3A%22Tokyo%22'))).toBe(true);
    } finally {
      if (prev == null) delete process.env.DRIFTBOT_API_KEY;
      else process.env.DRIFTBOT_API_KEY = prev;
    }
  });
});
