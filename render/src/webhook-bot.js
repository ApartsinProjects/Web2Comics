const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnvFiles } = require('./env');
const { TelegramApi } = require('./telegram-api');
const { RuntimeConfigStore } = require('./config-store');
const { allOptionPaths, getOptions, parseUserValue, formatOptionsMessage, SECRET_KEYS } = require('./options');
const { generatePanelsWithRuntimeConfig, inventStoryText } = require('./generate');
const { createPersistence } = require('./persistence');
const { redactSensitiveText } = require('./redact');
const { createCrashLogStoreFromEnv, FileCrashLogStore } = require('./crash-log-store');
const { createRequestLogStoreFromEnv } = require('./request-log-store');
const {
  classifyMessageInput,
  isLikelyWebPageUrl,
  extractTextFallbackFromUrlMessage,
  inferLikelyWebUrlFromText
} = require('./message-utils');
const { composeComicSheet } = require('../../engine/src/compose');
const packageJson = require('../../package.json');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, 'comicbot/.env'),
  path.join(repoRoot, 'render/.env')
]);

const runtime = {
  repoRoot,
  outDir: path.resolve(process.env.RENDER_BOT_OUT_DIR || path.join(repoRoot, 'render/out')),
  imageStatusFile: path.resolve(process.env.RENDER_BOT_IMAGE_STATUS_FILE || path.join(repoRoot, 'render/out/image-storage-status.json')),
  imageCapacityBytes: Math.max(1, Number(process.env.RENDER_BOT_IMAGE_CAPACITY_BYTES || (4 * 1024 * 1024 * 1024))),
  imageCleanupThresholdRatio: Math.max(0.01, Math.min(1, Number(process.env.RENDER_BOT_IMAGE_CLEANUP_THRESHOLD_RATIO || 0.5))),
  r2Endpoint: String(process.env.R2_S3_ENDPOINT || '').trim(),
  r2Bucket: String(process.env.R2_BUCKET || '').trim(),
  r2AccessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
  r2SecretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim(),
  r2ImagePrefix: String(process.env.R2_IMAGE_PREFIX || 'images').trim(),
  r2ImageStatusKey: String(process.env.R2_IMAGE_STATUS_KEY || 'status/image-storage-status.json').trim(),
  fetchTimeoutMs: Math.max(5000, Number(process.env.RENDER_BOT_FETCH_TIMEOUT_MS || 45000)),
  debugArtifacts: String(process.env.RENDER_BOT_DEBUG_ARTIFACTS || '').toLowerCase() === 'true',
  allowedChatIds: String(process.env.COMICBOT_ALLOWED_CHAT_IDS || '')
    .split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n))
};
const notifyOnStart = String(process.env.TELEGRAM_NOTIFY_ON_START || '').trim().toLowerCase() === 'true';
const notifyChatId = Number(process.env.TELEGRAM_NOTIFY_CHAT_ID || 0);
const adminChatIds = String(process.env.TELEGRAM_ADMIN_CHAT_IDS || '1796415913')
  .split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
if (Number.isFinite(notifyChatId) && notifyChatId > 0 && !adminChatIds.includes(notifyChatId)) {
  adminChatIds.push(notifyChatId);
}

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

const api = new TelegramApi(token, process.env.TELEGRAM_API_BASE_URL || '');
let configStore = null;
let requestLogStore = null;
let requestLogStoreMode = 'unknown';
const rawSendMessage = api.sendMessage.bind(api);
const jobTimeoutMs = Math.max(100, Number(process.env.RENDER_BOT_JOB_TIMEOUT_MS || 300000));
const processedUpdates = new Map();
const processedUpdatesTtlMs = Math.max(60000, Number(process.env.RENDER_BOT_UPDATE_TTL_MS || 900000));
let crashStore;
let crashStoreMode = 'unknown';
const BOT_DISPLAY_NAME = 'Web2Comic';
const BOT_SHORT_DESCRIPTION = 'AI comic maker from text or URL.';
const BOT_PROCESS_START_TIME = new Date().toISOString();
const BOT_TEST_MODE = String(process.env.RENDER_BOT_TEST_MODE || process.env.RENDER_BOT_FAKE_GENERATOR || '')
  .trim()
  .toLowerCase() === 'true';
const BOT_RAW_VERSION = String(packageJson && packageJson.version ? packageJson.version : '0.0.0');
const BOT_VERSION = (() => {
  const m = BOT_RAW_VERSION.match(/^(\d+)\.(\d+)/);
  if (!m) return BOT_RAW_VERSION;
  return `${m[1]}.${m[2]}`;
})();

try {
  const selected = createCrashLogStoreFromEnv();
  crashStore = selected.impl;
  crashStoreMode = selected.mode;
} catch (error) {
  console.error('[render-bot] crash store init failed, falling back to file mode:', error && error.message ? error.message : String(error));
  crashStore = new FileCrashLogStore({
    logsDir: process.env.RENDER_BOT_CRASH_LOG_DIR || 'render/data/crash-logs',
    latestPath: process.env.RENDER_BOT_CRASH_LOG_LATEST || 'render/data/crash-logs/latest.json'
  });
  crashStoreMode = 'file-fallback';
}

function normalizeErrorPayload(errorLike) {
  if (!errorLike) return { message: '' };
  if (errorLike instanceof Error) {
    return {
      name: String(errorLike.name || 'Error'),
      message: String(errorLike.message || ''),
      stack: String(errorLike.stack || '')
    };
  }
  return {
    message: String(errorLike),
    stack: ''
  };
}

async function persistCrash(event, errorLike, context = {}) {
  if (!crashStore || typeof crashStore.appendCrash !== 'function') return;
  const error = normalizeErrorPayload(errorLike);
  const payload = {
    event: String(event || 'unknown'),
    pid: process.pid,
    crashStoreMode,
    node: process.version,
    timestamp: new Date().toISOString(),
    error,
    context: context || {}
  };
  try {
    await crashStore.appendCrash(payload);
  } catch (persistError) {
    console.error('[render-bot] failed to persist crash log:', persistError && persistError.message ? persistError.message : String(persistError));
  }
}

function collectSensitiveValues(chatId) {
  const keys = new Set([
    ...SECRET_KEYS,
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'DATABASE_URL',
    'RENDER_BOT_PG_URL'
  ]);
  const values = [];
  keys.forEach((k) => {
    const envVal = String(process.env[k] || '').trim();
    if (envVal) values.push(envVal);
  });

  if (configStore && configStore.state && configStore.state.users) {
    const key = configStore.normalizeUserKey(chatId);
    const user = configStore.state.users[key];
    Object.values((user && user.secrets) || {}).forEach((v) => {
      const secretVal = String(v || '').trim();
      if (secretVal) values.push(secretVal);
    });
  }

  return values;
}

api.sendMessage = async (chatId, text, extra) => {
  const redacted = redactSensitiveText(text, collectSensitiveValues(chatId));
  return rawSendMessage(chatId, redacted, extra);
};

async function safeNotifyUser(chatId, text) {
  if (!chatId || !text) return;
  try {
    await api.sendMessage(chatId, text);
  } catch (error) {
    console.error('[render-bot] failed to notify user:', error && error.message ? error.message : String(error));
  }
}

function normalizeUpdateSource(update, message) {
  const raw = String(update?.source || message?.source || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'test') return 'test';
  return raw;
}

async function safeRecordInteraction(chatId, payload, userMeta = {}) {
  try {
    const requestPayload = payload || {};
    const metadata = {
      request: {
        kind: String(requestPayload.kind || ''),
        command: String(requestPayload.command || ''),
        text: String(requestPayload.requestText || '')
      },
      configuration: requestPayload.config || {},
      storyboard: (requestPayload.result && requestPayload.result.storyboard) || null
    };
    const tasks = [
      configStore.recordInteraction(chatId, payload)
    ];
    if (requestLogStore && typeof requestLogStore.append === 'function') {
      tasks.push(requestLogStore.append({
        chatId: Number(chatId || 0),
        user: {
          id: Number(userMeta?.id || chatId || 0),
          username: String(userMeta?.username || '').trim()
        },
        ...requestPayload,
        metadata
      }));
    }
    await Promise.allSettled(tasks);
  } catch (error) {
    console.error('[render-bot] recordInteraction failed:', error && error.message ? error.message : String(error));
  }
}

function runBackgroundTask(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((error) => {
      console.error(`[render-bot] ${label} failed:`, error && error.message ? error.message : String(error));
    });
}

async function notifyDeploymentReady() {
  if (!notifyOnStart || !Number.isFinite(notifyChatId) || notifyChatId <= 0) return;
  const stamp = new Date().toISOString();
  const version = String(process.env.RENDER_GIT_COMMIT || process.env.RENDER_GIT_BRANCH || '').trim();
  const versionLine = version ? `Version: ${version}` : '';
  const lines = [
    `${BOT_DISPLAY_NAME} bot: new version is ready.`,
    `Time: ${stamp}`
  ];
  if (versionLine) lines.push(versionLine);
  await safeNotifyUser(notifyChatId, lines.join('\n'));
}

async function seedAdminRuntimeSecretsFromEnv() {
  if (!configStore || typeof configStore.ensureUser !== 'function') return;
  const adminId = Number((adminChatIds || [])[0] || 0);
  if (!Number.isFinite(adminId) || adminId <= 0) return;
  const user = configStore.ensureUser(adminId);
  if (!user || typeof user !== 'object') return;
  if (!user.secrets || typeof user.secrets !== 'object') user.secrets = {};
  let changed = 0;
  for (const key of SECRET_KEYS) {
    const current = String(user.secrets[key] || '').trim();
    const envVal = String(process.env[key] || '').trim();
    if (!current && envVal) {
      user.secrets[key] = envVal;
      changed += 1;
    }
  }
  if (changed > 0) {
    await configStore.save();
    console.log(`[render-bot] seeded ${changed} provider key(s) into admin runtime profile`);
  }
}

const chatQueues = new Map();

const STYLE_PRESETS = {
  classic: 'clean illustrated art, readable characters, coherent scene progression',
  noir: 'film noir comic style, dramatic shadows, high contrast, moody scenes',
  manga: 'manga-inspired comic art, expressive characters, dynamic framing',
  superhero: 'american superhero comic style, dynamic action poses, bold colors',
  watercolor: 'watercolor comic style, soft painterly textures, warm tones',
  newspaper: 'newspaper comic strip style, clean ink lines, expressive cartooning'
};

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
const PROMPT_MANUAL_URL = 'https://github.com/ApartsinProjects/Web2Comics/blob/engine/render/docs/deployment-runbook.md';

function getMissingProviderKeys(chatId, providerName) {
  const provider = String(providerName || '').trim().toLowerCase();
  const required = PROVIDER_REQUIRED_KEYS[provider] || [];
  if (!required.length) return [];
  const status = configStore.getSecretsStatus(chatId);
  return required.filter((key) => !status[key] || !status[key].hasValue);
}

function providerProvisioningMessage(providerName, missingKeys) {
  const provider = String(providerName || '').trim().toLowerCase();
  const missing = (Array.isArray(missingKeys) ? missingKeys : []).filter(Boolean);
  const keyLabel = missing.join(', ') || 'provider key';
  return [
    `Provider switch blocked: missing ${keyLabel}.`,
    `Provision key(s) first, then retry /vendor ${provider}.`,
    `Manual: ${PROMPT_MANUAL_URL}`
  ].join('\n');
}

function isAllowedChat(chatId) {
  if (isAdminChat(chatId)) return true;
  if (!runtime.allowedChatIds.length) return true;
  return runtime.allowedChatIds.includes(Number(chatId));
}

function splitCommand(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  return parts;
}

function classifyIncoming(text) {
  const t = String(text || '').trim();
  if (!t) return { kind: 'empty', command: '' };
  if (t.startsWith('/')) return { kind: 'command', command: t.split(/\s+/)[0].toLowerCase() };
  if (classifyMessageInput(t).kind === 'url') return { kind: 'url', command: '' };
  return { kind: 'text', command: '' };
}

function extractMessageInputText(message) {
  const textBody = String(message?.text || '').trim();
  const captionBody = String(message?.caption || '').trim();
  const base = (textBody || captionBody).trim();
  const entities = textBody
    ? (Array.isArray(message?.entities) ? message.entities : [])
    : (Array.isArray(message?.caption_entities) ? message.caption_entities : []);
  if (!entities.length) return base;

  const links = [];
  for (const entity of entities) {
    const type = String(entity?.type || '').trim().toLowerCase();
    if (type === 'text_link') {
      const url = String(entity?.url || '').trim();
      if (url) links.push(url);
      continue;
    }
    if (type === 'url') {
      const offset = Number(entity?.offset || 0);
      const length = Number(entity?.length || 0);
      if (Number.isFinite(offset) && Number.isFinite(length) && length > 0 && offset >= 0) {
        const raw = base.slice(offset, offset + length).trim();
        if (raw) links.push(raw);
      }
    }
  }
  if (!links.length) return base;

  const merged = [base, ...links]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return merged || base;
}

function buildTestSourceEchoText(message, incoming) {
  const chatId = Number(message?.chat?.id || 0);
  const userId = Number(message?.from?.id || chatId || 0);
  const username = String(message?.from?.username || message?.chat?.username || '').trim();
  const payload = String(extractMessageInputText(message) || '').trim().slice(0, 1400);
  const kind = String(incoming?.kind || 'text');
  const command = String(incoming?.command || '').trim();
  const lines = [
    '[test-source] incoming message',
    `chat: ${chatId || '-'}`,
    `user: ${userId || '-'}${username ? ` (@${username})` : ''}`,
    `kind: ${kind}${command ? ` ${command}` : ''}`,
    `text: ${payload || '(empty)'}`
  ];
  return lines.join('\n');
}

function formatProviderFallbackMessage(info) {
  const from = String(info?.from || '-/-').trim();
  const to = String(info?.to || 'gemini/gemini').trim();
  const reason = String(info?.reason || 'provider_failure').trim();
  const shortReason = reason === 'missing_credentials' ? 'missing credentials' : 'provider/model failure';
  return `Provider issue detected (${shortReason}). Switched from ${from} to ${to}.`;
}

function isShortTextPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return t.length <= 40 || words.length <= 6;
}

function formatInventedStoryMessage(storyText) {
  const raw = String(storyText || '').trim();
  const maxLen = 3400;
  const body = raw.length > maxLen ? `${raw.slice(0, maxLen)}\n...` : raw;
  return [
    'Invented story (expanded by AI):',
    body || '(no text)'
  ].join('\n');
}

function isAdminChat(chatId) {
  return adminChatIds.includes(Number(chatId));
}

function commandHelp(chatId) {
  const lines = [
    BOT_DISPLAY_NAME,
    BOT_SHORT_DESCRIPTION,
    '',
    'Send plain text or URL to generate a comic.',
    '',
    'Commands:',
    '/start - show welcome message.',
    '/help - show this command reference.',
    '/welcome - show welcome message again.',
    '/about - creator and project links.',
    '/version - bot version and timestamps.',
    '/user - show your Telegram user id.',
    '/config - show your active configuration.',
    '/explain - explain the compact generation summary line.',
    '/debug <on|off> - toggle image prompt debug messages.',
    '/invent <story> - expand your seed story with AI and generate comic.',
    '/random - generate a fully random story and make a comic.',
    '/panels <count> - set panel count.',
    '/objective [name] - list or set objective.',
    '/style <preset-or-your-style> - set visual style.',
    '/new_style <name> <text> - save a custom named style.',
    '/language <code> - set output language.',
    '/mode <default|media_group|single> - set delivery mode.',
    '/consistency <on|off> - toggle reference-style consistency flow.',
    '/crazyness <0..2> - set invention creativity temperature.',
    '/detail <low|medium|high> - set detail level.',
    '/concurrency <1..5> - set image generation parallelism.',
    '/retries <0..3> - set provider retry attempts.',
    '/vendor <name> - set both text and image providers.',
    '/text_vendor <name> - set text provider only.',
    '/image_vendor <name> - set image provider only.',
    '/models [text|image] [model] - list or set models for current vendor.',
    '/keys - show provider key status.',
    '/setkey <KEY> <VALUE> - store runtime credential.',
    '/unsetkey <KEY> - remove runtime credential.',
    '/list_options - list config paths with predefined options.',
    '/options <path> - show options for one path.',
    '/prompts - show active prompt templates.',
    '/set_prompt story <text> - customize story prompt.',
    '/set_prompt panel <text> - customize panel prompt suffix.',
    '/set_prompt objective <name> <text> - customize objective prompt override.',
    '/reset_config - clear your config overrides.',
    '/restart - reset your user state and config to defaults.',
    '',
    'Provider key links (Gemini free first):',
    '- Gemini: https://aistudio.google.com/apikey',
    '- OpenAI: https://platform.openai.com/api-keys',
    '- OpenRouter: https://openrouter.ai/settings/keys',
    '- Cloudflare: https://dash.cloudflare.com/profile/api-tokens',
    '- Hugging Face: https://huggingface.co/settings/tokens',
    '',
    'Docs: https://github.com/ApartsinProjects/Web2Comics/tree/engine/render'
  ];
  if (isAdminChat(chatId)) {
    lines.push('');
    lines.push('Admin commands:');
    lines.push('/peek - list latest generated comics.');
    lines.push('/peek <n> or /peek<n> - show one comic from the latest list.');
    lines.push('/log, /log <n>, /log<n> - list latest interaction logs.');
    lines.push('/users - list known users.');
    lines.push('/ban - list banned users.');
    lines.push('/ban <user_id|username> - ban user.');
    lines.push('/unban <user_id|username> - unban user.');
    lines.push('/share <user_id> - allow a user to use your runtime keys.');
    lines.push('/watermark <on|off> - set global panel watermark.');
    lines.push('/echo <on|off> - test mode input echo.');
  }
  return lines.join('\n');
}

function keysStatusMessage(chatId) {
  const status = configStore.getSecretsStatus(chatId);
  const lines = ['Provider key status:'];
  Object.entries(status).forEach(([k, v]) => {
    lines.push(`- ${k}: ${v.hasValue ? 'set' : 'missing'} (${v.source})`);
  });
  lines.push('');
  lines.push('Set key: /setkey <KEY> <VALUE>');
  return lines.join('\n');
}

function valueExists(options, value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (Array.isArray(options) ? options : []).some((opt) => String(opt).toLowerCase() === normalized);
}

function normalizeStyleName(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeCommandToken(rawToken) {
  const token = String(rawToken || '').trim().toLowerCase();
  return token;
}

function listModelsForProvider(providerName, kind, includeCurrent = '') {
  const provider = String(providerName || '').trim().toLowerCase();
  const section = String(kind || '').trim().toLowerCase();
  const fromCatalog = (((PROVIDER_MODEL_CATALOG[provider] || {})[section]) || []).map((v) => String(v || '').trim()).filter(Boolean);
  const uniq = new Set(fromCatalog);
  const current = String(includeCurrent || '').trim();
  if (current) uniq.add(current);
  return Array.from(uniq);
}

function buildModelsStatusMessage(chatId, target = '') {
  const textProvider = String(configStore.getCurrent(chatId, 'providers.text.provider') || '').trim().toLowerCase();
  const imageProvider = String(configStore.getCurrent(chatId, 'providers.image.provider') || '').trim().toLowerCase();
  const textModel = String(configStore.getCurrent(chatId, 'providers.text.model') || '').trim();
  const imageModel = String(configStore.getCurrent(chatId, 'providers.image.model') || '').trim();

  const lines = [
    'Model selector (current vendor only):',
    `- text: ${textProvider || '-'} / ${textModel || '-'}`,
    `- image: ${imageProvider || '-'} / ${imageModel || '-'}`,
    ''
  ];

  const includeText = !target || target === 'text';
  const includeImage = !target || target === 'image';
  if (includeText) {
    const models = listModelsForProvider(textProvider, 'text', textModel);
    lines.push(`Text models for ${textProvider || '-'}: ${models.length ? models.join(', ') : 'none'}`);
  }
  if (includeImage) {
    const models = listModelsForProvider(imageProvider, 'image', imageModel);
    lines.push(`Image models for ${imageProvider || '-'}: ${models.length ? models.join(', ') : 'none'}`);
  }
  lines.push('');
  lines.push('Usage: /models');
  lines.push('Usage: /models text <model>');
  lines.push('Usage: /models image <model>');
  return lines.join('\n');
}

function setConfigPathValue(chatId, pathKey, rawValue) {
  const parsed = parseUserValue(pathKey, rawValue);
  return configStore.setConfigValue(chatId, pathKey, parsed);
}

async function applyProvider(chatId, providerName, applyText, applyImage) {
  const key = String(providerName || '').trim().toLowerCase();
  const defaults = PROVIDER_DEFAULT_MODELS[key];
  if (!defaults) {
    throw new Error(`Unknown provider '${providerName}'. Use: ${Object.keys(PROVIDER_DEFAULT_MODELS).join(', ')}`);
  }
  if (applyText) {
    await configStore.setConfigValue(chatId, 'providers.text.provider', key);
    await configStore.setConfigValue(chatId, 'providers.text.model', defaults.text);
  }
  if (applyImage) {
    await configStore.setConfigValue(chatId, 'providers.image.provider', key);
    await configStore.setConfigValue(chatId, 'providers.image.model', defaults.image);
  }
  return defaults;
}

function onboardingMessage(chatId) {
  const lines = [
    `Welcome to ${BOT_DISPLAY_NAME}.`,
    BOT_SHORT_DESCRIPTION,
    '',
    'Fastest way to start:',
    '1) Run /user',
    '2) Send your ID to Sasha and ask for shared key access',
    '',
    'Or go solo with a free Gemini key:',
    '1) Get key: https://aistudio.google.com/apikey',
    '2) How-to: https://github.com/ApartsinProjects/Web2Comics/tree/engine/render',
    '3) Set it: /setkey GEMINI_API_KEY <YOUR_KEY>',
    '4) Verify: /keys',
    '',
    'Once connected, useful commands:',
    '/help  /config  /vendor <name>  /panels <count>  /style <preset>'
  ];
  if (isAdminChat(chatId)) {
    lines.push('');
    lines.push('Admin commands:');
    lines.push('/peek  /peek<n>  /log  /log<n>  /users  /ban  /unban  /share <user_id>');
  }
  return lines.join('\n');
}

function formatUsersMessage() {
  const rows = typeof configStore.listKnownUsers === 'function' ? configStore.listKnownUsers() : [];
  if (!rows.length) return 'No known users yet.';
  const lines = [`Known users: ${rows.length}`];
  rows.forEach((r, idx) => {
    const meta = [];
    if (r.username) meta.push(`@${r.username}`);
    if (r.name) meta.push(r.name);
    if (!r.username && r.chatUsername) meta.push(`chat:@${r.chatUsername}`);
    lines.push(`${idx + 1}. ${r.uid} | ${meta.length ? meta.join(' | ') : r.label}`);
  });
  return lines.join('\n');
}

function formatBanlistMessage() {
  const banlist = configStore.getBanlist();
  const ids = Array.isArray(banlist?.ids) ? banlist.ids : [];
  const usernames = Array.isArray(banlist?.usernames) ? banlist.usernames : [];
  if (!ids.length && !usernames.length) return 'Banned users: none.';
  const lines = ['Banned users:'];
  if (ids.length) lines.push(`ids: ${ids.join(', ')}`);
  if (usernames.length) lines.push(`usernames: ${usernames.map((u) => `@${u}`).join(', ')}`);
  return lines.join('\n');
}

function splitMessageBySize(text, maxChars = 3500) {
  const raw = String(text || '');
  if (raw.length <= maxChars) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars);
    if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendLongMessage(chatId, text) {
  const chunks = splitMessageBySize(text, 3500);
  for (const chunk of chunks) {
    if (!chunk) continue;
    await api.sendMessage(chatId, chunk);
  }
}

function buildPromptCatalog(cfg) {
  const objective = String(cfg?.generation?.objective || 'summarize');
  const storyPrompt = [
    'Create a comic storyboard as strict JSON only. No markdown fences.',
    'Schema: {"title":string,"description":string,"panels":[{"caption":string,"image_prompt":string}]}',
    `Panel count: ${cfg?.generation?.panel_count ?? '-'}`,
    `Objective: ${objective}`,
    `Output language: ${cfg?.generation?.output_language || 'en'}`,
    `Visual style: ${cfg?.generation?.style_prompt || '-'}`,
    'Rules:',
    '- Keep captions concise, factual, and sequential.',
    '- Keep each image_prompt visual and concrete for a single panel scene.',
    '- For every image_prompt, explicitly require text-free artwork (no words/letters/numbers/signs/logos/UI text/speech bubbles/watermarks).',
    '- Every image_prompt must avoid panel numbering (for example "Panel 1", "1/8") and must not ask for any text elements to be shown in the image.',
    '- Do not invent facts not present in source text.'
  ];
  const activeObjectiveOverride = String(cfg?.generation?.objective_prompt_overrides?.[objective] || '').trim();
  if (activeObjectiveOverride) {
    storyPrompt.push(`Objective-specific instructions: ${activeObjectiveOverride}`);
  }
  const customStoryPrompt = String(cfg?.generation?.custom_story_prompt || '').trim();
  if (customStoryPrompt) {
    storyPrompt.push(`Custom user story prompt: ${customStoryPrompt}`);
  }
  storyPrompt.push('Source title: <source title>', 'Source label: <source label>', 'Source text:', '<source text>');

  const panelPrompt = [
    'Story title: <storyboard.title>',
    'Story summary: <storyboard.description short summary>',
    'Panel visual brief: <panel.image_prompt>',
    `Style: ${cfg?.generation?.style_prompt || '-'}`,
    'Create one clear scene, no collage.',
    'STRICT NO-TEXT RULE: do not render any text in the image.',
    'No words, letters, numbers, symbols, subtitles, labels, signs, logos, UI text, speech bubbles, captions, or watermarks.',
    'If any text appears, regenerate mentally and output a text-free scene.'
  ];
  const customPanelPrompt = String(cfg?.generation?.custom_panel_prompt || '').trim();
  if (customPanelPrompt) {
    panelPrompt.push(`Custom user panel prompt: ${customPanelPrompt}`);
  }

  const inventPrompt = [
    'You are a creative comic writer.',
    'Expand the seed into an engaging short narrative that is easy to storyboard into comic panels.',
    'Add at least two unexpected but coherent twists.',
    'Keep characters and timeline consistent.',
    `Objective: ${cfg?.generation?.objective || 'summarize'}`,
    `Style: ${cfg?.generation?.style_prompt || '-'}`,
    'Return plain text only (no JSON, no markdown headings).',
    'Seed story:',
    '<seed>'
  ];

  const objectives = getOptions('generation.objective');
  const objectiveLines = objectives.map((name) => {
    const override = String(cfg?.generation?.objective_prompt_overrides?.[name] || '').trim();
    return `- ${name}${override ? ` => ${override}` : ''}`;
  });

  return [
    'Prompt catalog',
    '',
    '[Storyboard prompt]',
    storyPrompt.join('\n'),
    '',
    '[Panel image prompt]',
    panelPrompt.join('\n'),
    '',
    '[Story invention prompt]',
    inventPrompt.join('\n'),
    '',
    '[Objectives]',
    objectiveLines.join('\n') || '- summarize'
  ].join('\n');
}

function summarizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return '-';
  const parts = [
    `panels=${cfg?.generation?.panel_count}`,
    `obj=${cfg?.generation?.objective}`,
    `lang=${cfg?.generation?.output_language}`,
    `text=${cfg?.providers?.text?.provider}/${cfg?.providers?.text?.model}`,
    `image=${cfg?.providers?.image?.provider}/${cfg?.providers?.image?.model}`
  ];
  return parts.join(', ');
}

function compactConfigString(cfg) {
  const stylePrompt = String(cfg?.generation?.style_prompt || '').trim();
  let styleKey = '';
  for (const [key, value] of Object.entries(STYLE_PRESETS)) {
    if (String(value || '').trim() === stylePrompt) {
      styleKey = key;
      break;
    }
  }
  const styleShort = styleKey || (stylePrompt ? stylePrompt.slice(0, 14).replace(/\s+/g, '_') : '-');
  return [
    `t:${cfg?.providers?.text?.provider || '-'}/${cfg?.providers?.text?.model || '-'}`,
    `i:${cfg?.providers?.image?.provider || '-'}/${cfg?.providers?.image?.model || '-'}`,
    `p:${cfg?.generation?.panel_count ?? '-'}`,
    `o:${cfg?.generation?.objective || '-'}`,
    `s:${styleShort}`,
    `l:${cfg?.generation?.output_language || '-'}`,
    `m:${cfg?.generation?.delivery_mode || 'default'}`,
    `d:${cfg?.generation?.detail_level || '-'}`,
    `c:${cfg?.runtime?.image_concurrency ?? '-'}`,
    `r:${cfg?.runtime?.retries ?? '-'}`
  ].join(' ');
}

function explainSummaryLineMessage() {
  return [
    'Generation summary line format:',
    't:<text_provider>/<text_model>',
    'i:<image_provider>/<image_model>',
    'p:<panel_count>',
    'o:<objective>',
    's:<style_key_or_short_style>',
    'l:<output_language>',
    'm:<delivery_mode>',
    'd:<detail_level>',
    'c:<image_concurrency>',
    'r:<retries>',
    '',
    'Example:',
    't:gemini/gemini-2.5-flash i:gemini/gemini-2.0-flash-exp-image-generation p:8 o:explain-like-im-five s:classic l:auto m:default d:low c:3 r:1'
  ].join('\n');
}

function createGenerationId(chatId) {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const rnd = Math.random().toString(36).slice(2, 8);
  return `g-${chatId}-${now}-${rnd}`;
}

function listOptionPathsMessage() {
  const paths = allOptionPaths();
  return [
    'Config paths with predefined options:',
    ...paths.map((key) => `- ${key}`)
  ].join('\n');
}

function buildPanelPromptDebugMessage(panel) {
  const idx = Number(panel?.index || 0);
  const total = Number(panel?.total || 0);
  const head = (idx > 0 && total > 0) ? `${idx}(${total})` : (idx > 0 ? String(idx) : '?');
  const prompt = String(panel?.imagePromptUsed || '').trim();
  return `Image prompt ${head}:\n${prompt || '(missing)'}`;
}

async function sendPanelWithRetry(chatId, panel, index, debugPromptsEnabled = false) {
  if (debugPromptsEnabled) {
    await sendLongMessage(chatId, buildPanelPromptDebugMessage(panel));
  }
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await api.sendPhoto(chatId, panel.imagePath, panel.caption || '');
      return;
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw new Error(`Failed sending panel ${index + 1}: ${String(last?.message || last)}`);
}

function normalizePanelMessages(panelMessages = []) {
  return (Array.isArray(panelMessages) ? panelMessages : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const ai = Number(a?.index || 0);
      const bi = Number(b?.index || 0);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai > 0 && bi > 0) return ai - bi;
      return 0;
    });
}

function createOrderedPanelSender(chatId, alreadySent = new Set(), debugPromptsEnabled = false) {
  const pending = new Map();
  let nextIndex = 1;
  while (alreadySent.has(nextIndex)) nextIndex += 1;
  let drain = Promise.resolve();

  return async (panelMessage) => {
    const idx = Number(panelMessage?.index || 0);
    if (!Number.isFinite(idx) || idx < 1) return;
    pending.set(idx, panelMessage);
    drain = drain.then(async () => {
      while (pending.has(nextIndex)) {
        const panel = pending.get(nextIndex);
        pending.delete(nextIndex);
        await sendPanelWithRetry(chatId, panel, nextIndex - 1, debugPromptsEnabled);
        alreadySent.add(nextIndex);
        nextIndex += 1;
        while (alreadySent.has(nextIndex)) nextIndex += 1;
      }
    });
    await drain;
  };
}

function normalizeDeliveryMode(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/-/g, '_');
  if (!v || v === 'default') return 'default';
  if (v === 'media' || v === 'group' || v === 'mediagroup' || v === 'media_group') return 'media_group';
  if (v === 'single' || v === 'single_message' || v === 'singlemessage' || v === 'single_formatted_message') return 'single';
  return '';
}

async function sendMediaGroupWithRetry(chatId, panels) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await api.sendMediaGroup(chatId, panels);
      return;
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw new Error(`Failed sending media group: ${String(last?.message || last)}`);
}

async function sendSingleFormattedComic(chatId, panelResult, sourceMode, cfg, debugPromptsEnabled = false) {
  const panels = normalizePanelMessages(panelResult?.panelMessages);
  if (!panels.length) return;
  if (debugPromptsEnabled) {
    for (let i = 0; i < panels.length; i += 1) {
      await sendLongMessage(chatId, buildPanelPromptDebugMessage(panels[i]));
    }
  }
  const caption = [
    `Panels: ${panels.length}`,
    ...panels.map((p, idx) => `${idx + 1}. ${String(p.caption || '').replace(/\s+/g, ' ').slice(0, 160)}`)
  ].join('\n');
  const firstPath = String(panels[0].imagePath || '');
  const dir = path.dirname(firstPath);
  const outPath = path.join(dir, 'comic-sheet.png');
  try {
    const panelImages = panels.map((p) => ({ buffer: fs.readFileSync(String(p.imagePath || '')) }));
    const storyboard = panelResult?.storyboard || {
      title: 'Web2Comic',
      description: '',
      panels: panels.map((p) => ({ caption: String(p.caption || '') }))
    };
    await composeComicSheet({
      storyboard,
      panelImages,
      source: String(sourceMode || 'text'),
      outputConfig: cfg?.output || {},
      outputPath: outPath
    });
    await sendPanelWithRetry(chatId, { imagePath: outPath, caption: caption.slice(0, 1000) }, 0, false);
  } catch (_) {
    await sendPanelWithRetry(chatId, { imagePath: firstPath, caption: caption.slice(0, 1000) }, 0, false);
  }
}

async function sendPanelSequence(chatId, panelResult, sourceModeLabel, configLine = '', alreadySent = new Set(), deliveryMode = 'default', cfg = null, debugPromptsEnabled = false) {
  const sourceMode = String(sourceModeLabel || 'text').toLowerCase();
  const selectedMode = normalizeDeliveryMode(deliveryMode);
  const panels = normalizePanelMessages(panelResult?.panelMessages);
  if (String(configLine || '').trim()) {
    await api.sendMessage(chatId, configLine);
  }
  const remaining = panels.filter((p, idx) => !alreadySent.has(Number(p?.index || idx + 1)));
  if (selectedMode === 'media_group' && remaining.length) {
    if (debugPromptsEnabled) {
      for (let i = 0; i < remaining.length; i += 1) {
        await sendLongMessage(chatId, buildPanelPromptDebugMessage(remaining[i]));
      }
    }
    await sendMediaGroupWithRetry(chatId, remaining);
  } else if (selectedMode === 'single' && panels.length) {
    await sendSingleFormattedComic(chatId, panelResult, sourceMode, cfg, debugPromptsEnabled);
  } else {
    for (let i = 0; i < remaining.length; i += 1) {
      await sendPanelWithRetry(chatId, remaining[i], i, debugPromptsEnabled);
    }
  }
  await api.sendMessage(chatId, [
    `Done: ${sourceMode} -> comic panels`,
    `Panels: ${panelResult.panelCount}`,
    `Time: ${(Number(panelResult.elapsedMs || 0) / 1000).toFixed(1)}s`
  ].join('\n'));
  await api.sendMessage(chatId, 'Use /help for options and customizations.');
}

function listGeneratedRows(history) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => {
      const result = h?.result || {};
      const type = String(result.type || '').toLowerCase();
      return Boolean(result.ok) && (type === 'generation' || type === 'invent');
    })
    .slice()
    .sort((a, b) => Date.parse(String(b?.timestamp || '')) - Date.parse(String(a?.timestamp || '')))
    .slice(0, 10);
}

function resolveHistoryUserLabel(chatId) {
  if (!configStore || typeof configStore.getUserSummary !== 'function') {
    return `id:${String(chatId || '-')}`;
  }
  const summary = configStore.getUserSummary(chatId);
  if (summary && summary.label) return summary.label;
  return `id:${String(chatId || '-')}`;
}

function formatPeekName(entry) {
  const storyboardTitle = String(entry?.result?.storyboard?.title || '').trim();
  if (storyboardTitle) return storyboardTitle;
  const requestText = String(entry?.requestText || '').trim();
  return requestText ? requestText.slice(0, 90) : 'Untitled comic';
}

function formatPeekMessage(history) {
  const rows = listGeneratedRows(history);
  if (!rows.length) return 'No generated comics yet.';

  const lines = ['Last 10 generated comics:'];
  rows.forEach((h, idx) => {
    const userLabel = resolveHistoryUserLabel(h?.chatId);
    lines.push(`${idx + 1}. ${String(h?.timestamp || '-')} | ${userLabel} | ${formatPeekName(h)}`);
  });
  lines.push('Use /peek <number> to view one item.');
  return lines.join('\n');
}

function formatPeekSingleMessage(history, selected) {
  const rows = listGeneratedRows(history);
  if (!rows.length) return 'No generated comics yet.';
  const idx = Number(selected);
  if (!Number.isFinite(idx) || idx < 1 || idx > rows.length) {
    return `Invalid comic index. Use /peek, then choose 1-${rows.length}.`;
  }
  const row = rows[idx - 1];
  const userLabel = resolveHistoryUserLabel(row?.chatId);
  const img = row?.result?.outputPath ? String(row.result.outputPath) : '-';
  return [
    `Comic ${idx} of ${rows.length}`,
    `date: ${String(row?.timestamp || '-')}`,
    `user: ${userLabel}`,
    `name: ${formatPeekName(row)}`,
    `image: ${img}`
  ].join('\n');
}

function formatLogMessage(history, limit = 10) {
  const size = Math.max(1, Math.min(50, Number(limit) || 10));
  const rows = (Array.isArray(history) ? history : [])
    .slice()
    .sort((a, b) => Date.parse(String(b?.timestamp || '')) - Date.parse(String(a?.timestamp || '')))
    .slice(0, size);
  if (!rows.length) return 'No logs yet.';

  const lines = [`Last ${size} logs:`];
  rows.forEach((h, idx) => {
    const type = String(h?.result?.type || '-');
    const ok = Boolean(h?.result?.ok);
    const err = String(h?.result?.error || '').trim();
    lines.push(`${idx + 1}. ${String(h.timestamp || '-')}`);
    lines.push(`user: ${resolveHistoryUserLabel(h.chatId)}`);
    lines.push(`type: ${type} ok:${ok ? '1' : '0'}`);
    lines.push(`msg: ${String(h.requestText || '').slice(0, 160)}`);
    if (err) lines.push(`err: ${err.slice(0, 160)}`);
  });
  return lines.join('\n');
}

async function handleCommand(chatId, text) {
  const parts = splitCommand(text);
  const commandToken = String(parts[0] || '').toLowerCase();
  const command = normalizeCommandToken(commandToken);
  const peekTokenMatch = commandToken.match(/^\/peek(\d{1,3})$/);
  const logTokenMatch = commandToken.match(/^\/log(\d{1,3})$/);

  if (command === '/start') {
    await api.sendMessage(chatId, onboardingMessage(chatId));
    await api.sendMessage(chatId, 'Need the full command list? /help');
    return true;
  }

  if (command === '/help') {
    await api.sendMessage(chatId, commandHelp(chatId));
    return true;
  }

  if (command === '/welcome') {
    await api.sendMessage(chatId, onboardingMessage(chatId));
    await api.sendMessage(chatId, 'Need the full command list? /help');
    return true;
  }

  if (command === '/debug') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const current = Boolean(configStore.getCurrent(chatId, 'generation.debug_prompts'));
    if (!value || (value !== 'on' && value !== 'off')) {
      await api.sendMessage(chatId, [
        'Usage: /debug <on|off>',
        'Explanation: when enabled, print image prompt used for each panel before sending images.',
        'Allowed: on, off',
        `Current: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    const enabled = value === 'on';
    await configStore.setConfigValue(chatId, 'generation.debug_prompts', enabled);
    await api.sendMessage(chatId, `Updated generation.debug_prompts = ${enabled ? 'on' : 'off'}`);
    return true;
  }

  if (command === '/about') {
    await api.sendMessage(chatId, [
      `${BOT_DISPLAY_NAME}`,
      `Creator: Alexander (Sasha) Apartsin`,
      `Project: https://github.com/ApartsinProjects/Web2Comics`,
      `Site: https://www.apartsin.com`
    ].join('\n'));
    return true;
  }

  if (command === '/version') {
    const createdAt = configStore.getMeta('bot_created_at');
    await api.sendMessage(chatId, [
      `version: ${BOT_VERSION}`,
      `created: ${createdAt || '-'}`,
      `start: ${BOT_PROCESS_START_TIME}`
    ].join('\n'));
    return true;
  }

  if (command === '/explain') {
    await api.sendMessage(chatId, explainSummaryLineMessage());
    return true;
  }

  if (command === '/user') {
    await api.sendMessage(chatId, `Your user id: ${chatId}`);
    return true;
  }

  if (command === '/config') {
    await api.sendMessage(chatId, configStore.formatConfigSummary(chatId));
    return true;
  }

  if (command === '/prompts') {
    const cfg = configStore.getEffectiveConfig(chatId);
    await sendLongMessage(chatId, buildPromptCatalog(cfg));
    return true;
  }

  if (command === '/peek' || peekTokenMatch) {
    const fromToken = peekTokenMatch ? Number(peekTokenMatch[1]) : NaN;
    const fromArg = Number(parts[1]);
    const selected = Number.isFinite(fromArg) && fromArg > 0
      ? fromArg
      : (Number.isFinite(fromToken) && fromToken > 0 ? fromToken : NaN);
    if (Number.isFinite(selected) && selected > 0) {
      await api.sendMessage(chatId, formatPeekSingleMessage(configStore.getHistory(), selected));
      return true;
    }
    await api.sendMessage(chatId, formatPeekMessage(configStore.getHistory()));
    return true;
  }

  if (command === '/log' || logTokenMatch) {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    const fromToken = logTokenMatch ? Number(logTokenMatch[1]) : NaN;
    const fromArg = Number(parts[1]);
    const limit = Number.isFinite(fromArg) && fromArg > 0
      ? fromArg
      : (Number.isFinite(fromToken) && fromToken > 0 ? fromToken : 10);
    await api.sendMessage(chatId, formatLogMessage(configStore.getHistory(), limit));
    return true;
  }

  if (command === '/users') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    await api.sendMessage(chatId, formatUsersMessage());
    return true;
  }

  if (command === '/ban') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    const target = String(parts[1] || '').trim();
    if (!target) {
      await api.sendMessage(chatId, formatBanlistMessage());
      return true;
    }
    try {
      const banned = await configStore.banIdentifier(target);
      const lines = [`Added to blacklist: ${target}`];
      if (banned.bannedId) lines.push(`id: ${banned.bannedId}`);
      if (banned.bannedUsername) lines.push(`username: @${banned.bannedUsername}`);
      await api.sendMessage(chatId, lines.join('\n'));
    } catch (error) {
      await api.sendMessage(chatId, `ban failed: ${error.message}`);
    }
    return true;
  }

  if (command === '/unban') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    const target = String(parts[1] || '').trim();
    if (!target) {
      await api.sendMessage(chatId, [
        'Usage: /unban <user_id|username>',
        'Explanation: remove a user from the blacklist by id or username.',
        'Allowed: numeric user id or @username (without @ also works).',
        formatBanlistMessage()
      ].join('\n'));
      return true;
    }
    try {
      const removed = await configStore.unbanIdentifier(target);
      if (!removed.changed) {
        await api.sendMessage(chatId, `User is not in blacklist: ${target}`);
        return true;
      }
      const lines = [`Removed from blacklist: ${target}`];
      if (removed.removedId) lines.push(`id: ${removed.removedId}`);
      if (removed.removedUsername) lines.push(`username: @${removed.removedUsername}`);
      await api.sendMessage(chatId, lines.join('\n'));
    } catch (error) {
      await api.sendMessage(chatId, `unban failed: ${error.message}`);
    }
    return true;
  }

  if (command === '/vendor' || command === '/text_vendor' || command === '/image_vendor') {
    const vendor = String(parts[1] || '').trim().toLowerCase();
    if (!vendor) {
      const currentText = String(configStore.getCurrent(chatId, 'providers.text.provider') || '-');
      const currentImage = String(configStore.getCurrent(chatId, 'providers.image.provider') || '-');
      await api.sendMessage(chatId, [
        `Usage: ${command} <${Object.keys(PROVIDER_DEFAULT_MODELS).join('|')}>`,
        'Explanation: switch provider defaults for text/image generation.',
        `Allowed: ${Object.keys(PROVIDER_DEFAULT_MODELS).join(', ')}`,
        `Current: text=${currentText}, image=${currentImage}`
      ].join('\n'));
      return true;
    }
    const missingKeys = getMissingProviderKeys(chatId, vendor);
    if (missingKeys.length) {
      await api.sendMessage(chatId, providerProvisioningMessage(vendor, missingKeys));
      return true;
    }
    try {
      const isTextOnly = command === '/text_vendor';
      const isImageOnly = command === '/image_vendor';
      const defaults = await applyProvider(chatId, vendor, !isImageOnly, !isTextOnly);
      const msg = [];
      msg.push(`Provider updated: ${vendor}`);
      if (!isImageOnly) msg.push(`- text model: ${defaults.text}`);
      if (!isTextOnly) msg.push(`- image model: ${defaults.image}`);
      await api.sendMessage(chatId, msg.join('\n'));
    } catch (error) {
      await api.sendMessage(chatId, `Provider update failed: ${error.message}`);
    }
    return true;
  }

  if (command === '/models') {
    const target = String(parts[1] || '').trim().toLowerCase();
    if (!target) {
      await api.sendMessage(chatId, buildModelsStatusMessage(chatId));
      return true;
    }
    if (target !== 'text' && target !== 'image') {
      await api.sendMessage(chatId, [
        'Usage: /models [text|image] [model]',
        'Explanation: list or set model for current vendor only.',
        buildModelsStatusMessage(chatId)
      ].join('\n\n'));
      return true;
    }
    const value = parts.slice(2).join(' ').trim();
    if (!value) {
      await api.sendMessage(chatId, buildModelsStatusMessage(chatId, target));
      return true;
    }

    const providerPath = target === 'text' ? 'providers.text.provider' : 'providers.image.provider';
    const modelPath = target === 'text' ? 'providers.text.model' : 'providers.image.model';
    const provider = String(configStore.getCurrent(chatId, providerPath) || '').trim().toLowerCase();
    const currentModel = String(configStore.getCurrent(chatId, modelPath) || '').trim();
    const allowed = listModelsForProvider(provider, target, currentModel);
    if (!valueExists(allowed, value)) {
      await api.sendMessage(chatId, [
        `Model not allowed for current ${target} vendor '${provider || '-'}'.`,
        `Allowed: ${allowed.join(', ') || 'none'}`,
        `Current: ${currentModel || '-'}`
      ].join('\n'));
      return true;
    }
    const selected = allowed.find((m) => String(m).toLowerCase() === String(value).toLowerCase()) || value;
    const updated = await configStore.setConfigValue(chatId, modelPath, selected);
    await api.sendMessage(chatId, `Updated ${modelPath} = ${updated}`);
    return true;
  }

  if (command === '/language') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.output_language');
    if (!value || !valueExists(options, value)) {
      const current = String(configStore.getCurrent(chatId, 'generation.output_language') || 'auto');
      await api.sendMessage(chatId, [
        'Usage: /language <code>',
        'Explanation: set caption/storyboard output language.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.output_language', value);
    await api.sendMessage(chatId, `Updated generation.output_language = ${current}`);
    return true;
  }

  if (command === '/mode') {
    const raw = String(parts[1] || '').trim();
    const value = normalizeDeliveryMode(raw);
    const options = getOptions('generation.delivery_mode');
    if (!raw || !value || !valueExists(options, value)) {
      const current = String(configStore.getCurrent(chatId, 'generation.delivery_mode') || 'default');
      await api.sendMessage(chatId, [
        'Usage: /mode <name>',
        'Explanation: choose how panel outputs are delivered.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.delivery_mode', value);
    await api.sendMessage(chatId, `Updated generation.delivery_mode = ${current}`);
    return true;
  }

  if (command === '/consistency') {
    const options = getOptions('generation.consistency');
    const value = String(parts[1] || '').trim().toLowerCase();
    const current = Boolean(configStore.getCurrent(chatId, 'generation.consistency'));
    if (!value) {
      await api.sendMessage(chatId, [
        'Usage: /consistency <on|off>',
        'Explanation: generate a style reference image and reuse it for panel consistency.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    if (!valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /consistency <on|off>',
        'Explanation: toggle style-consistency flow.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'generation.consistency', value);
    await api.sendMessage(chatId, `Updated generation.consistency = ${updated ? 'on' : 'off'}`);
    return true;
  }

  if (command === '/panels') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('generation.panel_count');
    const current = String(configStore.getCurrent(chatId, 'generation.panel_count') || '-');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /panels <count>',
        'Explanation: set how many panels to generate.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'generation.panel_count', value);
    await api.sendMessage(chatId, `Updated generation.panel_count = ${updated}`);
    return true;
  }

  if (command === '/objective') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.objective');
    const current = String(configStore.getCurrent(chatId, 'generation.objective') || '').trim() || '-';
    if (!value) {
      await api.sendMessage(chatId, [
        'Usage: /objective <name>',
        'Explanation: set storyboard objective.',
        `Current objective: ${current}`,
        'Available objectives:',
        options.join(', ')
      ].join('\n'));
      return true;
    }
    if (!valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /objective <name>',
        'Explanation: set storyboard objective.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'generation.objective', value);
    await api.sendMessage(chatId, `Updated generation.objective = ${updated}`);
    return true;
  }

  if (command === '/style') {
    const styleInput = parts.slice(1).join(' ').trim();
    const preset = normalizeStyleName(styleInput);
    const userStyles = (() => {
      const cfg = configStore.getEffectiveConfig(chatId);
      const styles = cfg && cfg.generation && typeof cfg.generation.user_styles === 'object'
        ? cfg.generation.user_styles
        : {};
      return styles && typeof styles === 'object' ? styles : {};
    })();
    const currentStylePrompt = String(configStore.getCurrent(chatId, 'generation.style_prompt') || '').trim() || '-';
    if (!styleInput) {
      const customNames = Object.keys(userStyles);
      const allowed = customNames.length
        ? `${Object.keys(STYLE_PRESETS).join(', ')} | your styles: ${customNames.join(', ')}`
        : `${Object.keys(STYLE_PRESETS).join(', ')} | your styles: none`;
      await api.sendMessage(chatId, [
        'Usage: /style <preset-or-your-style>',
        'Explanation: choose a predefined/custom style, or pass free-form style text.',
        `Allowed: ${allowed}`,
        `Current: ${currentStylePrompt}`
      ].join('\n'));
      return true;
    }
    const prompt = STYLE_PRESETS[preset] || String(userStyles[preset] || '').trim();
    if (!prompt) {
      await configStore.setConfigValue(chatId, 'generation.style_prompt', styleInput);
      await api.sendMessage(chatId, 'Updated generation.style_prompt');
      return true;
    }
    await configStore.setConfigValue(chatId, 'generation.style_prompt', prompt);
    await api.sendMessage(chatId, `Updated style preset = ${preset}`);
    return true;
  }

  if (command === '/new_style') {
    const rawName = String(parts[1] || '').trim();
    const styleName = normalizeStyleName(rawName);
    const stylePrompt = parts.slice(2).join(' ').trim();
    if (!styleName || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(styleName) || !stylePrompt) {
      const cfg = configStore.getEffectiveConfig(chatId);
      const styles = cfg && cfg.generation && typeof cfg.generation.user_styles === 'object' ? cfg.generation.user_styles : {};
      const names = Object.keys(styles || {});
      await api.sendMessage(chatId, [
        'Usage: /new_style <name> <text>',
        'Explanation: create your own named style prompt.',
        'Allowed: name is lowercase letters/numbers/dash, 2-41 chars.',
        `Current styles: ${names.length ? names.join(', ') : 'none'}`
      ].join('\n'));
      return true;
    }
    await configStore.setConfigValue(chatId, `generation.user_styles.${styleName}`, stylePrompt);
    await api.sendMessage(chatId, `Saved style '${styleName}'. Use it with /style ${styleName}`);
    return true;
  }

  if (command === '/set_prompt') {
    const kind = String(parts[1] || '').trim().toLowerCase();
    if (kind === 'story') {
      const textValue = parts.slice(2).join(' ').trim();
      if (!textValue) {
        const current = String(configStore.getCurrent(chatId, 'generation.custom_story_prompt') || '').trim() || '-';
        await api.sendMessage(chatId, [
          'Usage: /set_prompt story <text>',
          'Explanation: override story-building prompt.',
          'Allowed: any non-empty text.',
          `Current: ${current}`
        ].join('\n'));
        return true;
      }
      await configStore.setConfigValue(chatId, 'generation.custom_story_prompt', textValue);
      await api.sendMessage(chatId, 'Updated generation.custom_story_prompt');
      return true;
    }
    if (kind === 'panel') {
      const textValue = parts.slice(2).join(' ').trim();
      if (!textValue) {
        const current = String(configStore.getCurrent(chatId, 'generation.custom_panel_prompt') || '').trim() || '-';
        await api.sendMessage(chatId, [
          'Usage: /set_prompt panel <text>',
          'Explanation: override panel image prompt suffix.',
          'Allowed: any non-empty text.',
          `Current: ${current}`
        ].join('\n'));
        return true;
      }
      await configStore.setConfigValue(chatId, 'generation.custom_panel_prompt', textValue);
      await api.sendMessage(chatId, 'Updated generation.custom_panel_prompt');
      return true;
    }
    if (kind === 'objective') {
      const objectiveName = String(parts[2] || '').trim().toLowerCase();
      const textValue = parts.slice(3).join(' ').trim();
      const objectives = getOptions('generation.objective').map((v) => String(v).toLowerCase());
      if (!objectiveName || !textValue || !objectives.includes(objectiveName)) {
        const currentObjective = String(configStore.getCurrent(chatId, 'generation.objective') || '').trim() || '-';
        await api.sendMessage(chatId, [
          `Usage: /set_prompt objective <${getOptions('generation.objective').join('|')}> <text>`,
          'Explanation: set objective-specific story prompt override.',
          `Allowed objectives: ${getOptions('generation.objective').join(', ')}`,
          `Current objective: ${currentObjective}`
        ].join('\n'));
        return true;
      }
      await configStore.setConfigValue(chatId, `generation.objective_prompt_overrides.${objectiveName}`, textValue);
      await api.sendMessage(chatId, `Updated objective prompt override for ${objectiveName}`);
      return true;
    }
    await api.sendMessage(chatId, [
      'Usage: /set_prompt <story|panel|objective> ...',
      'Explanation: customize internal prompt templates.',
      'Allowed: story, panel, objective.'
    ].join('\n'));
    return true;
  }

  if (command === '/detail') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.detail_level');
    const current = String(configStore.getCurrent(chatId, 'generation.detail_level') || '-');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /detail <level>',
        'Explanation: set storyboard/image detail level.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'generation.detail_level', value);
    await api.sendMessage(chatId, `Updated generation.detail_level = ${updated}`);
    return true;
  }

  if (command === '/crazyness') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('generation.invent_temperature');
    const parsed = Number.parseFloat(value);
    const current = String(configStore.getCurrent(chatId, 'generation.invent_temperature') || '0.95');
    if (!value || !Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      await api.sendMessage(chatId, [
        'Usage: /crazyness <0..2>',
        'Explanation: set creativity/temperature for story invention.',
        `Allowed presets: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'generation.invent_temperature', value);
    await api.sendMessage(chatId, `Updated generation.invent_temperature = ${updated}`);
    return true;
  }

  if (command === '/concurrency') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('runtime.image_concurrency');
    const current = String(configStore.getCurrent(chatId, 'runtime.image_concurrency') || '-');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /concurrency <n>',
        'Explanation: max parallel panel image generations.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'runtime.image_concurrency', value);
    await api.sendMessage(chatId, `Updated runtime.image_concurrency = ${updated}`);
    return true;
  }

  if (command === '/retries') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('runtime.retries');
    const current = String(configStore.getCurrent(chatId, 'runtime.retries') || '-');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /retries <n>',
        'Explanation: retry attempts for provider calls.',
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const updated = await setConfigPathValue(chatId, 'runtime.retries', value);
    await api.sendMessage(chatId, `Updated runtime.retries = ${updated}`);
    return true;
  }

  if (command === '/list_options') {
    await api.sendMessage(chatId, listOptionPathsMessage());
    return true;
  }

  if (command === '/options') {
    const pathKey = String(parts[1] || '').trim();
    if (!pathKey) {
      await api.sendMessage(chatId, [
        'Usage: /options <path>',
        '',
        listOptionPathsMessage(),
        '',
        'Example: /options generation.objective'
      ].join('\n'));
      return true;
    }
    await api.sendMessage(chatId, formatOptionsMessage(pathKey, configStore.getCurrent(chatId, pathKey)));
    return true;
  }

  if (command === '/keys') {
    await api.sendMessage(chatId, keysStatusMessage(chatId));
    return true;
  }

  if (command === '/setkey') {
    const key = String(parts[1] || '').trim();
    const value = parts.slice(2).join(' ').trim();
    if (!key || !value) {
      await api.sendMessage(chatId, [
        'Usage: /setkey <KEY> <VALUE>',
        'Explanation: store provider credentials for your user.',
        `Allowed: ${SECRET_KEYS.join(', ')}`,
        keysStatusMessage(chatId)
      ].join('\n'));
      return true;
    }
    try {
      await configStore.setSecret(chatId, key, value);
      configStore.applySecretsToEnv(chatId);
      await api.sendMessage(chatId, `Stored key ${key} in runtime state.`);
    } catch (error) {
      await api.sendMessage(chatId, `setkey failed: ${error.message}`);
    }
    return true;
  }

  if (command === '/unsetkey') {
    const key = String(parts[1] || '').trim();
    if (!key) {
      await api.sendMessage(chatId, [
        'Usage: /unsetkey <KEY>',
        'Explanation: remove one runtime credential.',
        `Allowed: ${SECRET_KEYS.join(', ')}`,
        keysStatusMessage(chatId)
      ].join('\n'));
      return true;
    }
    await configStore.unsetSecret(chatId, key);
    await api.sendMessage(chatId, `Removed runtime override for ${key}.`);
    return true;
  }

  if (command === '/reset_config') {
    await configStore.clearOverrides(chatId);
    await api.sendMessage(chatId, 'Runtime config overrides were reset to base config.');
    return true;
  }

  if (command === '/restart') {
    await configStore.resetUser(chatId);
    configStore.markSeen(chatId);
    await configStore.save();
    await api.sendMessage(chatId, 'Your bot state was restarted to defaults.');
    await api.sendMessage(chatId, onboardingMessage(chatId));
    return true;
  }

  if (command === '/share') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    const target = Number.parseInt(String(parts[1] || '').trim(), 10);
    if (!Number.isFinite(target) || target <= 0) {
      await api.sendMessage(chatId, [
        'Usage: /share <user_id>',
        'Explanation: share your runtime keys with another user id.',
        'Allowed: positive numeric Telegram user id.',
        `Current admin user id: ${chatId}`
      ].join('\n'));
      return true;
    }
    await configStore.setSharedFrom(String(target), String(chatId));
    await api.sendMessage(chatId, `Shared your runtime keys with user ${target}.`);
    await safeNotifyUser(
      target,
      `Admin ${chatId} just unlocked shared provider access for you.\nCreate boldly, and use it with care.`
    );
    return true;
  }

  if (command === '/watermark') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    const raw = String(parts[1] || '').trim().toLowerCase();
    const current = Boolean(configStore.getGlobalCurrent('generation.panel_watermark'));
    if (!raw) {
      await api.sendMessage(chatId, [
        'Usage: /watermark <on|off>',
        'Explanation: admin global toggle for panel watermark.',
        'Allowed: on, off',
        `Current global watermark: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    if (raw !== 'on' && raw !== 'off') {
      await api.sendMessage(chatId, [
        'Usage: /watermark <on|off>',
        'Explanation: admin global toggle for panel watermark.',
        'Allowed: on, off',
        `Current global watermark: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    const enabled = raw === 'on';
    await configStore.setGlobalConfigValue('generation.panel_watermark', enabled);
    await api.sendMessage(chatId, `Global watermark set: ${enabled ? 'on' : 'off'}`);
    return true;
  }

  if (command === '/echo') {
    if (!isAdminChat(chatId)) {
      await api.sendMessage(chatId, 'Access denied.');
      return true;
    }
    if (!BOT_TEST_MODE) {
      await api.sendMessage(chatId, 'Echo command is available only in test mode.');
      return true;
    }
    const raw = String(parts[1] || '').trim().toLowerCase();
    const current = String(configStore.getMeta('echo_input_enabled') || '').toLowerCase() === 'true';
    if (!raw) {
      await api.sendMessage(chatId, [
        'Usage: /echo <on|off>',
        'Explanation: test mode input echo for webhook diagnostics.',
        'Allowed: on, off',
        `Current: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    if (raw !== 'on' && raw !== 'off') {
      await api.sendMessage(chatId, [
        'Usage: /echo <on|off>',
        'Explanation: test mode input echo for webhook diagnostics.',
        'Allowed: on, off',
        `Current: ${current ? 'on' : 'off'}`
      ].join('\n'));
      return true;
    }
    const enabled = raw === 'on';
    await configStore.setMetaValue('echo_input_enabled', enabled);
    await api.sendMessage(chatId, `Echo mode: ${enabled ? 'on' : 'off'} (test mode)`);
    return true;
  }

  return false;
}

async function processMessage(message, context = {}) {
  const chatId = Number(message?.chat?.id || 0);
  const text = extractMessageInputText(message);
  const incomingUsername = String(message?.from?.username || message?.chat?.username || '').trim();
  if (!chatId) return;
  const incoming = classifyIncoming(text);
  const updateSource = String(context?.source || '').trim().toLowerCase();
  const userMeta = {
    id: Number(message?.from?.id || chatId || 0),
    username: incomingUsername
  };
  try {
    if (!text) {
      await api.sendMessage(chatId, 'Unsupported message format. Send plain text or URL.');
      runBackgroundTask('record empty interaction', () => safeRecordInteraction(chatId, {
        kind: 'empty',
        command: '',
        requestText: '',
        result: { ok: false, type: 'unsupported', error: 'empty_message' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    if (configStore.isBanned(chatId, incomingUsername)) {
      await api.sendMessage(chatId, 'Access denied: banned user.');
      runBackgroundTask('record denied banned interaction', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: { ok: false, type: 'denied', error: 'banned_user' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    if (!isAllowedChat(chatId)) {
      console.warn(`[render-bot] denied chat ${chatId}; allowlist=${runtime.allowedChatIds.join(',') || '(none)'} admins=${adminChatIds.join(',') || '(none)'}`);
      await api.sendMessage(chatId, 'Access denied for this bot instance.');
      runBackgroundTask('record denied interaction', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: { ok: false, type: 'denied', error: 'chat_not_allowed' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    runBackgroundTask('update user profile', () => configStore.updateUserProfile(chatId, {
      chat: {
        id: Number(message?.chat?.id || 0),
        type: String(message?.chat?.type || ''),
        title: String(message?.chat?.title || ''),
        username: String(message?.chat?.username || '')
      },
      user: {
        id: Number(message?.from?.id || 0),
        username: String(message?.from?.username || ''),
        first_name: String(message?.from?.first_name || ''),
        last_name: String(message?.from?.last_name || ''),
        language_code: String(message?.from?.language_code || ''),
        is_bot: Boolean(message?.from?.is_bot)
      }
    }));

    const firstSeen = configStore.markSeen(chatId);
    if (firstSeen) {
      runBackgroundTask('save first-seen state', () => configStore.save());
      await api.sendMessage(chatId, onboardingMessage(chatId));
    }

    const echoEnabled = BOT_TEST_MODE && String(configStore.getMeta('echo_input_enabled') || '').toLowerCase() === 'true';
    if (echoEnabled && !(incoming.kind === 'command' && incoming.command === '/echo')) {
      await api.sendMessage(chatId, `Echo input (${incoming.kind || 'text'}): ${String(text || '').slice(0, 1200)}`);
    }
    if (updateSource === 'test') {
      const adminTargets = Array.from(new Set(adminChatIds.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)));
      const echoText = buildTestSourceEchoText(message, incoming);
      for (const adminId of adminTargets) {
        await safeNotifyUser(adminId, echoText);
      }
    }

    if (incoming.kind === 'command' && (incoming.command === '/invent' || incoming.command === '/random')) {
      let seed = '';
      if (incoming.command === '/invent') {
        seed = text.replace(/^\/invent\b/i, '').trim();
        if (!seed) {
          await api.sendMessage(chatId, 'Usage: /invent <story seed>');
          runBackgroundTask('record invent missing seed', () => safeRecordInteraction(chatId, {
            kind: incoming.kind,
            command: incoming.command,
            requestText: text,
            result: { ok: false, type: 'command', error: 'missing_seed' },
            config: configStore.getEffectiveConfig(chatId)
          }, userMeta));
          return;
        }
      } else {
        const randomHint = text.replace(/^\/random\b/i, '').trim();
        seed = randomHint
          ? `Create a fully random, surprising short story inspired by: ${randomHint}`
          : 'Create a fully random, surprising short story with unexpected twists and memorable characters.';
      }

      await api.sendChatAction(chatId, 'upload_photo');
      await api.sendMessage(chatId, incoming.command === '/random' ? 'Generating a random story...' : 'Inventing an expanded story...');

      const effectiveConfigPath = configStore.writeEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
      const effectiveConfig = configStore.getEffectiveConfig(chatId);
      configStore.applySecretsToEnv(chatId);
      const inventedStory = await inventStoryText(seed, effectiveConfigPath, {
        onFallback: async (info) => {
          await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
        }
      });
      await sendLongMessage(chatId, formatInventedStoryMessage(inventedStory));
      await api.sendMessage(chatId, incoming.command === '/random' ? 'Random story ready. Generating your comic...' : 'Invented story ready. Generating your comic...');
      const configLine = compactConfigString(effectiveConfig);
      await api.sendMessage(chatId, configLine);
      const deliveryMode = normalizeDeliveryMode(effectiveConfig?.generation?.delivery_mode || 'default');
      const debugPromptsEnabled = Boolean(effectiveConfig?.generation?.debug_prompts);
      const alreadySent = new Set();
      const orderedSender = createOrderedPanelSender(chatId, alreadySent, debugPromptsEnabled);
      const generationId = createGenerationId(chatId);
      const result = await generatePanelsWithRuntimeConfig(inventedStory, runtime, effectiveConfigPath, {
        userId: chatId,
        generationId,
        onFallback: async (info) => {
          await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
        },
        onPanelReady: (deliveryMode === 'default')
          ? async (panelMessage) => {
              await orderedSender(panelMessage);
            }
          : undefined
      });
      await sendPanelSequence(chatId, result, 'invent', '', alreadySent, deliveryMode, effectiveConfig, debugPromptsEnabled);
      runBackgroundTask('record invent success', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: {
          ok: true,
          type: 'invent',
          outputPath: (result.panelMessages && result.panelMessages[0] && result.panelMessages[0].imagePath) || '',
          panelCount: result.panelCount,
          elapsedMs: result.elapsedMs,
          storyboard: result.storyboard || null
        },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    const handled = await handleCommand(chatId, text);
    if (handled) {
      runBackgroundTask('record command success', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: { ok: true, type: 'command' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    if (incoming.kind === 'command') {
      await api.sendMessage(chatId, 'Unrecognized command.');
      runBackgroundTask('record unknown command', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: { ok: false, type: 'command', error: 'unrecognized_command' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    const effectiveConfigPath = configStore.writeEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
    const effectiveConfig = configStore.getEffectiveConfig(chatId);
    configStore.applySecretsToEnv(chatId);
    let generationInput = text;
    let parsedInput = classifyMessageInput(generationInput);
    let shortPromptExpanded = false;
    let inventedStoryPreview = '';
    const shortTextInput = incoming.kind === 'text' && isShortTextPrompt(text);
    if (shortTextInput && parsedInput.kind !== 'url') {
      const inferredUrl = inferLikelyWebUrlFromText(text);
      if (inferredUrl) {
        generationInput = inferredUrl;
        parsedInput = classifyMessageInput(generationInput);
      }
    }
    const hasWebPageUrl = parsedInput.kind === 'url' && isLikelyWebPageUrl(parsedInput.value);
    if (shortTextInput && parsedInput.kind !== 'url') {
      shortPromptExpanded = true;
      await api.sendMessage(
        chatId,
        'Your prompt is too short, so we need to invent a longer story first. I am using AI to expand it.'
      );
      const inventedStory = await inventStoryText(text, effectiveConfigPath, {
        onFallback: async (info) => {
          await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
        }
      });
      inventedStoryPreview = String(inventedStory || '').slice(0, 1000);
      await api.sendMessage(chatId, formatInventedStoryMessage(inventedStory));
      generationInput = inventedStory;
    }

    await api.sendChatAction(chatId, 'upload_photo');
    if (shortPromptExpanded) {
      await api.sendMessage(chatId, 'Generating your comic from the expanded story...');
    } else {
      await api.sendMessage(chatId, 'Generating your comic...');
    }

    const configLine = compactConfigString(effectiveConfig);
    await api.sendMessage(chatId, configLine);
    const deliveryMode = normalizeDeliveryMode(effectiveConfig?.generation?.delivery_mode || 'default');
    const debugPromptsEnabled = Boolean(effectiveConfig?.generation?.debug_prompts);
    const alreadySent = new Set();
    const orderedSender = createOrderedPanelSender(chatId, alreadySent, debugPromptsEnabled);
    const generationId = createGenerationId(chatId);
    let result;
    try {
      result = await generatePanelsWithRuntimeConfig(generationInput, runtime, effectiveConfigPath, {
        userId: chatId,
        generationId,
        onFallback: async (info) => {
          await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
        },
        onPanelReady: (deliveryMode === 'default')
          ? async (panelMessage) => {
              await orderedSender(panelMessage);
            }
          : undefined
      });
    } catch (firstError) {
      if (!hasWebPageUrl) throw firstError;
      const fallbackText = extractTextFallbackFromUrlMessage(generationInput);
      const fallbackParsed = classifyMessageInput(fallbackText);
      if (fallbackText && fallbackParsed.kind !== 'url') {
        await api.sendMessage(chatId, "Can't extract from HTML, trying text.");
        result = await generatePanelsWithRuntimeConfig(fallbackText, runtime, effectiveConfigPath, {
          userId: chatId,
          generationId: createGenerationId(chatId),
          onFallback: async (info) => {
            await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
          },
          onPanelReady: (deliveryMode === 'default')
            ? async (panelMessage) => {
                await orderedSender(panelMessage);
              }
            : undefined
        });
      } else {
        await api.sendMessage(chatId, "Can't extract from HTML, inventing a story from your input.");
        const seed = String(text || generationInput || '').trim() || String(parsedInput.value || '').trim();
        const inventedStory = await inventStoryText(seed, effectiveConfigPath, {
          onFallback: async (info) => {
            await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
          }
        });
        shortPromptExpanded = true;
        inventedStoryPreview = String(inventedStory || '').slice(0, 1000);
        await sendLongMessage(chatId, formatInventedStoryMessage(inventedStory));
        await api.sendMessage(chatId, 'Invented story ready. Generating your comic...');
        result = await generatePanelsWithRuntimeConfig(inventedStory, runtime, effectiveConfigPath, {
          userId: chatId,
          generationId: createGenerationId(chatId),
          onFallback: async (info) => {
            await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
          },
          onPanelReady: (deliveryMode === 'default')
            ? async (panelMessage) => {
                await orderedSender(panelMessage);
              }
            : undefined
        });
      }
    }
    await sendPanelSequence(chatId, result, result.kind === 'url' ? 'url' : 'text', '', alreadySent, deliveryMode, effectiveConfig, debugPromptsEnabled);
    runBackgroundTask('record generation success', () => safeRecordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: {
        ok: true,
        type: 'generation',
        outputPath: (result.panelMessages && result.panelMessages[0] && result.panelMessages[0].imagePath) || '',
        panelCount: result.panelCount,
        elapsedMs: result.elapsedMs,
        storyboard: result.storyboard || null,
        shortPromptExpanded,
        inventedStoryPreview
      },
      config: configStore.getEffectiveConfig(chatId)
    }, userMeta));
  } catch (error) {
    await safeNotifyUser(chatId, `Generation failed: ${String(error?.message || error)}`);
    runBackgroundTask('record generation failure', () => safeRecordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: { ok: false, type: 'generation', error: String(error?.message || error) },
      config: configStore.getEffectiveConfig(chatId)
    }, userMeta));
  }
}

function enqueueUpdate(update) {
  const chatId = Number(update?.message?.chat?.id || 0);
  const updateSource = normalizeUpdateSource(update, update?.message);
  const key = chatId > 0 ? String(chatId) : 'global';
  const current = chatQueues.get(key) || Promise.resolve();
  const next = current
    .then(async () => {
      if (!update?.message) return;
      await Promise.race([
        processMessage(update.message, { source: updateSource }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${jobTimeoutMs}ms`)), jobTimeoutMs))
      ]);
    })
    .catch(async (error) => {
      const targetChatId = Number(update?.message?.chat?.id || 0);
      await safeNotifyUser(targetChatId, `Unexpected bot error: ${String(error?.message || error)}`);
      await safeRecordInteraction(targetChatId, {
        kind: 'command',
        command: 'queue_error',
        requestText: String(update?.message?.text || update?.message?.caption || ''),
        result: { ok: false, type: 'queue_error', error: String(error?.message || error) },
        config: configStore && targetChatId ? configStore.getEffectiveConfig(targetChatId) : {}
      }, {
        id: Number(update?.message?.from?.id || targetChatId || 0),
        username: String(update?.message?.from?.username || update?.message?.chat?.username || '').trim()
      });
      console.error('[render-bot] job failed:', error && error.message ? error.message : String(error));
    });
  chatQueues.set(key, next.finally(() => {
    if (chatQueues.get(key) === next) chatQueues.delete(key);
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function cleanupProcessedUpdates(nowMs) {
  const now = Number(nowMs || Date.now());
  for (const [id, ts] of processedUpdates.entries()) {
    if ((now - ts) > processedUpdatesTtlMs) processedUpdates.delete(id);
  }
}

function markOrRejectDuplicate(update) {
  const id = Number(update?.update_id);
  if (!Number.isFinite(id)) return false;
  const now = Date.now();
  cleanupProcessedUpdates(now);
  if (processedUpdates.has(id)) return true;
  processedUpdates.set(id, now);
  return false;
}

const webhookPath = `/telegram/webhook/${webhookSecret}`;

async function startServer() {
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  if (!webhookSecret) throw new Error('Missing TELEGRAM_WEBHOOK_SECRET');

  const persistenceMode = createPersistence({
    mode: process.env.RENDER_BOT_PERSISTENCE_MODE || '',
    pgUrl: process.env.RENDER_BOT_PG_URL || process.env.DATABASE_URL || '',
    pgTableName: process.env.RENDER_BOT_PG_TABLE || 'render_bot_state',
    pgStateKey: process.env.RENDER_BOT_PG_STATE_KEY || 'runtime_config',
    r2Endpoint: process.env.R2_S3_ENDPOINT || '',
    r2Bucket: process.env.R2_BUCKET || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    r2StateKey: process.env.R2_STATE_KEY || 'state/runtime-config.json',
    filePath: path.resolve(process.env.RENDER_BOT_STATE_FILE || path.join(repoRoot, 'render/data/runtime-state.json'))
  });
  configStore = new RuntimeConfigStore(
    path.resolve(process.env.RENDER_BOT_BASE_CONFIG || path.join(repoRoot, 'render/config/default.render.yml')),
    persistenceMode.impl
  );
  await configStore.load();
  const deployDefaultProvider = String(process.env.RENDER_BOT_DEFAULT_PROVIDER || '').trim().toLowerCase();
  if (deployDefaultProvider && PROVIDER_DEFAULT_MODELS[deployDefaultProvider]) {
    const defaults = PROVIDER_DEFAULT_MODELS[deployDefaultProvider];
    await configStore.setGlobalConfigValue('providers.text.provider', deployDefaultProvider);
    await configStore.setGlobalConfigValue('providers.text.model', defaults.text);
    await configStore.setGlobalConfigValue('providers.image.provider', deployDefaultProvider);
    await configStore.setGlobalConfigValue('providers.image.model', defaults.image);
    console.log(`[render-bot] deployment default provider enforced: ${deployDefaultProvider}`);
  }
  const deployDefaultObjective = String(process.env.RENDER_BOT_DEFAULT_OBJECTIVE || '').trim().toLowerCase();
  if (deployDefaultObjective) {
    const allowedObjectives = getOptions('generation.objective').map((v) => String(v || '').trim().toLowerCase());
    if (allowedObjectives.includes(deployDefaultObjective)) {
      await configStore.setGlobalConfigValue('generation.objective', deployDefaultObjective);
      console.log(`[render-bot] deployment default objective enforced: ${deployDefaultObjective}`);
    } else {
      console.log(`[render-bot] deployment default objective ignored (unsupported): ${deployDefaultObjective}`);
    }
  }
  await configStore.ensureMetaValue('bot_created_at', new Date().toISOString());
  await seedAdminRuntimeSecretsFromEnv();
  configStore.applySecretsToEnv('global');
  const requestStore = createRequestLogStoreFromEnv();
  requestLogStore = requestStore.impl;
  requestLogStoreMode = requestStore.mode;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        return sendJson(res, 200, { ok: true, service: 'render-telegram-bot', persistence: persistenceMode.mode });
      }

      if (req.method === 'POST' && req.url === webhookPath) {
        const headerSecret = String(req.headers['x-telegram-bot-api-secret-token'] || '');
        if (headerSecret !== webhookSecret) {
          return sendJson(res, 403, { ok: false, error: 'invalid secret token' });
        }

        const raw = await readBody(req);
        let update;
        try {
          update = JSON.parse(raw || '{}');
        } catch (_) {
          return sendJson(res, 400, { ok: false, error: 'invalid json' });
        }

        if (markOrRejectDuplicate(update)) {
          return sendJson(res, 200, { ok: true, duplicate: true });
        }

        enqueueUpdate(update);
        return sendJson(res, 200, { ok: true, queued: true });
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
  });

  const port = Number(process.env.PORT || 10000);
  server.listen(port, () => {
    console.log(`[render-bot] listening on port ${port}`);
    console.log(`[render-bot] webhook path: ${webhookPath}`);
    console.log(`[render-bot] persistence: ${persistenceMode.mode}`);
    console.log(`[render-bot] crash logs: ${crashStoreMode}`);
    console.log(`[render-bot] request logs: ${requestLogStoreMode}`);
    console.log(`[render-bot] image storage: ${runtime.r2Endpoint && runtime.r2Bucket ? 'r2' : 'file'}`);
    console.log('[render-bot] ready');
    notifyDeploymentReady().catch((error) => {
      console.error('[render-bot] deployment notification failed:', error && error.message ? error.message : String(error));
    });
  });
}

let crashing = false;
async function handleFatalEvent(event, errorLike) {
  if (crashing) return;
  crashing = true;
  const message = errorLike && errorLike.message ? errorLike.message : String(errorLike || '');
  console.error(`[render-bot] fatal ${event}:`, message);
  await persistCrash(event, errorLike);
  process.exit(1);
}

process.on('uncaughtException', (error) => {
  handleFatalEvent('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  handleFatalEvent('unhandledRejection', reason);
});

startServer().catch((error) => {
  console.error('[render-bot] startup failed:', error && error.message ? error.message : String(error));
  persistCrash('startupFailure', error).finally(() => process.exit(1));
});
