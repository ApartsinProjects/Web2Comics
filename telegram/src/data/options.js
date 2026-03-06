const { OBJECTIVE_VALUES } = require('./styles-objectives');
const {
  PROVIDER_NAMES,
  PROVIDER_TEXT_NAMES,
  PROVIDER_IMAGE_NAMES,
  PROVIDER_MODEL_CATALOG
} = require('./providers');

function collectProviderModels(kind) {
  const out = new Set();
  const section = String(kind || '').trim().toLowerCase();
  Object.keys(PROVIDER_MODEL_CATALOG || {}).forEach((provider) => {
    const values = Array.isArray(PROVIDER_MODEL_CATALOG?.[provider]?.[section])
      ? PROVIDER_MODEL_CATALOG[provider][section]
      : [];
    values.forEach((v) => {
      const text = String(v || '').trim();
      if (text) out.add(text);
    });
  });
  return Array.from(out);
}

const OPTION_MAP = {
  'generation.panel_count': ['3', '4', '5', '6', '8', '10', '12'],
  'generation.objective': OBJECTIVE_VALUES.slice(),
  'generation.output_language': ['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'he'],
  'generation.url_extractor': ['gemini', 'firecrawl', 'jina', 'diffbot', 'driftbot', 'chromium'],
  'generation.url_extractor_gemini_model': ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  'generation.pdf_extractor': ['llamaparse', 'unstructured'],
  'generation.pdf_extractor_unstructured_strategy': ['auto', 'hi_res', 'ocr_only', 'fast'],
  'generation.image_extractor': ['gemini', 'openai'],
  'generation.image_extractor_gemini_model': ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  'generation.image_extractor_openai_model': ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'],
  'generation.voice_extractor': ['assemblyai'],
  'generation.voice_extractor_assemblyai_model': ['best', 'nano'],
  'generation.auto_enrich_short_story_prompts': ['on', 'off'],
  'generation.short_prompt_word_threshold': ['6', '8', '10', '12'],
  'generation.enrichment_provider': ['wikipedia', 'wikidata', 'dbpedia', 'gdelt', 'googlekg', 'jina', 'firecrawl', 'diffbot', 'driftbot', 'gemini', 'brave', 'tavily', 'exa', 'serper', 'serpapi'],
  'generation.enrichment_fallback_provider': ['wikipedia', 'wikidata', 'dbpedia', 'gdelt', 'googlekg', 'jina', 'firecrawl', 'diffbot', 'driftbot', 'gemini', 'brave', 'tavily', 'exa', 'serper', 'serpapi'],
  'generation.max_context_items': ['3', '5', '7', '10'],
  'generation.max_enrichment_chars': ['500', '800', '1200', '2000'],
  'generation.include_sources': ['on', 'off'],
  'generation.consistency': ['off', 'on'],
  'generation.invent_temperature': ['0.3', '0.5', '0.7', '0.95', '1.2', '1.5'],
  'generation.delivery_mode': ['default', 'media_group', 'single'],
  'generation.detail_level': ['low', 'medium', 'high'],
  'providers.text.provider': PROVIDER_TEXT_NAMES.slice(),
  'providers.image.provider': PROVIDER_IMAGE_NAMES.slice(),
  'providers.text.model': collectProviderModels('text'),
  'providers.image.model': collectProviderModels('image'),
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
  'CLOUDFLARE_API_TOKEN',
  'FIRECRAWL_API_KEY',
  'JINA_API_KEY',
  'DRIFTBOT_API_KEY',
  'DIFFBOT_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'TAVILY_API_KEY',
  'EXA_API_KEY',
  'SERPER_API_KEY',
  'SERPAPI_API_KEY',
  'GOOGLE_KG_API_KEY',
  'LLAMA_CLOUD_API_KEY',
  'UNSTRUCTURED_API_KEY',
  'ASSEMBLYAI_API_KEY'
  ,
  'GROQ_API_KEY',
  'COHERE_API_KEY'
];

module.exports = {
  OPTION_MAP,
  SECRET_KEYS
};
