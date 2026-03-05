const { OBJECTIVE_VALUES } = require('./styles-objectives');
const { PROVIDER_NAMES, PROVIDER_DEFAULT_MODELS } = require('./providers');

const OPTION_MAP = {
  'generation.panel_count': ['3', '4', '5', '6', '8', '10', '12'],
  'generation.objective': OBJECTIVE_VALUES.slice(),
  'generation.output_language': ['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'he'],
  'generation.consistency': ['off', 'on'],
  'generation.invent_temperature': ['0.3', '0.5', '0.7', '0.95', '1.2', '1.5'],
  'generation.delivery_mode': ['default', 'media_group', 'single'],
  'generation.detail_level': ['low', 'medium', 'high'],
  'providers.text.provider': PROVIDER_NAMES.slice(),
  'providers.image.provider': PROVIDER_NAMES.slice(),
  'providers.text.model': PROVIDER_NAMES.map((name) => PROVIDER_DEFAULT_MODELS[name].text),
  'providers.image.model': PROVIDER_NAMES.map((name) => PROVIDER_DEFAULT_MODELS[name].image),
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

module.exports = {
  OPTION_MAP,
  SECRET_KEYS
};
