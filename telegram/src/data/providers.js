const PROVIDER_DEFAULT_MODELS = {
  gemini: {
    text: 'gemini-2.5-flash',
    image: 'gemini-2.0-flash-exp-image-generation'
  },
  openai: {
    text: 'gpt-4o-mini',
    image: 'gpt-image-1'
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
  },
  groq: {
    text: 'llama-3.3-70b-versatile',
    image: ''
  },
  cohere: {
    text: 'command-r-plus',
    image: ''
  }
};

const PROVIDER_MODEL_CATALOG = {
  gemini: {
    text: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    image: ['gemini-2.0-flash-exp-image-generation', 'gemini-2.5-flash-image']
  },
  openai: {
    text: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
    image: ['gpt-image-1', 'dall-e-3', 'dall-e-2']
  },
  openrouter: {
    text: ['openai/gpt-oss-20b:free', 'meta-llama/llama-3.1-8b-instruct:free'],
    image: ['google/gemini-2.5-flash-image-preview', 'black-forest-labs/flux-1-schnell']
  },
  cloudflare: {
    text: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    image: ['@cf/black-forest-labs/flux-1-schnell', '@cf/stabilityai/stable-diffusion-xl-base-1.0']
  },
  huggingface: {
    text: ['mistralai/Mistral-7B-Instruct-v0.2', 'meta-llama/Llama-3.1-8B-Instruct'],
    image: ['black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-xl-base-1.0']
  },
  groq: {
    text: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    image: []
  },
  cohere: {
    text: ['command-r-plus', 'command-r'],
    image: []
  }
};

const PROVIDER_REQUIRED_KEYS = {
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  huggingface: ['HUGGINGFACE_INFERENCE_API_TOKEN']
  ,
  groq: ['GROQ_API_KEY'],
  cohere: ['COHERE_API_KEY']
};

const PROVIDER_TEXT_NAMES = Object.keys(PROVIDER_MODEL_CATALOG)
  .filter((name) => Array.isArray(PROVIDER_MODEL_CATALOG[name]?.text) && PROVIDER_MODEL_CATALOG[name].text.length > 0);
const PROVIDER_IMAGE_NAMES = Object.keys(PROVIDER_MODEL_CATALOG)
  .filter((name) => Array.isArray(PROVIDER_MODEL_CATALOG[name]?.image) && PROVIDER_MODEL_CATALOG[name].image.length > 0);
const PROVIDER_NAMES = PROVIDER_TEXT_NAMES.filter((name) => PROVIDER_IMAGE_NAMES.includes(name));

module.exports = {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_MODEL_CATALOG,
  PROVIDER_REQUIRED_KEYS,
  PROVIDER_TEXT_NAMES,
  PROVIDER_IMAGE_NAMES,
  PROVIDER_NAMES
};
