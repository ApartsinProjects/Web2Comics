const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

function loadGenerateWithStubs(stubs = {}) {
  const generatePath = path.resolve(__dirname, '../src/generate.js');
  const providersPath = path.resolve(__dirname, '../../engine/src/providers.js');
  const engineIndexPath = path.resolve(__dirname, '../../engine/src/index.js');

  const providers = require(providersPath);
  const engineIndex = require(engineIndexPath);

  const original = {
    generateTextWithProvider: providers.generateTextWithProvider,
    runComicEnginePanels: engineIndex.runComicEnginePanels
  };

  if (typeof stubs.generateTextWithProvider === 'function') {
    providers.generateTextWithProvider = stubs.generateTextWithProvider;
  }
  if (typeof stubs.runComicEnginePanels === 'function') {
    engineIndex.runComicEnginePanels = stubs.runComicEnginePanels;
  }

  delete require.cache[generatePath];
  const generate = require(generatePath);

  return {
    generate,
    restore() {
      providers.generateTextWithProvider = original.generateTextWithProvider;
      engineIndex.runComicEnginePanels = original.runComicEnginePanels;
      delete require.cache[generatePath];
    }
  };
}

describe('provider/model switching is respected in generation flows', () => {
  it('uses configured text provider+model for inventStoryText', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-provider-switch-invent-'));
    const cfgPath = path.join(tmp, 'cfg.yml');
    fs.writeFileSync(cfgPath, yaml.dump({
      generation: {
        objective: 'fun',
        style_prompt: 'retro manga',
        output_language: 'en',
        invent_temperature: 1.3
      },
      runtime: { retries: 0, timeout_ms: 2000 },
      providers: {
        text: { provider: 'openrouter', model: 'openai/gpt-oss-20b:free' },
        image: { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' }
      }
    }), 'utf8');

    let capturedProvider = null;
    let capturedRuntime = null;
    const { generate, restore } = loadGenerateWithStubs({
      generateTextWithProvider: async (providerConfig, _prompt, runtimeConfig) => {
        capturedProvider = providerConfig;
        capturedRuntime = runtimeConfig;
        return 'Invented story output';
      }
    });

    const previousFake = process.env.RENDER_BOT_FAKE_GENERATOR;
    delete process.env.RENDER_BOT_FAKE_GENERATOR;
    try {
      const out = await generate.inventStoryText('seed', cfgPath);
      expect(out).toContain('Invented story output');
      expect(String(capturedProvider?.provider || '')).toBe('openrouter');
      expect(String(capturedProvider?.model || '')).toBe('openai/gpt-oss-20b:free');
      expect(Number(capturedRuntime?.text_temperature || 0)).toBeCloseTo(1.3, 6);
    } finally {
      if (previousFake == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previousFake;
      restore();
    }
  });

  it('uses configured providers/models in panel generation flow', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-provider-switch-panels-'));
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const cfgPath = path.join(tmp, 'cfg.yml');
    fs.writeFileSync(cfgPath, yaml.dump({
      generation: {
        panel_count: 2,
        objective: 'summarize',
        output_language: 'en',
        style_prompt: 'bold inks',
        panel_watermark: false
      },
      runtime: { retries: 0, timeout_ms: 2000, image_concurrency: 1 },
      providers: {
        text: { provider: 'cloudflare', model: '@cf/meta/llama-3.1-8b-instruct' },
        image: { provider: 'openai', model: 'dall-e-2' }
      }
    }), 'utf8');

    let capturedTextProvider = '';
    let capturedTextModel = '';
    let capturedImageProvider = '';
    let capturedImageModel = '';

    const { generate, restore } = loadGenerateWithStubs({
      runComicEnginePanels: async ({ configPath }) => {
        const cfg = yaml.load(fs.readFileSync(configPath, 'utf8'));
        capturedTextProvider = String(cfg?.providers?.text?.provider || '');
        capturedTextModel = String(cfg?.providers?.text?.model || '');
        capturedImageProvider = String(cfg?.providers?.image?.provider || '');
        capturedImageModel = String(cfg?.providers?.image?.model || '');
        return {
          elapsedMs: 1,
          storyboard: {
            panels: [
              { caption: 'p1', beat: '', image_prompt: 'scene 1' },
              { caption: 'p2', beat: '', image_prompt: 'scene 2' }
            ]
          },
          consistency: { enabled: false, used: false, reason: 'disabled' },
          consistencyReferenceImage: null,
          panelImages: []
        };
      }
    });

    const previousFake = process.env.RENDER_BOT_FAKE_GENERATOR;
    delete process.env.RENDER_BOT_FAKE_GENERATOR;
    try {
      const result = await generate.generatePanelsWithRuntimeConfig(
        'Simple input text',
        { repoRoot: process.cwd(), outDir, fetchTimeoutMs: 10000, debugArtifacts: false },
        cfgPath,
        {
          userId: 777,
          generationId: 'provider-switch-test',
          onPanelReady: async () => {}
        }
      );
      expect(result.panelCount).toBe(2);
      expect(capturedTextProvider).toBe('cloudflare');
      expect(capturedTextModel).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(capturedImageProvider).toBe('openai');
      expect(capturedImageModel).toBe('dall-e-2');
    } finally {
      if (previousFake == null) delete process.env.RENDER_BOT_FAKE_GENERATOR;
      else process.env.RENDER_BOT_FAKE_GENERATOR = previousFake;
      restore();
    }
  });
});
