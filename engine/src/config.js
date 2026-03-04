const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_CONFIG = {
  input: {
    format: 'auto',
    max_chars: 12000,
    strip_selectors: ['script', 'style', 'noscript', 'svg', 'canvas', 'nav', 'footer', 'aside']
  },
  generation: {
    panel_count: 3,
    objective: 'summarize',
    output_language: 'en',
    detail_level: 'low',
    style_prompt: 'classic comic illustration, readable characters, clear scene composition'
  },
  providers: {
    text: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      api_key_env: 'GEMINI_API_KEY'
    },
    image: {
      provider: 'gemini',
      model: 'gemini-2.0-flash-exp-image-generation',
      api_key_env: 'GEMINI_API_KEY'
    }
  },
  runtime: {
    timeout_ms: 120000,
    image_concurrency: 3,
    retries: 1
  },
  output: {
    width: 1400,
    panel_height: 720,
    caption_height: 120,
    padding: 24,
    gap: 16,
    header_height: 120,
    footer_height: 34,
    background: '#f8fafc',
    brand: 'Made with Web2Comics Engine'
  }
};

function deepMerge(base, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return base;
  const out = { ...base };
  Object.keys(incoming).forEach((key) => {
    const next = incoming[key];
    const prev = out[key];
    if (Array.isArray(next)) {
      out[key] = next.slice();
      return;
    }
    if (next && typeof next === 'object' && prev && typeof prev === 'object' && !Array.isArray(prev)) {
      out[key] = deepMerge(prev, next);
      return;
    }
    out[key] = next;
  });
  return out;
}

function ensureInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  const lo = Number.isFinite(min) ? min : n;
  const hi = Number.isFinite(max) ? max : n;
  return Math.min(hi, Math.max(lo, n));
}

function normalizeConfig(rawConfig) {
  const merged = deepMerge(DEFAULT_CONFIG, rawConfig || {});
  merged.generation.panel_count = ensureInt(merged.generation.panel_count, 3, 1, 20);
  merged.input.max_chars = ensureInt(merged.input.max_chars, 12000, 200, 200000);
  merged.runtime.timeout_ms = ensureInt(merged.runtime.timeout_ms, 120000, 5000, 300000);
  merged.runtime.image_concurrency = ensureInt(merged.runtime.image_concurrency, 3, 1, 8);
  merged.runtime.retries = ensureInt(merged.runtime.retries, 1, 0, 5);

  merged.output.width = ensureInt(merged.output.width, 1400, 600, 4096);
  merged.output.panel_height = ensureInt(merged.output.panel_height, 720, 180, 2500);
  merged.output.caption_height = ensureInt(merged.output.caption_height, 120, 60, 500);
  merged.output.padding = ensureInt(merged.output.padding, 24, 8, 200);
  merged.output.gap = ensureInt(merged.output.gap, 16, 0, 200);
  merged.output.header_height = ensureInt(merged.output.header_height, 120, 60, 500);
  merged.output.footer_height = ensureInt(merged.output.footer_height, 24, 0, 240);

  merged.providers = merged.providers || {};
  merged.providers.text = merged.providers.text || {};
  merged.providers.image = merged.providers.image || {};
  merged.providers.text.provider = String(merged.providers.text.provider || '').trim().toLowerCase();
  merged.providers.image.provider = String(merged.providers.image.provider || '').trim().toLowerCase();

  if (!merged.providers.text.provider) {
    throw new Error('Missing providers.text.provider in config');
  }
  if (!merged.providers.image.provider) {
    throw new Error('Missing providers.image.provider in config');
  }

  return merged;
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = yaml.load(raw) || {};
  return {
    path: resolved,
    config: normalizeConfig(parsed)
  };
}

module.exports = {
  DEFAULT_CONFIG,
  deepMerge,
  normalizeConfig,
  loadConfig
};
