const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const yaml = require('js-yaml');
const { generateWithRuntimeConfig } = require('../src/generate');
const { loadEnvFiles } = require('../src/env');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, 'telegram/.env')
]);

const runRealGemini = String(process.env.RUN_RENDER_REAL_GEMINI || '') === '1'
  && String(process.env.GEMINI_API_KEY || '').trim().length > 0;

describe('render real gemini e2e', () => {
  const testOrSkip = runRealGemini ? it : it.skip;

  function createLocalHtmlServer(html) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve({
          url: `http://127.0.0.1:${addr.port}/`,
          close: () => new Promise((r) => server.close(r))
        });
      });
    });
  }

  testOrSkip('generates a real comic image from text', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-gemini-e2e-'));
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });

    const cfgPath = path.join(tmp, 'config.yml');
    const cfg = {
      generation: {
        panel_count: 2,
        objective: 'summarize',
        output_language: 'en',
        detail_level: 'low',
        style_prompt: 'clean comic panel art, readable text and characters'
      },
      providers: {
        text: {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          api_key_env: 'GEMINI_API_KEY'
        },
        image: {
          provider: 'gemini',
          model: 'gemini-2.5-flash-image',
          api_key_env: 'GEMINI_API_KEY'
        }
      },
      runtime: {
        timeout_ms: 180000,
        image_concurrency: 1,
        retries: 1
      },
      output: {
        width: 900,
        panel_height: 450
      }
    };
    fs.writeFileSync(cfgPath, yaml.dump(cfg), 'utf8');

    const result = await generateWithRuntimeConfig(
      'A short story about a developer fixing a production bug and writing tests to prevent regressions.',
      {
        repoRoot,
        outDir,
        fetchTimeoutMs: 45000,
        debugArtifacts: false
      },
      cfgPath
    );

    expect(result.outputPath.endsWith('.png')).toBe(true);
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(fs.statSync(result.outputPath).size).toBeGreaterThan(1024);
    expect(result.panelCount).toBe(2);
  }, 300000);

  testOrSkip('generates a real comic image from URL input', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-gemini-e2e-url-'));
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });

    const cfgPath = path.join(tmp, 'config.yml');
    const cfg = {
      generation: {
        panel_count: 2,
        objective: 'summarize',
        output_language: 'en',
        detail_level: 'low',
        style_prompt: 'clean comic panel art'
      },
      providers: {
        text: {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          api_key_env: 'GEMINI_API_KEY'
        },
        image: {
          provider: 'gemini',
          model: 'gemini-2.5-flash-image',
          api_key_env: 'GEMINI_API_KEY'
        }
      },
      runtime: {
        timeout_ms: 180000,
        image_concurrency: 1,
        retries: 1
      },
      output: {
        width: 900,
        panel_height: 450
      }
    };
    fs.writeFileSync(cfgPath, yaml.dump(cfg), 'utf8');

    const local = await createLocalHtmlServer('<html><body><h1>Tiny URL story page</h1><p>A fox finds a map and follows clues.</p></body></html>');
    let result;
    try {
      result = await generateWithRuntimeConfig(
        local.url,
        {
          repoRoot,
          outDir,
          fetchTimeoutMs: 45000,
          debugArtifacts: false
        },
        cfgPath
      );
    } finally {
      await local.close();
    }

    expect(result.kind).toBe('url');
    expect(result.outputPath.endsWith('.png')).toBe(true);
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(fs.statSync(result.outputPath).size).toBeGreaterThan(1024);
  }, 300000);
});
