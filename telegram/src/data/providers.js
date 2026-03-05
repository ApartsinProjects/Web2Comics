const PROVIDER_DEFAULT_MODELS = {
  gemini: {
    text: 'gemini-2.5-flash',
    image: 'gemini-2.0-flash-exp-image-generation'
  },
  openai: {
    text: 'gpt-4o-mini',
    image: 'dall-e-2'
  },
  openrouter: {
    text: 'openai/gpt-oss-20b:free',
    image: 'google/gemini-2.5-flash-image-preview'
  },
  cloudflare: {
    text: '@cf/meta/llama-3.1-8b-instruct',
    image: '@cf/black-forest-labs/flux-1-schnell'
  },
  huggingface: {
    text: 'mistralai/Mistral-7B-Instruct-v0.2',
    image: 'black-forest-labs/FLUX.1-schnell'
  }
};

const PROVIDER_MODEL_CATALOG = {
  gemini: {
    text: ['gemini-2.5-flash'],
    image: ['gemini-2.0-flash-exp-image-generation']
  },
  openai: {
    text: ['gpt-4o-mini'],
    image: ['dall-e-2']
  },
  openrouter: {
    text: ['openai/gpt-oss-20b:free'],
    image: ['google/gemini-2.5-flash-image-preview']
  },
  cloudflare: {
    text: ['@cf/meta/llama-3.1-8b-instruct'],
    image: ['@cf/black-forest-labs/flux-1-schnell']
  },
  huggingface: {
    text: ['mistralai/Mistral-7B-Instruct-v0.2'],
    image: ['black-forest-labs/FLUX.1-schnell']
  }
};

const PROVIDER_REQUIRED_KEYS = {
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  huggingface: ['HUGGINGFACE_INFERENCE_API_TOKEN']
};

const PROVIDER_NAMES = Object.keys(PROVIDER_DEFAULT_MODELS);

module.exports = {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_MODEL_CATALOG,
  PROVIDER_REQUIRED_KEYS,
  PROVIDER_NAMES
};
