const OPTION_MAP = {
  'generation.panel_count': ['3', '4', '5', '6', '8', '10', '12'],
  'generation.objective': [
    'summarize',
    'fun',
    'learn-step-by-step',
    'news-recap',
    'timeline',
    'key-facts',
    'compare-views',
    'explain-like-im-five',
    'study-guide',
    'meeting-recap',
    'how-to-guide',
    'debate-map'
  ],
  'generation.output_language': ['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'he'],
  'generation.consistency': ['off', 'on'],
  'generation.invent_temperature': ['0.3', '0.5', '0.7', '0.95', '1.2', '1.5'],
  'generation.delivery_mode': ['default', 'media_group', 'single'],
  'generation.detail_level': ['low', 'medium', 'high'],
  'providers.text.provider': ['gemini', 'openai', 'openrouter', 'cloudflare', 'huggingface'],
  'providers.image.provider': ['gemini', 'openai', 'openrouter', 'cloudflare', 'huggingface'],
  'providers.text.model': [
    'gemini-2.5-flash',
    'gpt-4o-mini',
    'openai/gpt-oss-20b:free',
    '@cf/meta/llama-3.1-8b-instruct',
    'mistralai/Mistral-7B-Instruct-v0.2'
  ],
  'providers.image.model': [
    'gemini-2.0-flash-exp-image-generation',
    'dall-e-2',
    'google/gemini-2.5-flash-image-preview',
    '@cf/black-forest-labs/flux-1-schnell',
    'black-forest-labs/FLUX.1-schnell'
  ],
  'runtime.image_concurrency': ['1', '2', '3', '4', '5'],
  'runtime.timeout_ms': ['45000', '90000', '120000', '180000'],
  'runtime.retries': ['0', '1', '2', '3'],
  'output.width': ['1024', '1200', '1400', '1600'],
  'output.panel_height': ['560', '620', '700', '760'],
  'output.caption_height': ['90', '110', '120', '140'],
  'output.padding': ['16', '20', '24', '28'],
  'output.gap': ['10', '14', '16', '20']
};

const SECRET_KEYS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'HUGGINGFACE_INFERENCE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
];

function getOptions(pathKey) {
  return OPTION_MAP[String(pathKey || '')] || [];
}

function allOptionPaths() {
  return Object.keys(OPTION_MAP);
}

function parseUserValue(pathKey, raw) {
  const key = String(pathKey || '');
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/panel_count|_concurrency|retries|output\.width|panel_height|caption_height|timeout_ms|padding|gap|header_height|footer_height/.test(key)) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`Expected integer for ${key}`);
    return n;
  }
  if (/invent_temperature/.test(key)) {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) throw new Error(`Expected number for ${key}`);
    return n;
  }
  if (/generation\.consistency|generation\.panel_watermark/.test(key)) {
    const low = v.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(low)) return true;
    if (['0', 'false', 'no', 'off'].includes(low)) return false;
    throw new Error(`Expected boolean on/off for ${key}`);
  }
  return v;
}

function formatOptionsMessage(pathKey, current) {
  const options = getOptions(pathKey);
  if (!options.length) {
    return `No predefined options for \`${pathKey}\`. Current: \`${String(current)}\`\nUse a dedicated command (for example /objective, /panels, /mode, /vendor, /models).`;
  }
  const lines = [`Options for \`${pathKey}\``, `Current: \`${String(current)}\``, ''];
  options.forEach((opt, idx) => {
    const mark = String(opt) === String(current) ? ' (current)' : '';
    lines.push(`${idx + 1}. ${opt}${mark}`);
  });
  lines.push('');
  lines.push('Set with the dedicated command for this path.');
  return lines.join('\n');
}

module.exports = {
  SECRET_KEYS,
  getOptions,
  allOptionPaths,
  parseUserValue,
  formatOptionsMessage
};
