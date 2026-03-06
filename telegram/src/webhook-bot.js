const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadEnvFiles, loadSecretValues } = require('./env');
const { TelegramApi } = require('./telegram-api');
const { RuntimeConfigStore } = require('./config-store');
const { normalizeSecretKey } = require('./config-store');
const { allOptionPaths, getOptions, parseUserValue, formatOptionsMessage, SECRET_KEYS } = require('./options');
const {
  generatePanelsWithRuntimeConfig,
  inventStoryText,
  normalizeUrlExtractor,
  normalizeEnrichmentProvider,
  warmupPlaywrightChromiumInBackground,
  isProviderOrModelFailure
} = require('./generate');
const { createPersistence } = require('./persistence');
const { createBlacklistStoreFromEnv } = require('./blacklist-store');
const { createKnownUsersStoreFromEnv } = require('./known-users-store');
const { redactSensitiveText } = require('./redact');
const { createCrashLogStoreFromEnv, FileCrashLogStore } = require('./crash-log-store');
const { createRequestLogStoreFromEnv } = require('./request-log-store');
const { createRuntimeLogStoreFromEnv } = require('./runtime-log-store');
const { normalizeCloudflareR2Endpoint } = require('./r2-endpoint');
const {
  classifyMessageInput,
  extractTextFallbackFromUrlMessage,
  extractMessageInputText
} = require('./message-utils');
const { decideInputIntent, NON_TEXT_SOURCE_TYPES } = require('./intent-routing');
const {
  normalizePdfExtractor,
} = require('./pdf-extract');
const {
  normalizeImageExtractor,
  normalizeVoiceExtractor,
  detectStoryExtractionSource,
  extractStoryFromSource,
  extractImageFromTelegramMessage,
  extractAudioFromTelegramMessage,
  extractPdfFromTelegramDocument
} = require('./story-extraction');
const {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_MODEL_CATALOG,
  PROVIDER_REQUIRED_KEYS,
  PROVIDER_TEXT_NAMES,
  PROVIDER_IMAGE_NAMES,
  PROVIDER_NAMES
} = require('./data/providers');
const {
  STYLE_PRESETS,
  STYLE_SHORTCUTS,
  OBJECTIVE_SHORTCUTS,
  getObjectiveMeta,
  getStyleMeta
} = require('./data/styles-objectives');
const {
  SHORT_STORY_PROMPT_MAX_CHARS,
  SUMMARY_MIN_CHARS
} = require('./data/thresholds');
const {
  BOT_DISPLAY_NAME,
  BOT_COLD_START_NOTICE,
  PROMPT_MANUAL_URL,
  buildOnboardingMessage,
  buildHelpMessage
} = require('./data/messages');
const { buildStoryboardPrompt } = require('../../engine/src/prompts');
const { buildPanelImagePrompt, buildStyleReferencePrompt } = require('../../engine/src');
const { generateTextWithProvider, generateImageWithProvider } = require('../../engine/src/providers');
const { buildInventStoryPrompt } = require('./generate');
const { composeComicSheet } = require('../../engine/src/compose');
const packageJson = require('../../package.json');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.all'),
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, '.crawler'),
  path.join(repoRoot, 'comicbot/.env'),
  path.join(repoRoot, 'telegram/.env'),
  path.join(repoRoot, 'telegram/.crawler')
]);
loadSecretValues([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'HUGGINGFACE_INFERENCE_API_TOKEN',
  'CLOUDFLARE_WORKERS_AI_TOKEN',
  'CLOUDFLARE_ACCOUNT_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'FIRECRAWL_API_KEY',
  'JINA_API_KEY',
  'DRIFTBOT_API_KEY',
  'UNSTRUCTURED_API_KEY',
  'LLAMA_CLOUD_API_KEY',
  'ASSEMBLYAI_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY'
]);

process.env.R2_S3_ENDPOINT = normalizeCloudflareR2Endpoint(
  String(process.env.R2_S3_ENDPOINT || '').trim(),
  String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
);

function parseAllowAllFlag(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function parseAllowedChats(rawValue, allowAllFlag) {
  const raw = String(rawValue == null ? '' : rawValue).trim();
  const normalized = raw.toLowerCase();
  if (allowAllFlag || !raw || normalized === 'all' || normalized === '*') {
    return { allowAll: true, ids: [] };
  }
  const ids = raw
    .split(',')
    .map((v) => Number(String(v || '').trim()))
    .filter((n) => Number.isFinite(n));
  return {
    allowAll: ids.length === 0,
    ids
  };
}

const allowedChatConfig = parseAllowedChats(
  process.env.COMICBOT_ALLOWED_CHAT_IDS,
  parseAllowAllFlag(process.env.RENDER_ALLOW_ALL_CHATS)
);

const runtime = {
  repoRoot,
  outDir: path.resolve(process.env.RENDER_BOT_OUT_DIR || path.join(repoRoot, 'telegram/out')),
  imageStatusFile: path.resolve(process.env.RENDER_BOT_IMAGE_STATUS_FILE || path.join(repoRoot, 'telegram/out/image-storage-status.json')),
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
  allowedChatIds: allowedChatConfig.ids,
  allowAllChats: allowedChatConfig.allowAll
};
const notifyOnStart = String(process.env.TELEGRAM_NOTIFY_ON_START || '').trim().toLowerCase() === 'true';
const notifyChatId = Number(process.env.TELEGRAM_NOTIFY_CHAT_ID || 0);
const adminChatIds = String(process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
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
let runtimeLogStore = null;
let runtimeLogStoreMode = 'unknown';
let blacklistStoreMode = 'unknown';
let knownUsersStoreMode = 'unknown';
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};
let runtimeLogConsoleTeeInstalled = false;
const rawSendMessage = api.sendMessage.bind(api);
const jobTimeoutMs = Math.max(100, Number(process.env.RENDER_BOT_JOB_TIMEOUT_MS || 300000));
const processedUpdates = new Map();
const processedUpdatesTtlMs = Math.max(60000, Number(process.env.RENDER_BOT_UPDATE_TTL_MS || 900000));
let coldStartNoticePending = true;
let crashStore;
let crashStoreMode = 'unknown';
const localCrashLogDir = path.resolve(process.env.RENDER_BOT_LOCAL_CRASH_DIR || path.join(repoRoot, 'crash_log'));
const BOT_PROCESS_START_TIME = new Date().toISOString();
const BOT_TEST_MODE = String(process.env.RENDER_BOT_TEST_MODE || process.env.RENDER_BOT_FAKE_GENERATOR || '')
  .trim()
  .toLowerCase() === 'true';
const BOT_RAW_VERSION = String(
  process.env.RENDER_BOT_VERSION
  || (packageJson && packageJson.version ? packageJson.version : '0.0.0')
);
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
    logsDir: process.env.RENDER_BOT_CRASH_LOG_DIR || 'telegram/data/crash-logs',
    latestPath: process.env.RENDER_BOT_CRASH_LOG_LATEST || 'telegram/data/crash-logs/latest.json'
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

function sanitizeCrashValue(value, sensitiveValues) {
  if (value == null) return value;
  if (typeof value === 'string') {
    const clipped = value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
    return redactSensitiveText(clipped, sensitiveValues);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((v) => sanitizeCrashValue(v, sensitiveValues));
  }
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 80).forEach(([k, v]) => {
      out[k] = sanitizeCrashValue(v, sensitiveValues);
    });
    return out;
  }
  return String(value);
}

function writeLocalCrashDiagnostics(payload) {
  try {
    fs.mkdirSync(localCrashLogDir, { recursive: true });
    const ts = String(payload?.timestamp || new Date().toISOString());
    const safeTs = ts.replace(/[:.]/g, '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    const filePath = path.join(localCrashLogDir, `${safeTs}-${suffix}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    const latestPath = path.join(localCrashLogDir, 'latest.json');
    fs.writeFileSync(latestPath, JSON.stringify({ filePath, timestamp: ts, event: payload?.event || 'unknown' }, null, 2), 'utf8');
    const linePath = path.join(localCrashLogDir, 'events.log');
    const line = `${ts} | ${String(payload?.event || 'unknown')} | ${String(payload?.error?.message || '').replace(/\s+/g, ' ').slice(0, 600)}\n`;
    fs.appendFileSync(linePath, line, 'utf8');
  } catch (localError) {
    console.error('[render-bot] failed to write local crash diagnostics:', localError && localError.message ? localError.message : String(localError));
  }
}

async function persistCrash(event, errorLike, context = {}) {
  const sensitiveValues = collectSensitiveValues(0);
  const error = sanitizeCrashValue(normalizeErrorPayload(errorLike), sensitiveValues);
  const safeContext = sanitizeCrashValue(context || {}, sensitiveValues);
  const payload = {
    event: String(event || 'unknown'),
    pid: process.pid,
    crashStoreMode,
    node: process.version,
    cwd: process.cwd(),
    platform: process.platform,
    uptimeSec: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    error,
    context: safeContext
  };
  writeLocalCrashDiagnostics(payload);
  if (!crashStore || typeof crashStore.appendCrash !== 'function') return;
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

function formatConsoleArgs(args) {
  return (Array.isArray(args) ? args : [])
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item instanceof Error) {
        return item.stack || item.message || String(item);
      }
      try {
        return JSON.stringify(item);
      } catch (_) {
        return String(item);
      }
    })
    .join(' ');
}

function installRuntimeLogConsoleTee() {
  if (runtimeLogConsoleTeeInstalled) return;
  if (!runtimeLogStore || typeof runtimeLogStore.append !== 'function') return;
  runtimeLogConsoleTeeInstalled = true;
  const makeTee = (level, originalFn) => (...args) => {
    originalFn(...args);
    try {
      const text = formatConsoleArgs(args);
      const redacted = redactSensitiveText(text, collectSensitiveValues(0));
      runtimeLogStore.append({
        timestamp: new Date().toISOString(),
        level,
        event: 'console',
        message: String(redacted || '').slice(0, 8000)
      });
    } catch (_) {}
  };
  console.log = makeTee('info', originalConsole.log);
  console.warn = makeTee('warn', originalConsole.warn);
  console.error = makeTee('error', originalConsole.error);
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

async function notifyAdmins(text) {
  const targets = Array.from(new Set((adminChatIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  for (const id of targets) {
    await safeNotifyUser(id, text);
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
      { label: 'configStore.recordInteraction', run: () => configStore.recordInteraction(chatId, payload) }
    ];
    if (requestLogStore && typeof requestLogStore.append === 'function') {
      tasks.push({ label: 'requestLogStore.append', run: () => requestLogStore.append({
        chatId: Number(chatId || 0),
        user: {
          id: Number(userMeta?.id || chatId || 0),
          username: String(userMeta?.username || '').trim()
        },
        ...requestPayload,
        metadata
      }) });
    }
    const settled = await Promise.allSettled(tasks.map((t) => t.run()));
    settled.forEach((result, idx) => {
      const taskLabel = String(tasks[idx]?.label || `task-${idx}`);
      if (result.status === 'rejected') {
        const reason = result.reason && result.reason.message ? result.reason.message : String(result.reason || '');
        console.error(`[render-bot] interaction persistence failed: ${taskLabel}: ${reason}`);
      } else if (taskLabel === 'requestLogStore.append') {
        const key = String(result.value && result.value.key ? result.value.key : '').trim();
        if (key) {
          console.log(`[render-bot] interaction logged to request store: ${key}`);
        }
      }
    });
  } catch (error) {
    console.error('[render-bot] recordInteraction failed:', error && error.message ? error.message : String(error));
  }
}

function runBackgroundTask(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((error) => {
      console.error(`[render-bot] ${label} failed:`, error && error.message ? error.message : String(error));
      persistCrash('backgroundTaskError', error, { label }).catch(() => {});
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
const SECRET_KEY_ALIAS_LIST = ['CLOUDFLARE_WORKERS_AI_TOKEN', 'LLAMAPARSE_API_KEY', 'HUGGINGFACE_API_KEY'];
const SUPPORTED_SECRET_KEYS_FOR_COMMANDS = [...new Set([...SECRET_KEYS, ...SECRET_KEY_ALIAS_LIST])];

const VENDOR_ROLE_ALIASES = {
  text: 'text',
  txt: 'text',
  image: 'image',
  img: 'image',
  url: 'url',
  web: 'url',
  page: 'url',
  extractor: 'url',
  pdf: 'pdf',
  pdf_extractor: 'pdf',
  image_extract: 'image_extract',
  image_extractor: 'image_extract',
  vision_extract: 'image_extract',
  voice: 'voice',
  audio: 'voice',
  voice_extractor: 'voice',
  enrich: 'enrich',
  enrichment: 'enrich',
  enrich_fallback: 'enrich_fallback',
  enrichment_fallback: 'enrich_fallback'
};

const VENDOR_ROLE_REQUIRED_KEYS = {
  url: {
    gemini: ['GEMINI_API_KEY'],
    firecrawl: ['FIRECRAWL_API_KEY'],
    jina: ['JINA_API_KEY'],
    diffbot: ['DRIFTBOT_API_KEY'],
    driftbot: ['DRIFTBOT_API_KEY'],
    chromium: []
  },
  pdf: {
    llamaparse: ['LLAMA_CLOUD_API_KEY'],
    unstructured: ['UNSTRUCTURED_API_KEY']
  },
  image_extract: {
    gemini: ['GEMINI_API_KEY'],
    openai: ['OPENAI_API_KEY']
  },
  voice: {
    assemblyai: ['ASSEMBLYAI_API_KEY']
  },
  enrich: {
    wikipedia: [],
    wikidata: [],
    dbpedia: [],
    gdelt: [],
    googlekg: ['GOOGLE_KG_API_KEY'],
    jina: ['JINA_API_KEY'],
    firecrawl: ['FIRECRAWL_API_KEY'],
    brave: ['BRAVE_SEARCH_API_KEY'],
    tavily: ['TAVILY_API_KEY'],
    exa: ['EXA_API_KEY'],
    serper: ['SERPER_API_KEY'],
    serpapi: ['SERPAPI_API_KEY'],
    diffbot: ['DRIFTBOT_API_KEY'],
    driftbot: ['DRIFTBOT_API_KEY'],
    gemini: ['GEMINI_API_KEY']
  },
  enrich_fallback: {
    wikipedia: [],
    wikidata: [],
    dbpedia: [],
    gdelt: [],
    googlekg: ['GOOGLE_KG_API_KEY'],
    jina: ['JINA_API_KEY'],
    firecrawl: ['FIRECRAWL_API_KEY'],
    brave: ['BRAVE_SEARCH_API_KEY'],
    tavily: ['TAVILY_API_KEY'],
    exa: ['EXA_API_KEY'],
    serper: ['SERPER_API_KEY'],
    serpapi: ['SERPAPI_API_KEY'],
    diffbot: ['DRIFTBOT_API_KEY'],
    driftbot: ['DRIFTBOT_API_KEY'],
    gemini: ['GEMINI_API_KEY']
  }
};

const PROVIDER_ROTATION_META_KEY = 'provider_rotation_state_v1';
const PROVIDER_ROTATION_PRIORITY = {
  text: ['gemini', 'cloudflare', 'openai', 'groq', 'cohere', 'openrouter', 'huggingface'],
  image: ['gemini', 'cloudflare', 'openai', 'openrouter', 'huggingface']
};

function parseProviderRotationState(raw) {
  const value = String(raw || '').trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getProviderRotationState() {
  return parseProviderRotationState(configStore.getMeta(PROVIDER_ROTATION_META_KEY));
}

async function saveProviderRotationState(state) {
  const safe = state && typeof state === 'object' ? state : {};
  await configStore.setMetaValue(PROVIDER_ROTATION_META_KEY, JSON.stringify(safe));
}

function getProviderRotationOrder(role) {
  const key = String(role || '').trim().toLowerCase();
  const list = Array.isArray(PROVIDER_ROTATION_PRIORITY[key]) ? PROVIDER_ROTATION_PRIORITY[key] : [];
  return list.filter((provider, idx, arr) => provider && arr.indexOf(provider) === idx);
}

function isProviderUsableForRole(chatId, role, provider) {
  const key = String(role || '').trim().toLowerCase();
  const name = String(provider || '').trim().toLowerCase();
  if (!key || !name) return false;
  const model = String((PROVIDER_DEFAULT_MODELS[name] || {})[key] || '').trim();
  if (!model) return false;
  const missing = getMissingProviderKeys(chatId, name);
  return missing.length === 0;
}

function resolveProviderModel(role, provider) {
  const key = String(role || '').trim().toLowerCase();
  const name = String(provider || '').trim().toLowerCase();
  return String((PROVIDER_DEFAULT_MODELS[name] || {})[key] || '').trim();
}

function resolveRoleSelectionFromState(chatId, role, currentConfig, state) {
  const key = String(role || '').trim().toLowerCase();
  const baseProvider = String(currentConfig?.providers?.[key]?.provider || '').trim().toLowerCase();
  const baseModel = String(currentConfig?.providers?.[key]?.model || '').trim();
  const order = getProviderRotationOrder(key);
  const preferred = String(state?.[key]?.provider || '').trim().toLowerCase();

  const candidates = [
    preferred,
    baseProvider,
    ...order
  ].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

  for (const provider of candidates) {
    if (!isProviderUsableForRole(chatId, key, provider)) continue;
    const model = resolveProviderModel(key, provider) || baseModel;
    if (!model) continue;
    return { provider, model };
  }

  if (baseProvider && baseModel) return { provider: baseProvider, model: baseModel };
  for (const provider of order) {
    const model = resolveProviderModel(key, provider);
    if (!provider || !model) continue;
    return { provider, model };
  }
  const emergencyProvider = 'gemini';
  return {
    provider: emergencyProvider,
    model: resolveProviderModel(key, emergencyProvider) || ''
  };
}

function applyProviderRotationToConfig(chatId, config, state) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (!next.providers || typeof next.providers !== 'object') next.providers = {};
  if (!next.providers.text || typeof next.providers.text !== 'object') next.providers.text = {};
  if (!next.providers.image || typeof next.providers.image !== 'object') next.providers.image = {};

  const textSel = resolveRoleSelectionFromState(chatId, 'text', next, state);
  const imageSel = resolveRoleSelectionFromState(chatId, 'image', next, state);
  if (textSel.provider) {
    next.providers.text.provider = textSel.provider;
    next.providers.text.model = textSel.model;
  }
  if (imageSel.provider) {
    next.providers.image.provider = imageSel.provider;
    next.providers.image.model = imageSel.model;
  }
  return {
    config: next,
    selected: {
      text: textSel,
      image: imageSel
    }
  };
}

async function writeRotatedEffectiveConfigFile(chatId, outPath) {
  const effective = configStore.getEffectiveConfig(chatId);
  const state = getProviderRotationState();
  const rotated = applyProviderRotationToConfig(chatId, effective, state);
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, yaml.dump(rotated.config, { lineWidth: 140 }), 'utf8');
  return {
    configPath: resolved,
    config: rotated.config,
    selected: rotated.selected
  };
}

async function persistRotationSuccess(selected) {
  const current = getProviderRotationState();
  const now = new Date().toISOString();
  const next = { ...current };
  const textSel = selected && selected.text ? selected.text : null;
  const imageSel = selected && selected.image ? selected.image : null;
  if (textSel && textSel.provider && textSel.model) {
    next.text = { provider: textSel.provider, model: textSel.model, updatedAt: now };
  }
  if (imageSel && imageSel.provider && imageSel.model) {
    next.image = { provider: imageSel.provider, model: imageSel.model, updatedAt: now };
  }
  await saveProviderRotationState(next);
}

function inferFailedProviderRole(errorLike) {
  const msg = String(errorLike?.message || errorLike || '').toLowerCase();
  if (!msg) return '';
  if (msg.includes('panel image') || msg.includes('image provider') || msg.includes('image generation')) return 'image';
  if (
    msg.includes('storyboard generation')
    || msg.includes('story invention')
    || msg.includes('text provider')
    || msg.includes('text generation')
  ) return 'text';
  return '';
}

async function advanceProviderRotation(chatId, role, failedSelection) {
  const key = String(role || '').trim().toLowerCase();
  if (key !== 'text' && key !== 'image') return null;
  const failedProvider = String(failedSelection?.provider || '').trim().toLowerCase();
  const order = getProviderRotationOrder(key);
  if (!failedProvider || !order.length) return null;
  const idx = order.indexOf(failedProvider);
  if (idx < 0) return null;

  for (let i = idx + 1; i < order.length; i += 1) {
    const candidate = order[i];
    if (!isProviderUsableForRole(chatId, key, candidate)) continue;
    const model = resolveProviderModel(key, candidate);
    if (!model) continue;
    const state = getProviderRotationState();
    const now = new Date().toISOString();
    const next = {
      ...state,
      [key]: {
        provider: candidate,
        model,
        updatedAt: now,
        reason: `failover_from_${failedProvider}`
      }
    };
    await saveProviderRotationState(next);
    return { role: key, from: failedProvider, to: candidate, model };
  }
  return null;
}

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
  if (runtime.allowAllChats || !runtime.allowedChatIds.length) return true;
  return runtime.allowedChatIds.includes(Number(chatId));
}

function splitCommand(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  return parts;
}

function deepCloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function snapshotConfigStoreState() {
  if (!configStore || typeof configStore !== 'object') return null;
  return deepCloneJson(configStore.state || {});
}

function flattenObjectForDiff(value, prefix = '', out = new Map()) {
  const key = String(prefix || '').trim();
  if (value == null || typeof value !== 'object') {
    out.set(key, value);
    return out;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      out.set(key, []);
      return out;
    }
    value.forEach((item, idx) => {
      const next = key ? `${key}[${idx}]` : `[${idx}]`;
      flattenObjectForDiff(item, next, out);
    });
    return out;
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    out.set(key, {});
    return out;
  }
  keys.sort().forEach((k) => {
    const next = key ? `${key}.${k}` : k;
    flattenObjectForDiff(value[k], next, out);
  });
  return out;
}

function formatDiffValue(pathKey, value) {
  const p = String(pathKey || '').toLowerCase();
  const hasSecretWord = p.includes('.secrets.') || p.endsWith('.secrets') || p.includes('telegram_bot_token') || p.includes('webhook_secret');
  const hasSecretKey = SECRET_KEYS.some((k) => p.includes(String(k || '').toLowerCase()));
  if (hasSecretWord || hasSecretKey) return '<redacted>';
  if (value == null) return 'null';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[len=${value.length}]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}

function summarizeStateChanges(beforeState, afterState, limit = 8, options = {}) {
  if (!beforeState || !afterState) return { total: 0, lines: [] };
  const scopePrefixes = Array.isArray(options.scopePrefixes)
    ? options.scopePrefixes.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  const ignoreMatchers = Array.isArray(options.ignoreMatchers)
    ? options.ignoreMatchers.filter(Boolean)
    : [];
  const isIgnored = (pathKey) => ignoreMatchers.some((m) => {
    if (!m) return false;
    if (typeof m === 'function') return Boolean(m(pathKey));
    if (m instanceof RegExp) return m.test(pathKey);
    return false;
  });
  const isInScope = (pathKey) => {
    if (!scopePrefixes.length) return true;
    return scopePrefixes.some((prefix) => pathKey === prefix || pathKey.startsWith(`${prefix}.`) || pathKey.startsWith(`${prefix}[`));
  };
  const before = flattenObjectForDiff(beforeState);
  const after = flattenObjectForDiff(afterState);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed = [];
  keys.forEach((k) => {
    if (!isInScope(k)) return;
    if (isIgnored(k)) return;
    const a = before.get(k);
    const b = after.get(k);
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(k);
  });
  changed.sort();
  const lines = changed.slice(0, Math.max(1, limit)).map((k) => {
    const prev = formatDiffValue(k, before.get(k));
    const next = formatDiffValue(k, after.get(k));
    const pathLabel = String(k || '(root)');
    return `- ${pathLabel}: ${prev} -> ${next}`;
  });
  return { total: changed.length, lines };
}

async function sendCommandChangeConfirmation(chatId, beforeState) {
  try {
    const afterState = snapshotConfigStoreState();
    const numericChatId = Number(chatId || 0);
    const scopePrefixes = isAdminChat(numericChatId) ? [] : [`users.${numericChatId}.overrides`];
    const ignoreMatchers = [
      /^knownUsers\./i,
      /^meta\./i,
      /\.(firstSeenAt|lastSeenAt|updatedAt)$/i
    ];
    const diff = summarizeStateChanges(beforeState, afterState, 8, { scopePrefixes, ignoreMatchers });
    if (!diff.total) {
      await api.sendMessage(chatId, 'Confirmed changes: none.');
      return;
    }
    const more = diff.total > diff.lines.length ? `\n- ... and ${diff.total - diff.lines.length} more change(s)` : '';
    await api.sendMessage(chatId, `Confirmed changes (${diff.total}):\n${diff.lines.join('\n')}${more}`);
  } catch (_) {
    await safeNotifyUser(chatId, 'Confirmed changes: unavailable.');
  }
}

function classifyIncoming(text) {
  const t = String(text || '').trim();
  if (!t) return { kind: 'empty', command: '' };
  if (t.startsWith('/')) return { kind: 'command', command: t.split(/\s+/)[0].toLowerCase() };
  if (classifyMessageInput(t).kind === 'url') return { kind: 'url', command: '' };
  return { kind: 'text', command: '' };
}

function logRuntimeEvent(level, event, payload = {}) {
  const lvl = String(level || 'info').trim().toLowerCase();
  const eventName = String(event || 'runtime_event').trim();
  const body = payload && typeof payload === 'object' ? payload : { value: String(payload || '') };
  const msg = JSON.stringify({ event: eventName, ...body });
  if (lvl === 'error') console.error('[render-bot:event]', msg);
  else if (lvl === 'warn') console.warn('[render-bot:event]', msg);
  else console.log('[render-bot:event]', msg);
  if (runtimeLogStore && typeof runtimeLogStore.append === 'function') {
    try {
      runtimeLogStore.append({
        timestamp: new Date().toISOString(),
        level: lvl,
        event: eventName,
        message: redactSensitiveText(msg, collectSensitiveValues(0)).slice(0, 8000)
      });
    } catch (_) {}
  }
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

function classifyProviderRotationReason(errorLike) {
  const msg = String(errorLike?.message || errorLike || '').trim().toLowerCase();
  if (!msg) return '';
  if (
    msg.includes('rate limit')
    || msg.includes('quota')
    || msg.includes('rpd')
    || msg.includes('429')
    || msg.includes('too many requests')
  ) return 'rate_limit';
  if (
    msg.includes('unauthorized')
    || msg.includes('authentication')
    || msg.includes('forbidden')
    || msg.includes('invalid api key')
    || msg.includes('missing ')
    || msg.includes('401')
    || msg.includes('403')
  ) return 'auth';
  if (
    msg.includes('timeout')
    || msg.includes('timed out')
    || msg.includes('etimedout')
    || msg.includes('econnreset')
    || msg.includes('abort')
  ) return 'timeout';
  if (
    msg.includes('model')
    || msg.includes('unsupported')
    || msg.includes('not found')
    || msg.includes('404')
  ) return 'model';
  if (
    msg.includes('503')
    || msg.includes('502')
    || msg.includes('500')
    || msg.includes('service unavailable')
    || msg.includes('gateway')
  ) return 'provider';
  return 'provider';
}

function formatProviderRotationRetryMessage(role, fromProvider, toProvider, errorLike) {
  const roleText = String(role || 'text').trim();
  const fromText = String(fromProvider || 'unknown').trim();
  const toText = String(toProvider || 'unknown').trim();
  const reason = classifyProviderRotationReason(errorLike);
  const suffix = reason ? ` Reason: ${reason}.` : '';
  return `Provider rotated for ${roleText}: ${fromText} -> ${toText}. Retrying...${suffix}`;
}

function formatExtractorFallbackMessage(info) {
  const from = String(info?.from || 'unknown').trim();
  const to = String(info?.to || 'chromium').trim();
  return `URL extractor issue detected. Switched from ${from} to ${to}.`;
}

function formatPdfExtractorFallbackMessage(info) {
  const from = String(info?.from || 'unknown').trim();
  const to = String(info?.to || 'llamaparse').trim();
  return `PDF extractor issue detected. Switched from ${from} to ${to}.`;
}

function formatImageExtractorFallbackMessage(info) {
  const from = String(info?.from || 'unknown').trim();
  const to = String(info?.to || 'gemini').trim();
  return `Image extractor issue detected. Switched from ${from} to ${to}.`;
}

function formatEnrichmentMessage(info) {
  const selected = String(info?.selectedProvider || '').trim();
  const used = String(info?.usedProvider || '').trim();
  const count = Number(info?.contextItems || 0);
  if (!selected) return '';
  if (used) {
    if (selected !== used) {
      return `Short-prompt enrichment: switched ${selected} -> ${used} (${count} context items).`;
    }
    return `Short-prompt enrichment: ${used} (${count} context items).`;
  }
  const reason = String(info?.reason || 'no_context').trim();
  return `Short-prompt enrichment unavailable (${selected}): ${reason}. Using original prompt.`;
}

function isShortTextPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return t.length <= SHORT_STORY_PROMPT_MAX_CHARS;
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

function isFakeGeneratorMode() {
  return String(process.env.RENDER_BOT_FAKE_GENERATOR || '').trim().toLowerCase() === 'true';
}

function sanitizeSummaryText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => line && !/^#{1,6}\s+/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function summarizeHeuristically(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!sentences.length) return cleaned.slice(0, 2200);
  return sentences.slice(0, Math.min(10, sentences.length)).join(' ').trim();
}

function buildKeyPointsSummaryPrompt(sourceText, cfg = {}) {
  const objective = String(cfg?.generation?.objective || 'explain-like-im-five').trim();
  const language = String(cfg?.generation?.output_language || 'auto').trim();
  const detail = String(cfg?.generation?.detail_level || 'low').trim();
  const source = String(sourceText || '').trim();
  const capped = source.length > 12000 ? `${source.slice(0, 12000)}\n...[truncated]` : source;
  return [
    'Summarize the extracted content into concise key points for comic storyboard generation.',
    'Return plain text only (no JSON, no markdown, no bullet list markers).',
    'Keep factual grounding and chronological coherence.',
    `Objective: ${objective}`,
    `Output language: ${language}`,
    `Detail level: ${detail}`,
    '',
    'Extracted content:',
    capped
  ].join('\n');
}

async function summarizeExtractedForStoryboard(sourceText, effectiveConfig, effectiveConfigPath, options = {}) {
  const source = String(sourceText || '').trim();
  if (!source) throw new Error('Cannot summarize empty extracted text');

  if (isFakeGeneratorMode()) {
    const local = sanitizeSummaryText(summarizeHeuristically(source));
    const finalText = local || source;
    return {
      text: finalText,
      method: 'heuristic',
      sourceChars: source.length,
      summaryChars: finalText.length,
      reason: ''
    };
  }

  const provider = String(effectiveConfig?.providers?.text?.provider || 'gemini').trim();
  const model = String(effectiveConfig?.providers?.text?.model || '').trim();
  const prompt = buildKeyPointsSummaryPrompt(source, effectiveConfig);
  const raw = await generateTextWithProvider(provider, model, prompt, {
    temperature: 0.2,
    maxOutputTokens: 1800
  });
  let summary = sanitizeSummaryText(raw);
  let method = 'llm';
  let reason = '';

  if (summary.length < SUMMARY_MIN_CHARS) {
    try {
      const invented = await inventStoryText(summary || source, effectiveConfigPath, {
        onFallback: options.onFallback,
        onEnrichment: options.onEnrichment
      });
      const improved = sanitizeSummaryText(invented);
      if (improved.length >= SUMMARY_MIN_CHARS) {
        summary = improved;
        method = 'invent_fallback';
      } else {
        summary = source;
        method = 'source_fallback';
        reason = 'invented_summary_too_short';
      }
    } catch (error) {
      summary = source;
      method = 'source_fallback';
      reason = String(error?.message || error).slice(0, 220);
    }
  }

  return {
    text: summary,
    method,
    sourceChars: source.length,
    summaryChars: String(summary || '').length,
    reason
  };
}

function isAdminChat(chatId) {
  return adminChatIds.includes(Number(chatId));
}

function commandHelp(chatId) {
  const objectiveShortcutLines = Object.entries(OBJECTIVE_SHORTCUTS)
    .map(([cmd, objective]) => `${cmd} - set objective to ${objective}.`);
  const styleShortcutLines = Object.keys(STYLE_PRESETS).map((name) => `/${name} - quick style shortcut (${name}).`);
  return buildHelpMessage(chatId, {
    isAdmin: isAdminChat(chatId),
    objectiveShortcutLines,
    styleShortcutLines
  });
}

function onboardingDefaults(chatId) {
  const cfg = configStore.getEffectiveConfig(chatId);
  return {
    textProvider: String(cfg?.providers?.text?.provider || 'gemini').trim().toLowerCase(),
    textModel: String(cfg?.providers?.text?.model || '').trim(),
    imageProvider: String(cfg?.providers?.image?.provider || 'gemini').trim().toLowerCase(),
    imageModel: String(cfg?.providers?.image?.model || '').trim(),
    extractor: normalizeUrlExtractor(cfg?.generation?.url_extractor || 'jina'),
    pdfExtractor: normalizePdfExtractor(cfg?.generation?.pdf_extractor || 'llamaparse'),
    imageExtractor: normalizeImageExtractor(cfg?.generation?.image_extractor || 'gemini'),
    voiceExtractor: normalizeVoiceExtractor(cfg?.generation?.voice_extractor || 'assemblyai'),
    enrichmentProvider: String(cfg?.generation?.enrichment_provider || 'wikipedia').trim().toLowerCase(),
    enrichmentFallback: String(cfg?.generation?.enrichment_fallback_provider || 'gemini').trim().toLowerCase()
  };
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

function resolveObjectiveMetaFromConfig(cfg) {
  const objective = String(cfg?.generation?.objective || 'summarize').trim().toLowerCase();
  const known = getObjectiveMeta(objective);
  return {
    id: objective,
    name: String(cfg?.generation?.objective_name || known.name || objective).trim(),
    description: String(cfg?.generation?.objective_description || known.description || '').trim()
  };
}

function resolveStyleMetaFromConfig(cfg) {
  const configuredName = String(cfg?.generation?.style_name || '').trim();
  const configuredDesc = String(cfg?.generation?.style_description || cfg?.generation?.style_prompt || '').trim();
  if (configuredName && configuredDesc) {
    return {
      id: normalizeStyleName(configuredName),
      name: configuredName,
      description: configuredDesc
    };
  }

  const stylePrompt = String(cfg?.generation?.style_prompt || '').trim();
  for (const [id, presetPrompt] of Object.entries(STYLE_PRESETS)) {
    if (String(presetPrompt || '').trim() === stylePrompt) {
      const meta = getStyleMeta(id);
      return {
        id,
        name: meta.name || id,
        description: meta.description || stylePrompt
      };
    }
  }
  return {
    id: 'custom',
    name: configuredName || 'custom',
    description: configuredDesc || stylePrompt
  };
}

function normalizeCommandToken(rawToken) {
  const token = String(rawToken || '').trim().toLowerCase();
  if (!token.startsWith('/')) return token;
  const at = token.indexOf('@');
  if (at > 0) return token.slice(0, at);
  return token;
}

function getLegacyVendorAliasInfo(command) {
  const cmd = String(command || '').trim().toLowerCase();
  if (cmd === '/text_vendor') return { role: 'text', hint: 'Tip: use /vendor text <name>' };
  if (cmd === '/image_vendor') return { role: 'image', hint: 'Tip: use /vendor image <name>' };
  if (cmd === '/extractor' || cmd === '/exractor') return { role: 'url', hint: 'Tip: use /vendor url <name>' };
  if (cmd === '/pdf_extractor' || cmd === '/pdfextractor') return { role: 'pdf', hint: 'Tip: use /vendor pdf <name>' };
  if (cmd === '/image_extractor' || cmd === '/imageextractor') return { role: 'image_extract', hint: 'Tip: use /vendor image_extract <name>' };
  if (cmd === '/voice_extractor' || cmd === '/voiceextractor') return { role: 'voice', hint: 'Tip: use /vendor voice <name>' };
  return null;
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

function resolveExtractorModelSpec(chatId, target) {
  const role = String(target || '').trim().toLowerCase();
  if (role === 'url') {
    const vendor = String(configStore.getCurrent(chatId, 'generation.url_extractor') || '').trim().toLowerCase();
    if (vendor !== 'gemini') return null;
    return {
      role,
      label: 'URL extraction',
      vendor,
      path: 'generation.url_extractor_gemini_model',
      optionsPath: 'generation.url_extractor_gemini_model'
    };
  }
  if (role === 'image_extract') {
    const vendor = String(configStore.getCurrent(chatId, 'generation.image_extractor') || '').trim().toLowerCase();
    if (vendor === 'gemini') {
      return {
        role,
        label: 'Image story extraction',
        vendor,
        path: 'generation.image_extractor_gemini_model',
        optionsPath: 'generation.image_extractor_gemini_model'
      };
    }
    if (vendor === 'openai') {
      return {
        role,
        label: 'Image story extraction',
        vendor,
        path: 'generation.image_extractor_openai_model',
        optionsPath: 'generation.image_extractor_openai_model'
      };
    }
    return null;
  }
  if (role === 'pdf') {
    const vendor = String(configStore.getCurrent(chatId, 'generation.pdf_extractor') || '').trim().toLowerCase();
    if (vendor === 'unstructured') {
      return {
        role,
        label: 'PDF extraction',
        vendor,
        path: 'generation.pdf_extractor_unstructured_strategy',
        optionsPath: 'generation.pdf_extractor_unstructured_strategy'
      };
    }
    return null;
  }
  if (role === 'voice') {
    const vendor = String(configStore.getCurrent(chatId, 'generation.voice_extractor') || '').trim().toLowerCase();
    if (vendor === 'assemblyai') {
      return {
        role,
        label: 'Voice extraction',
        vendor,
        path: 'generation.voice_extractor_assemblyai_model',
        optionsPath: 'generation.voice_extractor_assemblyai_model'
      };
    }
    return null;
  }
  return null;
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

  const normalizedTarget = String(target || '').trim().toLowerCase();
  const includeText = !normalizedTarget || normalizedTarget === 'text';
  const includeImage = !normalizedTarget || normalizedTarget === 'image';
  if (includeText) {
    const models = listModelsForProvider(textProvider, 'text', textModel);
    lines.push(`Text models for ${textProvider || '-'}: ${models.length ? models.join(', ') : 'none'}`);
  }
  if (includeImage) {
    const models = listModelsForProvider(imageProvider, 'image', imageModel);
    lines.push(`Image models for ${imageProvider || '-'}: ${models.length ? models.join(', ') : 'none'}`);
  }
  const extractorTargets = ['url', 'image_extract', 'pdf', 'voice'];
  extractorTargets.forEach((role) => {
    if (normalizedTarget && normalizedTarget !== role) return;
    const spec = resolveExtractorModelSpec(chatId, role);
    if (!spec) {
      if (!normalizedTarget) {
        lines.push(`${role} model controls: not available for current vendor.`);
      }
      return;
    }
    const current = String(configStore.getCurrent(chatId, spec.path) || '').trim();
    const options = getOptions(spec.optionsPath);
    lines.push(`${spec.label} (${spec.vendor}) model config [${spec.path}]: current=${current || '-'}; allowed=${options.join(', ') || 'none'}`);
  });
  lines.push('');
  lines.push('Usage: /models');
  lines.push('Usage: /models text <model>');
  lines.push('Usage: /models image <model>');
  lines.push('Usage: /models url <model>');
  lines.push('Usage: /models image_extract <model>');
  lines.push('Usage: /models pdf <model>');
  lines.push('Usage: /models voice <model>');
  return lines.join('\n');
}

function shortenProbeError(errorLike) {
  const raw = String(errorLike?.message || errorLike || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'unknown error';
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}

function getProbeTargets() {
  const out = [];
  const providerSet = new Set([
    ...Object.keys(PROVIDER_MODEL_CATALOG || {}),
    ...PROVIDER_TEXT_NAMES,
    ...PROVIDER_IMAGE_NAMES
  ]);
  for (const provider of providerSet) {
    const section = PROVIDER_MODEL_CATALOG[provider] || {};
    const textModels = Array.isArray(section.text) ? section.text : [];
    const imageModels = Array.isArray(section.image) ? section.image : [];
    textModels.forEach((model) => out.push({ provider, kind: 'text', model: String(model || '').trim() }));
    imageModels.forEach((model) => out.push({ provider, kind: 'image', model: String(model || '').trim() }));
  }
  return out.filter((row) => row.model);
}

function createProbeProviderConfig(target) {
  const provider = String(target?.provider || '').trim().toLowerCase();
  const model = String(target?.model || '').trim();
  const cfg = { provider, model };
  if (provider === 'cloudflare') {
    cfg.account_id = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    cfg.api_token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  }
  return cfg;
}

async function runProviderAvailabilityCheck(chatId) {
  configStore.applySecretsToEnv(chatId);
  const lines = ['Availability report:'];
  const targets = getProbeTargets();
  if (BOT_TEST_MODE) {
    for (const target of targets) {
      const missing = getMissingProviderKeys(chatId, target.provider);
      if (missing.length) {
        lines.push(`[SKIP] ${target.provider}/${target.kind}/${target.model} :: missing keys: ${missing.join(', ')}`);
      } else {
        lines.push(`[OK] ${target.provider}/${target.kind}/${target.model} :: test-mode preflight`);
      }
    }
    return lines.join('\n');
  }
  const runtimeConfig = { timeout_ms: 45000 };

  for (const target of targets) {
    const missing = getMissingProviderKeys(chatId, target.provider);
    if (missing.length) {
      lines.push(`[SKIP] ${target.provider}/${target.kind}/${target.model} :: missing keys: ${missing.join(', ')}`);
      continue;
    }
    try {
      const cfg = createProbeProviderConfig(target);
      if (target.kind === 'text') {
        const output = await generateTextWithProvider(cfg, 'health check: return one short line', runtimeConfig);
        const snippet = String(output || '').trim().slice(0, 60);
        lines.push(`[OK] ${target.provider}/${target.kind}/${target.model}${snippet ? ` :: ${snippet}` : ''}`);
      } else {
        const image = await generateImageWithProvider(
          cfg,
          'Generate a simple abstract scene with no text.',
          runtimeConfig
        );
        const bytes = Number(Buffer.isBuffer(image?.buffer) ? image.buffer.length : 0);
        lines.push(`[OK] ${target.provider}/${target.kind}/${target.model} :: bytes=${bytes}`);
      }
    } catch (error) {
      lines.push(`[FAIL] ${target.provider}/${target.kind}/${target.model} :: ${shortenProbeError(error)}`);
    }
  }

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
    throw new Error(`Unknown provider '${providerName}'. Use: ${PROVIDER_NAMES.join(', ')}`);
  }
  if (applyText && !String(defaults.text || '').trim()) {
    throw new Error(`Provider '${providerName}' does not support text generation`);
  }
  if (applyImage && !String(defaults.image || '').trim()) {
    throw new Error(`Provider '${providerName}' does not support image generation`);
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
  return buildOnboardingMessage(chatId, {
    isAdmin: isAdminChat(chatId),
    promptManualUrl: PROMPT_MANUAL_URL,
    defaults: onboardingDefaults(chatId)
  });
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

function parseTelegramRetryAfterSeconds(errorLike) {
  const msg = String(errorLike?.message || errorLike || '');
  const m = msg.match(/retry after\s+(\d+)/i);
  if (!m) return 0;
  const sec = Number(m[1]);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function buildPromptCatalog(cfg) {
  const objectiveMeta = resolveObjectiveMetaFromConfig(cfg);
  const objective = objectiveMeta.id;
  const storyPrompt = buildStoryboardPrompt({
    sourceTitle: '<source title>',
    sourceLabel: '<source label>',
    sourceText: '<source text>',
    panelCount: cfg?.generation?.panel_count ?? '-',
    objective,
    objectiveDescription: objectiveMeta.description,
    stylePrompt: cfg?.generation?.style_prompt || '-',
    outputLanguage: cfg?.generation?.output_language || 'en',
    objectivePromptOverride: cfg?.generation?.objective_prompt_overrides?.[objective],
    customStoryPrompt: cfg?.generation?.custom_story_prompt
  });

  const sampleStoryboard = {
    title: '<storyboard.title>',
    description: '<storyboard.description short summary>',
    panels: [
      { caption: '<panel.caption>', image_prompt: '<panel.image_prompt>' }
    ]
  };
  const samplePanel = sampleStoryboard.panels[0];
  const panelPromptNoRef = buildPanelImagePrompt(
    samplePanel,
    0,
    Number(cfg?.generation?.panel_count || 1),
    cfg?.generation || {},
    sampleStoryboard,
    { hasStyleReferenceImage: false }
  );
  const panelPromptWithRef = buildPanelImagePrompt(
    samplePanel,
    0,
    Number(cfg?.generation?.panel_count || 1),
    cfg?.generation || {},
    sampleStoryboard,
    { hasStyleReferenceImage: true }
  );
  const styleReferencePrompt = buildStyleReferencePrompt(sampleStoryboard, cfg?.generation || {});
  const inventPrompt = buildInventStoryPrompt({ generation: cfg?.generation || {} }, '<seed>');

  const objectives = getOptions('generation.objective');
  const objectiveLines = objectives.map((name) => {
    const meta = getObjectiveMeta(name);
    const override = String(cfg?.generation?.objective_prompt_overrides?.[name] || '').trim();
    const suffix = override ? ` => ${override}` : '';
    const desc = String(meta.description || '').trim();
    return `- ${name}${desc ? `: ${desc}` : ''}${suffix}`;
  });

  return [
    'Prompt catalog',
    '',
    '[Storyboard prompt]',
    storyPrompt,
    '',
    '[Panel image prompt | no style reference image]',
    panelPromptNoRef,
    '',
    '[Panel image prompt | with style reference image]',
    panelPromptWithRef,
    '',
    '[Style reference image prompt (consistency mode)]',
    styleReferencePrompt,
    '',
    '[Story invention prompt]',
    inventPrompt,
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
    `extractor=${normalizeUrlExtractor(cfg?.generation?.url_extractor || 'gemini')}`,
    `pdf_extractor=${normalizePdfExtractor(cfg?.generation?.pdf_extractor || 'llamaparse')}`,
    `image_extractor=${normalizeImageExtractor(cfg?.generation?.image_extractor || 'gemini')}`,
    `voice_extractor=${normalizeVoiceExtractor(cfg?.generation?.voice_extractor || 'assemblyai')}`,
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
    `x:${normalizeUrlExtractor(cfg?.generation?.url_extractor || 'gemini')}`,
    `px:${normalizePdfExtractor(cfg?.generation?.pdf_extractor || 'llamaparse')}`,
    `ix:${normalizeImageExtractor(cfg?.generation?.image_extractor || 'gemini')}`,
    `vx:${normalizeVoiceExtractor(cfg?.generation?.voice_extractor || 'assemblyai')}`,
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
    'x:<url_extractor>',
    'px:<pdf_extractor>',
    'ix:<image_extractor>',
    'vx:<voice_extractor>',
    'd:<detail_level>',
    'c:<image_concurrency>',
    'r:<retries>',
    '',
    'Example:',
    't:gemini/gemini-2.5-flash i:gemini/gemini-2.0-flash-exp-image-generation p:8 o:explain-like-im-five s:classic l:auto m:default x:jina px:llamaparse ix:gemini d:low c:3 r:1'
  ].join('\n');
}

function normalizeVendorRole(rawRole) {
  const key = String(rawRole || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return VENDOR_ROLE_ALIASES[key] || '';
}

function getVendorRoleSpec(role) {
  switch (String(role || '').trim().toLowerCase()) {
    case 'text':
      return { role: 'text', path: 'providers.text.provider', options: PROVIDER_TEXT_NAMES.slice(), label: 'Text generation' };
    case 'image':
      return { role: 'image', path: 'providers.image.provider', options: PROVIDER_IMAGE_NAMES.slice(), label: 'Image generation' };
    case 'url':
      return { role: 'url', path: 'generation.url_extractor', options: getOptions('generation.url_extractor'), label: 'Web page extraction' };
    case 'pdf':
      return { role: 'pdf', path: 'generation.pdf_extractor', options: getOptions('generation.pdf_extractor'), label: 'PDF extraction' };
    case 'image_extract':
      return { role: 'image_extract', path: 'generation.image_extractor', options: getOptions('generation.image_extractor'), label: 'Image story extraction' };
    case 'voice':
      return { role: 'voice', path: 'generation.voice_extractor', options: getOptions('generation.voice_extractor'), label: 'Voice/audio extraction' };
    case 'enrich':
      return { role: 'enrich', path: 'generation.enrichment_provider', options: getOptions('generation.enrichment_provider'), label: 'Short-prompt enrichment' };
    case 'enrich_fallback':
      return { role: 'enrich_fallback', path: 'generation.enrichment_fallback_provider', options: getOptions('generation.enrichment_fallback_provider'), label: 'Enrichment fallback' };
    default:
      return null;
  }
}

function normalizeVendorValueForRole(role, rawVendor) {
  const raw = String(rawVendor || '').trim().toLowerCase();
  if (!raw) return raw;
  switch (role) {
    case 'url':
      return normalizeUrlExtractor(raw);
    case 'pdf':
      return normalizePdfExtractor(raw);
    case 'image_extract':
      return normalizeImageExtractor(raw);
    case 'voice':
      return normalizeVoiceExtractor(raw);
    default:
      return raw;
  }
}

function getMissingSecretsFromList(chatId, requiredKeys) {
  const keys = Array.isArray(requiredKeys) ? requiredKeys : [];
  if (!keys.length) return [];
  const status = configStore.getSecretsStatus(chatId);
  return keys.filter((key) => {
    const statusEntry = status[key];
    if (statusEntry && statusEntry.hasValue) return false;
    if (String(process.env[key] || '').trim()) return false;
    if (key === 'LLAMA_CLOUD_API_KEY' && String(process.env.LLAMAPARSE_API_KEY || '').trim()) return false;
    return true;
  });
}

function getMissingRoleVendorKeys(chatId, role, vendor) {
  const r = String(role || '').trim().toLowerCase();
  const v = String(vendor || '').trim().toLowerCase();
  if (!r || !v) return [];
  if (r === 'text' || r === 'image') return getMissingProviderKeys(chatId, v);
  const required = ((VENDOR_ROLE_REQUIRED_KEYS[r] || {})[v]) || [];
  return getMissingSecretsFromList(chatId, required);
}

function roleVendorProvisioningMessage(role, vendor, missingKeys) {
  const roleName = String(role || '').trim();
  const provider = String(vendor || '').trim().toLowerCase();
  const missing = (Array.isArray(missingKeys) ? missingKeys : []).filter(Boolean);
  const keyLabel = missing.join(', ') || 'provider key';
  return [
    `Vendor switch blocked for ${roleName}: missing ${keyLabel}.`,
    `Provision key(s) first, then retry /vendor ${roleName} ${provider}.`,
    `Manual: ${PROMPT_MANUAL_URL}`
  ].join('\n');
}

function getCurrentVendorForRole(chatId, role) {
  const spec = getVendorRoleSpec(role);
  if (!spec) return '';
  return String(configStore.getCurrent(chatId, spec.path) || '').trim().toLowerCase();
}

function buildVendorOverviewMessage(chatId) {
  const roles = ['text', 'image', 'url', 'pdf', 'image_extract', 'voice', 'enrich', 'enrich_fallback'];
  const lines = [
    'Vendor roles (current):',
    ...roles.map((role) => {
      const spec = getVendorRoleSpec(role);
      const current = getCurrentVendorForRole(chatId, role) || '-';
      return `- ${role}: ${current}${spec ? ` (${spec.label})` : ''}`;
    }),
    '',
    'Usage:',
    '- /vendors',
    '- /vendors <role>',
    '- /vendor <role> <vendor>',
    '- /vendor <vendor>  (quick sets text+image)'
  ];
  return lines.join('\n');
}

function buildVendorRoleDetailsMessage(chatId, role) {
  const spec = getVendorRoleSpec(role);
  if (!spec) {
    return [
      'Usage: /vendors <role>',
      'Allowed roles: text, image, url, pdf, image_extract, voice, enrich, enrich_fallback'
    ].join('\n');
  }
  const current = getCurrentVendorForRole(chatId, role) || '-';
  return [
    `${spec.label} (${role})`,
    `Current: ${current}`,
    `Allowed vendors: ${spec.options.join(', ')}`,
    `Set with: /vendor ${role} <vendor>`
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
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api.sendPhoto(chatId, panel.imagePath, panel.caption || '');
      return;
    } catch (error) {
      last = error;
      if (debugPromptsEnabled) {
        await safeNotifyUser(chatId, `Debug: send panel ${index + 1} attempt ${attempt} failed: ${String(error?.message || error)}`);
      }
      if (attempt < 5) {
        const retryAfterSec = parseTelegramRetryAfterSeconds(error);
        const waitMs = retryAfterSec > 0 ? ((retryAfterSec * 1000) + 250) : (500 * attempt);
        await new Promise((r) => setTimeout(r, waitMs));
      }
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

async function sendMediaGroupWithRetry(chatId, panels, debugPromptsEnabled = false) {
  let last = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api.sendMediaGroup(chatId, panels);
      return;
    } catch (error) {
      last = error;
      if (debugPromptsEnabled) {
        await safeNotifyUser(chatId, `Debug: send media_group attempt ${attempt} failed: ${String(error?.message || error)}`);
      }
      if (attempt < 5) {
        const retryAfterSec = parseTelegramRetryAfterSeconds(error);
        const waitMs = retryAfterSec > 0 ? ((retryAfterSec * 1000) + 250) : (500 * attempt);
        await new Promise((r) => setTimeout(r, waitMs));
      }
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
      outputConfig: {
        ...(cfg?.output || {}),
        layout: 'grid'
      },
      outputPath: outPath
    });
    await sendPanelWithRetry(chatId, { imagePath: outPath, caption: caption.slice(0, 1000) }, 0, false);
  } catch (error) {
    if (debugPromptsEnabled) {
      await safeNotifyUser(chatId, `Debug: single-message compose fallback: ${String(error?.message || error)}`);
    }
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
    await sendMediaGroupWithRetry(chatId, remaining, debugPromptsEnabled);
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

async function replayPeekComic(chatId, history, selected) {
  const rows = listGeneratedRows(history);
  const idx = Number(selected);
  if (!rows.length) {
    await api.sendMessage(chatId, 'No generated comics yet.');
    return;
  }
  if (!Number.isFinite(idx) || idx < 1 || idx > rows.length) {
    await api.sendMessage(chatId, `Invalid comic index. Use /peek, then choose 1-${rows.length}.`);
    return;
  }
  const row = rows[idx - 1];
  const result = row && row.result ? row.result : {};
  const panels = normalizePanelMessages(result.panelMessages || []);
  if (!panels.length) {
    await api.sendMessage(chatId, formatPeekSingleMessage(history, idx));
    return;
  }

  await api.sendMessage(chatId, [
    `Replaying comic ${idx} of ${rows.length}`,
    `date: ${String(row?.timestamp || '-')}`,
    `user: ${resolveHistoryUserLabel(row?.chatId)}`,
    `name: ${formatPeekName(row)}`
  ].join('\n'));

  let sent = 0;
  for (let i = 0; i < panels.length; i += 1) {
    const p = panels[i];
    const imagePath = String(p?.imagePath || '').trim();
    if (!imagePath || !fs.existsSync(imagePath)) continue;
    const caption = String(p?.caption || '').trim();
    await sendPanelWithRetry(chatId, {
      imagePath,
      caption
    }, i, false);
    sent += 1;
  }

  if (sent === 0) {
    await api.sendMessage(chatId, formatPeekSingleMessage(history, idx));
    return;
  }
  await api.sendMessage(chatId, `Replay done: ${sent} panel(s).`);
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
  const peekTokenMatch = command.match(/^\/peek(\d{1,3})$/);
  const logTokenMatch = command.match(/^\/log(\d{1,3})$/);

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
    const bumpedAt = String(process.env.RENDER_BOT_VERSION_BUMPED_AT || '').trim();
    await api.sendMessage(chatId, [
      `version: ${BOT_VERSION}`,
      `bumped: ${bumpedAt || '-'}`,
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
      await replayPeekComic(chatId, configStore.getHistory(), selected);
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

  if (command === '/vendors') {
    const role = normalizeVendorRole(parts[1]);
    if (!parts[1]) {
      await api.sendMessage(chatId, buildVendorOverviewMessage(chatId));
      return true;
    }
    if (!role) {
      await api.sendMessage(chatId, [
        'Usage: /vendors <role>',
        'Allowed roles: text, image, url, pdf, image_extract, voice, enrich, enrich_fallback',
        '',
        buildVendorOverviewMessage(chatId)
      ].join('\n'));
      return true;
    }
    await api.sendMessage(chatId, buildVendorRoleDetailsMessage(chatId, role));
    return true;
  }

  if (
    command === '/vendor'
    || command === '/text_vendor'
    || command === '/image_vendor'
    || command === '/extractor'
    || command === '/exractor'
    || command === '/pdf_extractor'
    || command === '/pdfextractor'
    || command === '/image_extractor'
    || command === '/imageextractor'
    || command === '/voice_extractor'
    || command === '/voiceextractor'
  ) {
    const aliasInfo = getLegacyVendorAliasInfo(command);
    const aliasRole = aliasInfo ? aliasInfo.role : '';

    if (command === '/vendor' && !parts[1]) {
      await api.sendMessage(chatId, buildVendorOverviewMessage(chatId));
      return true;
    }

    let role = aliasRole;
    let vendorRaw = '';

    if (command === '/vendor') {
      const firstArg = String(parts[1] || '').trim().toLowerCase();
      const maybeRole = normalizeVendorRole(firstArg);
      if (maybeRole) {
        role = maybeRole;
        vendorRaw = String(parts[2] || '').trim().toLowerCase();
        if (!vendorRaw) {
          await api.sendMessage(chatId, buildVendorRoleDetailsMessage(chatId, role));
          return true;
        }
      } else {
        // Backward-compatible quick mode: /vendor <provider> sets both text+image providers.
        role = 'all_gen';
        vendorRaw = firstArg;
      }
    } else {
      vendorRaw = String(parts[1] || '').trim().toLowerCase();
      if (!vendorRaw) {
        if (role) {
          await api.sendMessage(chatId, buildVendorRoleDetailsMessage(chatId, role));
          if (aliasInfo && aliasInfo.hint) await api.sendMessage(chatId, aliasInfo.hint);
        } else {
          await api.sendMessage(chatId, buildVendorOverviewMessage(chatId));
        }
        return true;
      }
    }

    if (!role) {
      await api.sendMessage(chatId, buildVendorOverviewMessage(chatId));
      return true;
    }

    try {
      if (role === 'all_gen') {
        const vendor = String(vendorRaw || '').trim().toLowerCase();
        const roleLike = normalizeVendorRole(vendor);
        if (roleLike) {
          await api.sendMessage(chatId, buildVendorRoleDetailsMessage(chatId, roleLike));
          return true;
        }
        if (!valueExists(PROVIDER_NAMES, vendor)) {
          const lines = [
            `Usage: /vendor <${PROVIDER_NAMES.join('|')}>`,
            'Or use role-based mode: /vendor <role> <vendor>',
            `Allowed generation providers: ${PROVIDER_NAMES.join(', ')}`
          ];
          if (aliasInfo && aliasInfo.hint) lines.push(aliasInfo.hint);
          await api.sendMessage(chatId, lines.join('\n'));
          return true;
        }
        const missingKeys = getMissingProviderKeys(chatId, vendor);
        if (missingKeys.length) {
          await api.sendMessage(chatId, providerProvisioningMessage(vendor, missingKeys));
          return true;
        }
        const defaults = await applyProvider(chatId, vendor, true, true);
        await api.sendMessage(chatId, [
          `Provider updated: ${vendor}`,
          `- text model: ${defaults.text}`,
          `- image model: ${defaults.image}`
        ].join('\n'));
        return true;
      }

      const spec = getVendorRoleSpec(role);
      if (!spec) {
        await api.sendMessage(chatId, buildVendorOverviewMessage(chatId));
        return true;
      }
      const vendor = normalizeVendorValueForRole(role, vendorRaw);
      if (!valueExists(spec.options, vendor)) {
        await api.sendMessage(chatId, [
          `Usage: /vendor ${role} <vendor>`,
          `Allowed vendors: ${spec.options.join(', ')}`,
          `Current: ${getCurrentVendorForRole(chatId, role) || '-'}`
        ].join('\n'));
        if (aliasInfo && aliasInfo.hint) await api.sendMessage(chatId, aliasInfo.hint);
        return true;
      }

      if (role === 'text' || role === 'image') {
        const missingKeys = getMissingRoleVendorKeys(chatId, role, vendor);
        if (missingKeys.length) {
          await api.sendMessage(chatId, providerProvisioningMessage(vendor, missingKeys));
          return true;
        }
      }

      if (role === 'text') {
        const defaults = await applyProvider(chatId, vendor, true, false);
        if (command === '/text_vendor') {
          await api.sendMessage(chatId, [
            `Provider updated: ${vendor}`,
            `- text model: ${defaults.text}`
          ].join('\n'));
          if (aliasInfo && aliasInfo.hint) await api.sendMessage(chatId, aliasInfo.hint);
        } else {
          await api.sendMessage(chatId, [
            `Updated ${spec.path} = ${vendor}`,
            `- text model: ${defaults.text}`
          ].join('\n'));
        }
        return true;
      }
      if (role === 'image') {
        const defaults = await applyProvider(chatId, vendor, false, true);
        if (command === '/image_vendor') {
          await api.sendMessage(chatId, [
            `Provider updated: ${vendor}`,
            `- image model: ${defaults.image}`
          ].join('\n'));
          if (aliasInfo && aliasInfo.hint) await api.sendMessage(chatId, aliasInfo.hint);
        } else {
          await api.sendMessage(chatId, [
            `Updated ${spec.path} = ${vendor}`,
            `- image model: ${defaults.image}`
          ].join('\n'));
        }
        return true;
      }

      const updated = await setConfigPathValue(chatId, spec.path, vendor);
      await api.sendMessage(chatId, `Updated ${spec.path} = ${updated}`);
      if (aliasInfo && aliasInfo.hint) await api.sendMessage(chatId, aliasInfo.hint);
    } catch (error) {
      await api.sendMessage(chatId, `Vendor update failed: ${error.message}`);
    }
    return true;
  }

  if (command === '/models') {
    const target = String(parts[1] || '').trim().toLowerCase();
    if (!target) {
      await api.sendMessage(chatId, buildModelsStatusMessage(chatId));
      return true;
    }
    if (!['text', 'image', 'url', 'image_extract', 'pdf', 'voice'].includes(target)) {
      await api.sendMessage(chatId, [
        'Usage: /models [text|image|url|image_extract|pdf|voice] [model]',
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

    let provider = '';
    let modelPath = '';
    let currentModel = '';
    let allowed = [];
    if (target === 'text' || target === 'image') {
      const providerPath = target === 'text' ? 'providers.text.provider' : 'providers.image.provider';
      modelPath = target === 'text' ? 'providers.text.model' : 'providers.image.model';
      provider = String(configStore.getCurrent(chatId, providerPath) || '').trim().toLowerCase();
      currentModel = String(configStore.getCurrent(chatId, modelPath) || '').trim();
      allowed = listModelsForProvider(provider, target, currentModel);
    } else {
      const spec = resolveExtractorModelSpec(chatId, target);
      if (!spec) {
        await api.sendMessage(chatId, `No model selector for ${target} with current vendor. Check /vendors ${target} and /models ${target}.`);
        return true;
      }
      provider = spec.vendor;
      modelPath = spec.path;
      currentModel = String(configStore.getCurrent(chatId, modelPath) || '').trim();
      allowed = getOptions(spec.optionsPath);
      if (currentModel && !allowed.includes(currentModel)) {
        allowed = [currentModel, ...allowed];
      }
    }
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

  if (command === '/test') {
    await api.sendMessage(chatId, 'Running provider/model availability checks...');
    const report = await runProviderAvailabilityCheck(chatId);
    await sendLongMessage(chatId, report);
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

  if (command === '/objective' || command === '/objectives') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.objective');
    const current = String(configStore.getCurrent(chatId, 'generation.objective') || '').trim() || '-';
    if (!value) {
      const currentMeta = getObjectiveMeta(current);
      await api.sendMessage(chatId, [
        'Usage: /objective <name>',
        'Explanation: set storyboard objective.',
        `Current objective: ${current}`,
        `Current description: ${currentMeta.description || '-'}`,
        'Available objectives:',
        options.map((id) => {
          const meta = getObjectiveMeta(id);
          return `${id}${meta.description ? `: ${meta.description}` : ''}`;
        }).join('\n')
      ].join('\n'));
      return true;
    }
    if (!valueExists(options, value)) {
      await api.sendMessage(chatId, [
        'Usage: /objective <name>',
        'Explanation: set storyboard objective.',
        'Allowed objectives:',
        options.map((id) => {
          const meta = getObjectiveMeta(id);
          return `${id}${meta.description ? `: ${meta.description}` : ''}`;
        }).join('\n'),
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const meta = getObjectiveMeta(value);
    const updated = await setConfigPathValue(chatId, 'generation.objective', value);
    await configStore.setConfigValue(chatId, 'generation.objective_name', meta.name || value);
    await configStore.setConfigValue(chatId, 'generation.objective_description', meta.description || '');
    await api.sendMessage(chatId, `Updated generation.objective = ${updated}`);
    return true;
  }

  if (OBJECTIVE_SHORTCUTS[command]) {
    const objective = String(OBJECTIVE_SHORTCUTS[command]).trim().toLowerCase();
    const options = getOptions('generation.objective');
    const current = String(configStore.getCurrent(chatId, 'generation.objective') || '').trim() || '-';
    if (!valueExists(options, objective)) {
      await api.sendMessage(chatId, [
        `Shortcut is configured to '${objective}', but this objective is not available.`,
        `Allowed: ${options.join(', ')}`,
        `Current: ${current}`
      ].join('\n'));
      return true;
    }
    const meta = getObjectiveMeta(objective);
    const updated = await setConfigPathValue(chatId, 'generation.objective', objective);
    await configStore.setConfigValue(chatId, 'generation.objective_name', meta.name || objective);
    await configStore.setConfigValue(chatId, 'generation.objective_description', meta.description || '');
    await api.sendMessage(chatId, `Updated generation.objective = ${updated} (via ${command})`);
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
      const source = styles && typeof styles === 'object' ? styles : {};
      const filtered = {};
      Object.entries(source).forEach(([k, v]) => {
        const key = normalizeStyleName(k);
        const prompt = String(v || '').trim();
        if (!key || !prompt) return;
        filtered[key] = prompt;
      });
      return filtered;
    })();
    const currentStyleName = String(configStore.getCurrent(chatId, 'generation.style_name') || '').trim() || '-';
    if (!styleInput) {
      const customNames = Object.keys(userStyles);
      const builtInLines = Object.keys(STYLE_PRESETS).map((id) => {
        const meta = getStyleMeta(id);
        return `- ${id} (${meta.name || id}): ${meta.description || STYLE_PRESETS[id]}`;
      });
      const customLines = customNames.length
        ? customNames.map((id) => `- ${id} (custom): ${String(userStyles[id] || '').trim()}`)
        : ['- none'];
      await api.sendMessage(chatId, [
        'Usage: /style <preset-or-your-style>',
        'Explanation: choose a predefined/custom style, or pass free-form style text.',
        'Built-in styles:',
        builtInLines.join('\n'),
        'Your custom styles:',
        customLines.join('\n'),
        `Current: ${currentStyleName}`
      ].join('\n'));
      return true;
    }
    const prompt = STYLE_PRESETS[preset] || String(userStyles[preset] || '').trim();
    if (!prompt) {
      await configStore.setConfigValue(chatId, 'generation.style_prompt', styleInput);
      await configStore.setConfigValue(chatId, 'generation.style_name', 'custom');
      await configStore.setConfigValue(chatId, 'generation.style_description', styleInput);
      await api.sendMessage(chatId, 'Updated generation.style_prompt');
      return true;
    }
    const presetMeta = getStyleMeta(preset);
    const isBuiltin = Boolean(STYLE_PRESETS[preset]);
    await configStore.setConfigValue(chatId, 'generation.style_prompt', prompt);
    await configStore.setConfigValue(chatId, 'generation.style_name', isBuiltin ? presetMeta.name : preset);
    await configStore.setConfigValue(chatId, 'generation.style_description', isBuiltin ? presetMeta.description : prompt);
    await api.sendMessage(chatId, `Updated style preset = ${preset}`);
    return true;
  }

  if (command === '/styles') {
    await api.sendMessage(chatId, 'Tip: /styles is an alias. Use /style for list/set.');
    return handleCommand(chatId, '/style');
  }

  if (STYLE_SHORTCUTS[command]) {
    const preset = String(STYLE_SHORTCUTS[command] || '').trim().toLowerCase();
    const prompt = String(STYLE_PRESETS[preset] || '').trim();
    if (!prompt) {
      await api.sendMessage(chatId, `Style shortcut not available: ${command}`);
      return true;
    }
    const presetMeta = getStyleMeta(preset);
    await configStore.setConfigValue(chatId, 'generation.style_prompt', prompt);
    await configStore.setConfigValue(chatId, 'generation.style_name', presetMeta.name || preset);
    await configStore.setConfigValue(chatId, 'generation.style_description', presetMeta.description || prompt);
    await api.sendMessage(chatId, `Updated style preset = ${preset} (via ${command})`);
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
        `Allowed: ${SUPPORTED_SECRET_KEYS_FOR_COMMANDS.join(', ')}`,
        keysStatusMessage(chatId)
      ].join('\n'));
      return true;
    }
    try {
      const normalizedKey = normalizeSecretKey(key) || key;
      await configStore.setSecret(chatId, key, value);
      configStore.applySecretsToEnv(chatId);
      await api.sendMessage(chatId, `Stored key ${normalizedKey} in runtime state.`);
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
        `Allowed: ${SUPPORTED_SECRET_KEYS_FOR_COMMANDS.join(', ')}`,
        keysStatusMessage(chatId)
      ].join('\n'));
      return true;
    }
    const normalizedKey = normalizeSecretKey(key) || key;
    await configStore.unsetSecret(chatId, key);
    await api.sendMessage(chatId, `Removed runtime override for ${normalizedKey}.`);
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
    const copied = await configStore.copySecretsFromTo(String(chatId), String(target));
    await api.sendMessage(chatId, `Copied ${copied} runtime key(s) to user ${target}.`);
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
    if (!text && !message?.document && !(Array.isArray(message?.photo) && message.photo.length) && !message?.voice) {
      await api.sendMessage(chatId, 'Unsupported message format. Send plain text, URL, PDF, image, or voice.');
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
      const allowlistLabel = runtime.allowAllChats ? 'all' : (runtime.allowedChatIds.join(',') || '(none)');
      console.warn(`[render-bot] denied chat ${chatId}; allowlist=${allowlistLabel} admins=${adminChatIds.join(',') || '(none)'}`);
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

    if (coldStartNoticePending) {
      coldStartNoticePending = false;
      await safeNotifyUser(chatId, BOT_COLD_START_NOTICE);
    }

    try {
      await configStore.updateUserProfile(chatId, {
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
      });
    } catch (error) {
      console.error('[render-bot] updateUserProfile failed:', error && error.message ? error.message : String(error));
    }

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

    const commandStateBefore = incoming.kind === 'command' ? snapshotConfigStoreState() : null;

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

      let runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
      let effectiveConfigPath = runCfg.configPath;
      let effectiveConfig = runCfg.config;
      configStore.applySecretsToEnv(chatId);
      let inventedStory = '';
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          inventedStory = await inventStoryText(seed, effectiveConfigPath, {
            onFallback: async (info) => {
              await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
            },
            onEnrichment: async (info) => {
              const msg = formatEnrichmentMessage(info);
              if (msg) await safeNotifyUser(chatId, msg);
            }
          });
          await persistRotationSuccess(runCfg.selected);
          break;
        } catch (error) {
          const failedRole = inferFailedProviderRole(error) || 'text';
          if (!isProviderOrModelFailure(error)) throw error;
          const rotated = await advanceProviderRotation(chatId, failedRole, runCfg.selected[failedRole] || {});
          if (!rotated) throw error;
          await safeNotifyUser(chatId, formatProviderRotationRetryMessage(failedRole, rotated.from, rotated.to, error));
          runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
          effectiveConfigPath = runCfg.configPath;
          effectiveConfig = runCfg.config;
        }
      }
      await sendLongMessage(chatId, formatInventedStoryMessage(inventedStory));
      await api.sendMessage(chatId, incoming.command === '/random' ? 'Random story ready. Generating your comic...' : 'Invented story ready. Generating your comic...');
      const configLine = compactConfigString(effectiveConfig);
      await api.sendMessage(chatId, configLine);
      const deliveryMode = normalizeDeliveryMode(effectiveConfig?.generation?.delivery_mode || 'default');
      const debugPromptsEnabled = Boolean(effectiveConfig?.generation?.debug_prompts);
      const alreadySent = new Set();
      const orderedSender = createOrderedPanelSender(chatId, alreadySent, debugPromptsEnabled);
      const generationId = createGenerationId(chatId);
      let result = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          result = await generatePanelsWithRuntimeConfig(inventedStory, runtime, effectiveConfigPath, {
            userId: chatId,
            generationId,
            onFallback: async (info) => {
              await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
            },
            onExtractorFallback: async (info) => {
              await safeNotifyUser(chatId, formatExtractorFallbackMessage(info));
            },
            onPanelReady: (deliveryMode === 'default')
              ? async (panelMessage) => {
                  await orderedSender(panelMessage);
                }
              : undefined
          });
          await persistRotationSuccess(runCfg.selected);
          break;
        } catch (error) {
          const failedRole = inferFailedProviderRole(error);
          if (!failedRole || !isProviderOrModelFailure(error) || alreadySent.size > 0) throw error;
          const rotated = await advanceProviderRotation(chatId, failedRole, runCfg.selected[failedRole] || {});
          if (!rotated) throw error;
          await safeNotifyUser(chatId, formatProviderRotationRetryMessage(failedRole, rotated.from, rotated.to, error));
          runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
          effectiveConfigPath = runCfg.configPath;
          effectiveConfig = runCfg.config;
        }
      }
      if (!result) throw new Error('Generation failed: no provider produced output');
      await sendPanelSequence(chatId, result, 'invent', '', alreadySent, deliveryMode, effectiveConfig, debugPromptsEnabled);
      await sendCommandChangeConfirmation(chatId, commandStateBefore);
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
          storyboard: result.storyboard || null,
          panelMessages: normalizePanelMessages(result.panelMessages || []).map((p) => ({
            index: Number(p?.index || 0),
            total: Number(p?.total || 0),
            caption: String(p?.caption || ''),
            imagePath: String(p?.imagePath || '')
          }))
        },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    const handled = await handleCommand(chatId, text);
    if (handled) {
      await sendCommandChangeConfirmation(chatId, commandStateBefore);
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
      await sendCommandChangeConfirmation(chatId, commandStateBefore);
      runBackgroundTask('record unknown command', () => safeRecordInteraction(chatId, {
        kind: incoming.kind,
        command: incoming.command,
        requestText: text,
        result: { ok: false, type: 'command', error: 'unrecognized_command' },
        config: configStore.getEffectiveConfig(chatId)
      }, userMeta));
      return;
    }

    let runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
    let effectiveConfigPath = runCfg.configPath;
    let effectiveConfig = runCfg.config;
    configStore.applySecretsToEnv(chatId);
    let generationInput = text;
    let parsedInput = classifyMessageInput(generationInput);
    let generationMode = 'text';
    let extractionInfo = null;
    let shortPromptExpanded = false;
    let inventedStoryPreview = '';
    const source = detectStoryExtractionSource(message, text);
    const intent = decideInputIntent({
      incomingKind: incoming.kind,
      text,
      sourceType: source?.type || '',
      shortPromptMaxChars: SHORT_STORY_PROMPT_MAX_CHARS
    });
    const isNonTextSource = intent.isNonTextSource || NON_TEXT_SOURCE_TYPES.has(String(source?.type || '').toLowerCase());
    const shortTextInput = Boolean(intent.isShortText);
    if (intent.route === 'url') {
      if (parsedInput.kind !== 'url' && intent.inferredUrl) {
        generationInput = intent.inferredUrl;
        parsedInput = classifyMessageInput(generationInput);
      }
    }
    logRuntimeEvent('info', 'input_intent', {
      chatId,
      incomingKind: incoming.kind,
      sourceType: String(source?.type || ''),
      route: intent.route,
      reason: intent.reason,
      parsedKind: intent.parsedKind,
      shortTextInput,
      inferredUrl: intent.inferredUrl ? '[present]' : ''
    });
    if (isNonTextSource) {
      if (source.type === 'html_url') await api.sendMessage(chatId, `Detected link, parsing page: ${source.url}`);
      else if (source.type === 'pdf_url') await api.sendMessage(chatId, `Detected PDF link, extracting story: ${source.url}`);
      else if (source.type === 'pdf_file') await api.sendMessage(chatId, 'Detected PDF file, extracting story...');
      else if (source.type === 'image_url') await api.sendMessage(chatId, `Detected image link, extracting story: ${source.url}`);
      else if (source.type === 'image_file') await api.sendMessage(chatId, 'Detected image file, extracting story...');
      else if (source.type === 'audio_url') await api.sendMessage(chatId, `Detected audio link, transcribing: ${source.url}`);
      else if (source.type === 'audio_file') await api.sendMessage(chatId, 'Detected voice/audio file, transcribing...');

      let extractionSource = source;
      if (source.type === 'pdf_file') {
        const pdf = await extractPdfFromTelegramDocument(api, source.document);
        extractionSource = { ...source, ...pdf };
      } else if (source.type === 'image_file') {
        const img = await extractImageFromTelegramMessage(api, source.document);
        extractionSource = { ...source, ...img };
      } else if (source.type === 'audio_file') {
        const audio = await extractAudioFromTelegramMessage(api, source.document);
        extractionSource = { ...source, ...audio };
      }

      try {
        extractionInfo = await extractStoryFromSource(extractionSource, {
          runtime,
          config: effectiveConfig,
          onExtractorFallback: async (info) => {
            await safeNotifyUser(chatId, formatExtractorFallbackMessage(info));
          },
          onPdfFallback: async (info) => {
            await safeNotifyUser(chatId, formatPdfExtractorFallbackMessage(info));
          },
          onImageFallback: async (info) => {
            await safeNotifyUser(chatId, formatImageExtractorFallbackMessage(info));
          }
        });
        generationInput = String(extractionInfo?.text || '').trim();
        if (!generationInput) throw new Error('Story extraction returned empty text');
        await api.sendMessage(chatId, 'Summarizing key points from extracted content...');
        let summaryInfo = null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            summaryInfo = await summarizeExtractedForStoryboard(generationInput, effectiveConfig, effectiveConfigPath, {
              onFallback: async (info) => {
                await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
              },
              onEnrichment: async (info) => {
                const msg = formatEnrichmentMessage(info);
                if (msg) await safeNotifyUser(chatId, msg);
              }
            });
            await persistRotationSuccess(runCfg.selected);
            break;
          } catch (error) {
            const failedRole = inferFailedProviderRole(error) || 'text';
            if (!isProviderOrModelFailure(error)) throw error;
            const rotated = await advanceProviderRotation(chatId, failedRole, runCfg.selected[failedRole] || {});
            if (!rotated) throw error;
            await safeNotifyUser(chatId, formatProviderRotationRetryMessage(failedRole, rotated.from, rotated.to, error));
            runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
            effectiveConfigPath = runCfg.configPath;
            effectiveConfig = runCfg.config;
          }
        }
        if (!summaryInfo) throw new Error('Summary generation failed: no provider produced output');
        generationInput = String(summaryInfo.text || generationInput).trim();
        await api.sendMessage(chatId, 'Key points summary ready. Building storyboard...');
        if (summaryInfo.method === 'invent_fallback') {
          await safeNotifyUser(chatId, 'Summary was too short, so I expanded it with AI before storyboard generation.');
        } else if (summaryInfo.method === 'source_fallback') {
          await safeNotifyUser(chatId, 'Summary stayed too short, so I used extracted text directly for storyboard generation.');
        }
        logRuntimeEvent('info', 'source_summary_ready', {
          chatId,
          method: summaryInfo.method,
          sourceChars: Number(summaryInfo.sourceChars || 0),
          summaryChars: Number(summaryInfo.summaryChars || 0),
          reason: String(summaryInfo.reason || '')
        });
        parsedInput = classifyMessageInput(generationInput);
        if (source.type === 'html_url' && parsedInput.kind === 'url') {
          throw new Error('URL extraction failed: extractor returned URL-like text only');
        }
        generationMode = String(extractionInfo?.sourceType || source.type || 'text').includes('pdf')
          ? 'pdf'
          : (String(extractionInfo?.sourceType || source.type || 'text').includes('image')
            ? 'image'
            : (String(extractionInfo?.sourceType || source.type || 'text').includes('audio') ? 'voice' : 'url'));
        const providerUsed = String(extractionInfo?.providerUsed || '').trim();
        if (providerUsed) {
          const label = generationMode === 'pdf' ? 'PDF' : (generationMode === 'image' ? 'Image' : (generationMode === 'voice' ? 'Voice' : 'Link'));
          await api.sendMessage(chatId, `${label} parsed via ${providerUsed}. Generating your comic...`);
        }
        logRuntimeEvent('info', 'source_extraction_success', {
          chatId,
          sourceType: String(source.type || ''),
          providerUsed,
          extractedChars: generationInput.length
        });
      } catch (firstExtractionError) {
        logRuntimeEvent('warn', 'source_extraction_failed', {
          chatId,
          sourceType: String(source.type || ''),
          error: String(firstExtractionError?.message || firstExtractionError).slice(0, 220)
        });
        if (source.type === 'html_url') {
          const originalInputText = String(text || '').trim();
          const fallbackText = extractTextFallbackFromUrlMessage(originalInputText);
          const fallbackParsed = classifyMessageInput(fallbackText);
          if (fallbackText && fallbackParsed.kind !== 'url') {
            await api.sendMessage(chatId, "Can't extract from HTML, trying text.");
            generationInput = fallbackText;
            parsedInput = classifyMessageInput(generationInput);
            generationMode = 'text';
            logRuntimeEvent('info', 'source_extraction_html_fallback_to_text', {
              chatId,
              fallbackChars: generationInput.length
            });
          } else {
            const rawReason = String(firstExtractionError?.message || '').trim();
            const shortReason = rawReason
              .replace(/^URL extraction failed:\s*/i, '')
              .replace(/^Error:\s*/i, '')
              .slice(0, 180);
            const reasonLine = shortReason ? ` Reason: ${shortReason}.` : '';
            await api.sendMessage(chatId, `Can't extract story from this link.${reasonLine} Please send another URL or paste the story text.`);
            logRuntimeEvent('warn', 'source_extraction_html_no_fallback', {
              chatId,
              reason: shortReason || 'no_fallback_text'
            });
            runBackgroundTask('record generation failure', () => safeRecordInteraction(chatId, {
              kind: incoming.kind,
              command: incoming.command,
              requestText: text,
              result: { ok: false, type: 'generation', error: 'url_extraction_failed_no_text_fallback' },
              config: configStore.getEffectiveConfig(chatId)
            }, userMeta));
            return;
          }
        } else {
          throw firstExtractionError;
        }
      }
    }

    if (shortTextInput && parsedInput.kind !== 'url') {
      shortPromptExpanded = true;
      logRuntimeEvent('info', 'short_prompt_story_expansion', {
        chatId,
        promptChars: String(text || '').trim().length
      });
      const enrichSelected = normalizeEnrichmentProvider(effectiveConfig?.generation?.enrichment_provider || 'wikipedia');
      const enrichFallback = normalizeEnrichmentProvider(effectiveConfig?.generation?.enrichment_fallback_provider || 'gemini');
      const enrichPath = enrichSelected === enrichFallback
        ? enrichSelected
        : `${enrichSelected} -> ${enrichFallback}`;
      const textProvider = String(effectiveConfig?.providers?.text?.provider || '-').trim();
      const textModel = String(effectiveConfig?.providers?.text?.model || '-').trim();
      await api.sendMessage(
        chatId,
        `Your prompt is too short, so I will invent a longer story first. Enrichment: ${enrichPath}. AI: ${textProvider}/${textModel}.`
      );
      let inventedStory = '';
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          inventedStory = await inventStoryText(text, effectiveConfigPath, {
            onFallback: async (info) => {
              await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
            },
            onEnrichment: async (info) => {
              const msg = formatEnrichmentMessage(info);
              if (msg) await safeNotifyUser(chatId, msg);
            }
          });
          await persistRotationSuccess(runCfg.selected);
          break;
        } catch (error) {
          const failedRole = inferFailedProviderRole(error) || 'text';
          if (!isProviderOrModelFailure(error)) throw error;
          const rotated = await advanceProviderRotation(chatId, failedRole, runCfg.selected[failedRole] || {});
          if (!rotated) throw error;
          await safeNotifyUser(chatId, formatProviderRotationRetryMessage(failedRole, rotated.from, rotated.to, error));
          runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
          effectiveConfigPath = runCfg.configPath;
          effectiveConfig = runCfg.config;
        }
      }
      inventedStoryPreview = String(inventedStory || '').slice(0, 1000);
      await api.sendMessage(chatId, formatInventedStoryMessage(inventedStory));
      generationInput = inventedStory;
    }

    await api.sendChatAction(chatId, 'upload_photo');
    if (shortPromptExpanded) {
      await api.sendMessage(chatId, 'Generating your comic from the expanded story...');
    } else if (isNonTextSource) {
      // Already informed user about extraction/generation start.
    } else {
      logRuntimeEvent('info', 'text_generation_direct', {
        chatId,
        promptChars: String(generationInput || '').trim().length
      });
      await api.sendMessage(chatId, 'Generating your comic...');
    }

    const configLine = compactConfigString(effectiveConfig);
    await api.sendMessage(chatId, configLine);
    const deliveryMode = normalizeDeliveryMode(effectiveConfig?.generation?.delivery_mode || 'default');
    const debugPromptsEnabled = Boolean(effectiveConfig?.generation?.debug_prompts);
    const alreadySent = new Set();
    const orderedSender = createOrderedPanelSender(chatId, alreadySent, debugPromptsEnabled);
    const generationId = createGenerationId(chatId);
    let result = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        result = await generatePanelsWithRuntimeConfig(generationInput, runtime, effectiveConfigPath, {
          userId: chatId,
          generationId,
          onFallback: async (info) => {
            await safeNotifyUser(chatId, formatProviderFallbackMessage(info));
          },
          onExtractorFallback: async (info) => {
            await safeNotifyUser(chatId, formatExtractorFallbackMessage(info));
          },
          onPanelReady: (deliveryMode === 'default')
            ? async (panelMessage) => {
                await orderedSender(panelMessage);
              }
            : undefined
        });
        await persistRotationSuccess(runCfg.selected);
        break;
      } catch (error) {
        const failedRole = inferFailedProviderRole(error);
        if (!failedRole || !isProviderOrModelFailure(error) || alreadySent.size > 0) throw error;
        const rotated = await advanceProviderRotation(chatId, failedRole, runCfg.selected[failedRole] || {});
        if (!rotated) throw error;
        await safeNotifyUser(chatId, formatProviderRotationRetryMessage(failedRole, rotated.from, rotated.to, error));
        runCfg = await writeRotatedEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
        effectiveConfigPath = runCfg.configPath;
        effectiveConfig = runCfg.config;
      }
    }
    if (!result) throw new Error('Generation failed: no provider produced output');
    let finalSourceMode = 'text';
    if (generationMode === 'url' || generationMode === 'pdf' || generationMode === 'image' || generationMode === 'voice') {
      finalSourceMode = generationMode;
    } else if (result.kind === 'url' || result.kind === 'pdf' || result.kind === 'image' || result.kind === 'voice') {
      finalSourceMode = result.kind;
    }
    await sendPanelSequence(chatId, result, finalSourceMode, '', alreadySent, deliveryMode, effectiveConfig, debugPromptsEnabled);
    console.log('[render-bot] generation completed', JSON.stringify({
      chatId,
      mode: finalSourceMode,
      panelCount: Number(result && result.panelCount ? result.panelCount : 0),
      elapsedMs: Number(result && result.elapsedMs ? result.elapsedMs : 0),
      deliveryMode
    }));
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
        panelMessages: normalizePanelMessages(result.panelMessages || []).map((p) => ({
          index: Number(p?.index || 0),
          total: Number(p?.total || 0),
          caption: String(p?.caption || ''),
          imagePath: String(p?.imagePath || '')
        })),
        sourceMode: finalSourceMode,
        extractorSelected: String(extractionInfo?.providerSelected || ''),
        extractorUsed: String(extractionInfo?.providerUsed || ''),
        shortPromptExpanded,
        inventedStoryPreview
      },
      config: configStore.getEffectiveConfig(chatId)
    }, userMeta));
  } catch (error) {
    console.error('[render-bot] generation failed', JSON.stringify({
      chatId,
      kind: String(incoming && incoming.kind || ''),
      command: String(incoming && incoming.command || ''),
      message: String(error && error.message ? error.message : error),
      preview: String(text || '').slice(0, 180)
    }));
    await persistCrash('processMessageError', error, {
      chatId,
      incomingKind: incoming?.kind || '',
      incomingCommand: incoming?.command || '',
      inputPreview: String(text || '').slice(0, 2000),
      updateSource: String(context?.source || '')
    });
    const debugPromptsEnabled = Boolean(configStore && configStore.getCurrent(chatId, 'generation.debug_prompts'));
    if (debugPromptsEnabled) {
      const stack = String(error?.stack || '').split('\n').slice(0, 5).join('\n');
      const debugText = [
        'Debug: generation exception',
        `message: ${String(error?.message || error)}`,
        stack ? `stack:\n${stack}` : ''
      ].filter(Boolean).join('\n');
      await safeNotifyUser(chatId, debugText);
    }
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
      await persistCrash('queueJobError', error, {
        chatId: targetChatId,
        updateId: Number(update?.update_id || 0),
        source: String(updateSource || ''),
        textPreview: String(update?.message?.text || update?.message?.caption || '').slice(0, 2000)
      });
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

function resolveBaseConfigPath() {
  const configured = String(process.env.RENDER_BOT_BASE_CONFIG || '').trim();
  const configuredResolved = configured ? path.resolve(configured) : '';
  const canonical = path.join(repoRoot, 'telegram/config/default.render.yml');
  const legacy = path.join(repoRoot, 'render/config/default.render.yml');
  if (configuredResolved && fs.existsSync(configuredResolved)) return configuredResolved;
  if (fs.existsSync(canonical)) {
    process.env.RENDER_BOT_BASE_CONFIG = canonical;
    return canonical;
  }
  if (fs.existsSync(legacy)) {
    process.env.RENDER_BOT_BASE_CONFIG = legacy;
    return legacy;
  }
  const attempted = [configuredResolved, canonical, legacy].filter(Boolean).join(', ');
  throw new Error(`Config file not found: ${attempted}`);
}

async function startServer() {
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  if (!webhookSecret) throw new Error('Missing TELEGRAM_WEBHOOK_SECRET');

  try {
    const runtimeLogSelected = createRuntimeLogStoreFromEnv();
    runtimeLogStore = runtimeLogSelected.impl;
    runtimeLogStoreMode = runtimeLogSelected.mode;
    if (runtimeLogStore && typeof runtimeLogStore.start === 'function') runtimeLogStore.start();
    installRuntimeLogConsoleTee();
  } catch (error) {
    originalConsole.error('[render-bot] runtime log store init failed:', error && error.message ? error.message : String(error));
    runtimeLogStore = null;
    runtimeLogStoreMode = 'disabled';
  }

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
    filePath: path.resolve(process.env.RENDER_BOT_STATE_FILE || path.join(repoRoot, 'telegram/data/runtime-state.json'))
  });
  const blacklistStore = createBlacklistStoreFromEnv();
  blacklistStoreMode = blacklistStore.mode;
  const knownUsersStore = createKnownUsersStoreFromEnv();
  knownUsersStoreMode = knownUsersStore.mode;
  configStore = new RuntimeConfigStore(
    resolveBaseConfigPath(),
    persistenceMode.impl,
    {
      cfgRootDir: path.resolve(process.env.RENDER_BOT_CFGS_DIR || path.join(repoRoot, 'telegram/cfgs')),
      adminChatIds: adminChatIds.join(','),
      blacklistStore: blacklistStore.impl,
      knownUsersStore: knownUsersStore.impl
    }
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
      const meta = getObjectiveMeta(deployDefaultObjective);
      await configStore.setGlobalConfigValue('generation.objective', deployDefaultObjective);
      await configStore.setGlobalConfigValue('generation.objective_name', meta.name || deployDefaultObjective);
      await configStore.setGlobalConfigValue('generation.objective_description', meta.description || '');
      console.log(`[render-bot] deployment default objective enforced: ${deployDefaultObjective}`);
    } else {
      console.log(`[render-bot] deployment default objective ignored (unsupported): ${deployDefaultObjective}`);
    }
  }
  const globalCfg = configStore.getEffectiveConfig('global');
  const objectiveMeta = resolveObjectiveMetaFromConfig(globalCfg);
  const styleMeta = resolveStyleMetaFromConfig(globalCfg);
  await configStore.setGlobalConfigValue('generation.objective_name', objectiveMeta.name || objectiveMeta.id || 'Objective');
  await configStore.setGlobalConfigValue('generation.objective_description', objectiveMeta.description || '');
  await configStore.setGlobalConfigValue('generation.style_name', styleMeta.name || 'custom');
  await configStore.setGlobalConfigValue('generation.style_description', styleMeta.description || '');
  await configStore.ensureMetaValue('bot_created_at', new Date().toISOString());
  await seedAdminRuntimeSecretsFromEnv();
  configStore.applySecretsToEnv('global');
  const requestStore = createRequestLogStoreFromEnv();
  requestLogStore = requestStore.impl;
  requestLogStoreMode = requestStore.mode;

  async function runStartupSelfChecks() {
    if (String(crashStoreMode || '').toLowerCase() === 'r2') {
      if (!crashStore || typeof crashStore.healthCheck !== 'function') {
        await notifyAdmins('[alert] crash-log storage self-check unavailable (r2 mode without healthCheck).');
      } else {
        const health = await crashStore.healthCheck();
        if (!health || !health.ok) {
          const lines = [
            '[alert] crash-log storage is unreachable.',
            `mode: ${crashStoreMode}`,
            `endpoint: ${String(process.env.R2_S3_ENDPOINT || '').trim() || '-'}`,
            `bucket: ${String(process.env.R2_BUCKET || '').trim() || '-'}`,
            `error: ${String(health?.error || 'unknown')}`
          ];
          if (health?.code) lines.push(`code: ${String(health.code)}`);
          await notifyAdmins(lines.join('\n'));
        }
      }
    }

    if (String(runtimeLogStoreMode || '').toLowerCase() === 'r2') {
      if (!runtimeLogStore || typeof runtimeLogStore.healthCheck !== 'function') {
        await notifyAdmins('[alert] runtime-log storage self-check unavailable (r2 mode without healthCheck).');
      } else {
        const runtimeHealth = await runtimeLogStore.healthCheck();
        if (!runtimeHealth || !runtimeHealth.ok) {
          const rtLines = [
            '[alert] runtime-log storage is unreachable.',
            `mode: ${runtimeLogStoreMode}`,
            `endpoint: ${String(process.env.R2_S3_ENDPOINT || '').trim() || '-'}`,
            `bucket: ${String(process.env.R2_BUCKET || '').trim() || '-'}`,
            `error: ${String(runtimeHealth?.error || 'unknown')}`
          ];
          if (runtimeHealth?.code) rtLines.push(`code: ${String(runtimeHealth.code)}`);
          await notifyAdmins(rtLines.join('\n'));
        }
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        return sendJson(res, 200, {
          ok: true,
          service: 'render-telegram-bot',
          persistence: persistenceMode.mode,
          requestLogs: requestLogStoreMode,
          runtimeLogs: runtimeLogStoreMode,
          crashLogs: crashStoreMode,
          r2: {
            endpointConfigured: Boolean(String(process.env.R2_S3_ENDPOINT || '').trim()),
            bucket: String(process.env.R2_BUCKET || '').trim() || ''
          }
        });
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
      await persistCrash('httpRequestError', error, {
        method: String(req?.method || ''),
        url: String(req?.url || '')
      });
      sendJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
  });

  const port = Number(process.env.PORT || 10000);
  server.listen(port, () => {
    console.log(`[render-bot] listening on port ${port}`);
    console.log(`[render-bot] version: ${BOT_VERSION}`);
    console.log(`[render-bot] webhook path: ${webhookPath}`);
    console.log(`[render-bot] persistence: ${persistenceMode.mode}`);
    console.log(`[render-bot] crash logs: ${crashStoreMode}`);
    console.log(`[render-bot] local crash diagnostics: ${localCrashLogDir}`);
    console.log(`[render-bot] request logs: ${requestLogStoreMode}`);
    console.log(`[render-bot] runtime logs: ${runtimeLogStoreMode}`);
    console.log(`[render-bot] request logs config: prefix=${String(process.env.R2_REQUEST_LOG_PREFIX || 'logs/requests').trim() || '-'} statusKey=${String(process.env.R2_REQUEST_LOG_STATUS_KEY || 'logs/requests/status.json').trim() || '-'} bucket=${String(process.env.R2_BUCKET || '').trim() || '-'}`);
    console.log(`[render-bot] blacklist store: ${blacklistStoreMode}`);
    console.log(`[render-bot] known users store: ${knownUsersStoreMode}`);
    console.log(`[render-bot] image storage: ${runtime.r2Endpoint && runtime.r2Bucket ? 'r2' : 'file'}`);
    console.log('[render-bot] ready');
    notifyDeploymentReady().catch((error) => {
      console.error('[render-bot] deployment notification failed:', error && error.message ? error.message : String(error));
    });
    runStartupSelfChecks().catch((error) => {
      console.error('[render-bot] startup self-check failed:', error && error.message ? error.message : String(error));
    });
    const chromiumWarmupEnabled = String(process.env.RENDER_BOT_ASYNC_CHROMIUM_WARMUP || 'true').trim().toLowerCase() === 'true';
    if (chromiumWarmupEnabled) {
      runBackgroundTask('playwright chromium warmup', async () => {
        warmupPlaywrightChromiumInBackground('post_boot');
      });
    }
  });
}

let crashing = false;
async function handleFatalEvent(event, errorLike) {
  if (crashing) return;
  crashing = true;
  const message = errorLike && errorLike.message ? errorLike.message : String(errorLike || '');
  console.error(`[render-bot] fatal ${event}:`, message);
  await persistCrash(event, errorLike);
  try {
    if (runtimeLogStore && typeof runtimeLogStore.stop === 'function') {
      await runtimeLogStore.stop();
    }
  } catch (_) {}
  process.exit(1);
}

async function gracefulShutdown(signal) {
  try {
    console.log(`[render-bot] received ${signal}, flushing runtime logs...`);
    if (runtimeLogStore && typeof runtimeLogStore.stop === 'function') {
      await runtimeLogStore.stop();
    }
  } catch (_) {}
  process.exit(0);
}

process.on('uncaughtException', (error) => {
  handleFatalEvent('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  handleFatalEvent('unhandledRejection', reason);
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

startServer().catch((error) => {
  console.error('[render-bot] startup failed:', error && error.message ? error.message : String(error));
  persistCrash('startupFailure', error).finally(() => process.exit(1));
});
