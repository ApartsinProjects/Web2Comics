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
const { classifyMessageInput } = require('./message-utils');
const { composeComicSheet } = require('../../engine/src/compose');

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

const chatQueues = new Map();

const STYLE_PRESETS = {
  classic: 'clean comic panel art, readable characters, coherent scene progression',
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

const PROVIDER_REQUIRED_KEYS = {
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  huggingface: ['HUGGINGFACE_INFERENCE_API_TOKEN']
};
const PROMPT_MANUAL_URL = 'https://github.com/ApartsinProjects/Web2Comics/blob/engine/render/docs/deployment-runbook.md';
const COMMAND_ALIASES = {
  '/credentials': '/keys',
  '/reset_default': '/reset_config',
  '/reset': '/reset_config'
};

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
    'Basic:',
    '/help',
    '/about',
    '/explain',
    '/user',
    '/config',
    '/presets',
    '',
    'Generate:',
    '/invent <story>',
    '',
    'Creative controls:',
    '/panels <count>',
    '/objective',
    '/objective <name>',
    '/style <preset-or-your-style>',
    '/new_style <name> <text>',
    '/set_style <text>',
    '/language <code>',
    '/mode <default|media_group|single>',
    '/crazyness <0..2>',
    '/detail <low|medium|high>',
    '/concurrency <1..5>',
    '/retries <0..3>',
    '',
    'Providers and keys:',
    '/vendor <name>',
    '/text_vendor <name>',
    '/image_vendor <name>',
    '/keys',
    '/setkey <KEY> <VALUE>',
    '/unsetkey <KEY>',
    '',
    'Advanced config:',
    '/list_options',
    '/options <path>',
    '/choose <path> <number>',
    '/set <path> <value>',
    '/prompts',
    '/set_prompt story <text>',
    '/set_prompt panel <text>',
    '/set_prompt objective <name> <text>',
    '',
    'Maintenance:',
    '/reset_config',
    '/restart',
    '',
    'Compatibility aliases:',
    '/credentials -> /keys',
    '/reset_default -> /reset_config',
    '/reset -> /reset_config',
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
    lines.push('/peek  - list latest generated comics');
    lines.push('/peek <n> or /peek<n>  - show one comic from that list');
    lines.push('/log, /log <n>, /log<n>  - list latest interaction logs');
    lines.push('/users  - list known users');
    lines.push('/ban  - list banned users');
    lines.push('/ban <user_id|username>  - ban user');
    lines.push('/unban <user_id|username>  - unban user');
    lines.push('/share <user_id>  - allow user to use your runtime keys');
  }
  return lines.join('\n');
}

function presetsMessage(chatId) {
  const userStyles = (() => {
    const cfg = configStore.getEffectiveConfig(chatId);
    const styles = cfg && cfg.generation && typeof cfg.generation.user_styles === 'object'
      ? cfg.generation.user_styles
      : {};
    return styles && typeof styles === 'object' ? styles : {};
  })();
  const userStyleNames = Object.keys(userStyles);
  return [
    'Friendly presets:',
    `- vendor: ${Object.keys(PROVIDER_DEFAULT_MODELS).join(', ')}`,
    `- language: ${getOptions('generation.output_language').join(', ')}`,
    `- objective: ${getOptions('generation.objective').join(', ')}`,
    `- mode: ${getOptions('generation.delivery_mode').join(', ')}`,
    `- crazyness: ${getOptions('generation.invent_temperature').join(', ')}`,
    `- panels: ${getOptions('generation.panel_count').join(', ')}`,
    `- detail: ${getOptions('generation.detail_level').join(', ')}`,
    `- style: ${Object.keys(STYLE_PRESETS).join(', ')}`,
    userStyleNames.length ? `- your styles: ${userStyleNames.join(', ')}` : '- your styles: none (use /new_style <name> <text>)',
    '',
    'Examples:',
    '/vendor gemini',
    '/language en',
    '/mode media_group',
    '/crazyness 1.2',
    '/panels 4',
    '/objective summarize',
    '/style manga',
    '/new_style retro-noir high contrast inked comic, moody lighting, halftone texture'
  ].join('\n');
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
  if (!token) return '';
  return COMMAND_ALIASES[token] || token;
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
    '4) Verify: /credentials',
    '',
    'Once connected, useful commands:',
    '/help  /config  /presets  /vendor <name>  /panels <count>  /style <preset>'
  ];
  if (isAdminChat(chatId)) {
    lines.push('');
    lines.push('Admin commands:');
    lines.push('/peek  /peek<n>  /log  /log<n>  /users  /ban  /unban  /share <user_id>');
  }
  return lines.join('\n');
}

function formatUsersMessage() {
  const users = (configStore && configStore.state && configStore.state.users) || {};
  const rows = Object.entries(users)
    .map(([id, record]) => {
      const uid = String(id || '').trim() || 'unknown';
      const username = String(record?.profile?.user?.username || '').trim();
      const first = String(record?.profile?.user?.first_name || '').trim();
      const last = String(record?.profile?.user?.last_name || '').trim();
      const chatUsername = String(record?.profile?.chat?.username || '').trim();
      const display = username
        ? `@${username}`
        : ((`${first} ${last}`.trim()) || (chatUsername ? `@${chatUsername}` : 'unknown'));
      const lastSeen = String(record?.lastSeenAt || '').trim();
      return { uid, display, lastSeen };
    })
    .sort((a, b) => {
      const ta = Date.parse(a.lastSeen || '');
      const tb = Date.parse(b.lastSeen || '');
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return String(a.uid).localeCompare(String(b.uid));
    });
  if (!rows.length) return 'No known users yet.';
  const lines = [`Known users: ${rows.length}`];
  rows.forEach((r, idx) => {
    lines.push(`${idx + 1}. ${r.uid} | ${r.display}`);
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
    'Comic panel <index>/<total>',
    'Story title: <storyboard.title>',
    'Story summary: <storyboard.description short summary>',
    'Panel caption: <panel.caption>',
    'Panel visual brief: <panel.image_prompt>',
    `Style: ${cfg?.generation?.style_prompt || '-'}`,
    'Create one clear scene, no collage.',
    'Do not render caption text inside the image.',
    'No words, letters, subtitles, labels, or text overlays in the artwork.'
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

async function sendPanelWithRetry(chatId, panel, index) {
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

async function sendSingleFormattedComic(chatId, panelResult, sourceMode, cfg) {
  const panels = Array.isArray(panelResult?.panelMessages) ? panelResult.panelMessages : [];
  if (!panels.length) return;
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
    await sendPanelWithRetry(chatId, { imagePath: outPath, caption: caption.slice(0, 1000) }, 0);
  } catch (_) {
    await sendPanelWithRetry(chatId, { imagePath: firstPath, caption: caption.slice(0, 1000) }, 0);
  }
}

async function sendPanelSequence(chatId, panelResult, sourceModeLabel, configLine = '', alreadySent = new Set(), deliveryMode = 'default', cfg = null) {
  const sourceMode = String(sourceModeLabel || 'text').toLowerCase();
  const selectedMode = normalizeDeliveryMode(deliveryMode);
  const panels = Array.isArray(panelResult?.panelMessages) ? panelResult.panelMessages.slice() : [];
  if (String(configLine || '').trim()) {
    await api.sendMessage(chatId, configLine);
  }
  const remaining = panels.filter((p, idx) => !alreadySent.has(Number(p?.index || idx + 1)));
  if (selectedMode === 'media_group' && remaining.length) {
    await sendMediaGroupWithRetry(chatId, remaining);
  } else if (selectedMode === 'single' && panels.length) {
    await sendSingleFormattedComic(chatId, panelResult, sourceMode, cfg);
  } else {
    for (let i = 0; i < remaining.length; i += 1) {
      await sendPanelWithRetry(chatId, remaining[i], i);
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

function resolveHistoryUsername(chatId) {
  const userKey = configStore.normalizeUserKey(chatId);
  const user = configStore.state?.users?.[userKey] || null;
  const fromUser = String(user?.profile?.user?.username || '').trim();
  if (fromUser) return fromUser;
  const fromChat = String(user?.profile?.chat?.username || '').trim();
  if (fromChat) return fromChat;
  return '';
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
    const username = resolveHistoryUsername(h?.chatId);
    const userLabel = username ? `@${username}` : `id:${String(h?.chatId || '-')}`;
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
  const username = resolveHistoryUsername(row?.chatId);
  const userLabel = username ? `@${username}` : `id:${String(row?.chatId || '-')}`;
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
    lines.push(`user: ${String(h.chatId || '-')}`);
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

  if (command === '/about') {
    await api.sendMessage(chatId, [
      `${BOT_DISPLAY_NAME}`,
      `Creator: Alexander (Sasha) Apartsin`,
      `Project: https://github.com/ApartsinProjects/Web2Comics`,
      `Site: https://www.apartsin.com`
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

  if (command === '/presets') {
    await api.sendMessage(chatId, presetsMessage(chatId));
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
      await api.sendMessage(chatId, 'Usage: /unban <user_id|username>');
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
      await api.sendMessage(chatId, `Usage: ${command} <${Object.keys(PROVIDER_DEFAULT_MODELS).join('|')}>`);
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

  if (command === '/language') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.output_language');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /language <code>\nAllowed: ${options.join(', ')}`);
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
      await api.sendMessage(chatId, `Usage: /mode <name>\nCurrent: ${current}\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.delivery_mode', value);
    await api.sendMessage(chatId, `Updated generation.delivery_mode = ${current}`);
    return true;
  }

  if (command === '/panels') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('generation.panel_count');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /panels <count>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.panel_count', value);
    await api.sendMessage(chatId, `Updated generation.panel_count = ${current}`);
    return true;
  }

  if (command === '/objective') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.objective');
    if (!value) {
      const current = String(configStore.getCurrent(chatId, 'generation.objective') || '').trim() || '-';
      await api.sendMessage(chatId, [
        `Current objective: ${current}`,
        'Available objectives:',
        options.join(', '),
        'Use: /objective <name>'
      ].join('\n'));
      return true;
    }
    if (!valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /objective <name>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.objective', value);
    await api.sendMessage(chatId, `Updated generation.objective = ${current}`);
    return true;
  }

  if (command === '/style') {
    const preset = normalizeStyleName(parts[1] || '');
    const userStyles = (() => {
      const cfg = configStore.getEffectiveConfig(chatId);
      const styles = cfg && cfg.generation && typeof cfg.generation.user_styles === 'object'
        ? cfg.generation.user_styles
        : {};
      return styles && typeof styles === 'object' ? styles : {};
    })();
    if (!preset) {
      const customNames = Object.keys(userStyles);
      const allowed = customNames.length
        ? `${Object.keys(STYLE_PRESETS).join(', ')} | your styles: ${customNames.join(', ')}`
        : `${Object.keys(STYLE_PRESETS).join(', ')} | your styles: none`;
      await api.sendMessage(chatId, `Usage: /style <preset-or-your-style>\nAllowed: ${allowed}`);
      return true;
    }
    const prompt = STYLE_PRESETS[preset] || String(userStyles[preset] || '').trim();
    if (!prompt) {
      const dynamic = Object.keys(userStyles);
      const allowed = dynamic.length
        ? `${Object.keys(STYLE_PRESETS).join(', ')}, ${dynamic.join(', ')}`
        : Object.keys(STYLE_PRESETS).join(', ');
      await api.sendMessage(chatId, `Usage: /style <preset>\nAllowed: ${allowed}`);
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
      await api.sendMessage(chatId, 'Usage: /new_style <name> <text>\nName: lowercase letters/numbers/dash, 2-41 chars.');
      return true;
    }
    await configStore.setConfigValue(chatId, `generation.user_styles.${styleName}`, stylePrompt);
    await api.sendMessage(chatId, `Saved style '${styleName}'. Use it with /style ${styleName}`);
    return true;
  }

  if (command === '/set_style') {
    const customStyle = parts.slice(1).join(' ').trim();
    if (!customStyle) {
      await api.sendMessage(chatId, 'Usage: /set_style <text>');
      return true;
    }
    await configStore.setConfigValue(chatId, 'generation.style_prompt', customStyle);
    await api.sendMessage(chatId, 'Updated generation.style_prompt');
    return true;
  }

  if (command === '/set_prompt') {
    const kind = String(parts[1] || '').trim().toLowerCase();
    if (kind === 'story') {
      const textValue = parts.slice(2).join(' ').trim();
      if (!textValue) {
        await api.sendMessage(chatId, 'Usage: /set_prompt story <text>');
        return true;
      }
      await configStore.setConfigValue(chatId, 'generation.custom_story_prompt', textValue);
      await api.sendMessage(chatId, 'Updated generation.custom_story_prompt');
      return true;
    }
    if (kind === 'panel') {
      const textValue = parts.slice(2).join(' ').trim();
      if (!textValue) {
        await api.sendMessage(chatId, 'Usage: /set_prompt panel <text>');
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
        await api.sendMessage(chatId, `Usage: /set_prompt objective <${getOptions('generation.objective').join('|')}> <text>`);
        return true;
      }
      await configStore.setConfigValue(chatId, `generation.objective_prompt_overrides.${objectiveName}`, textValue);
      await api.sendMessage(chatId, `Updated objective prompt override for ${objectiveName}`);
      return true;
    }
    await api.sendMessage(chatId, 'Usage: /set_prompt <story|panel|objective> ...');
    return true;
  }

  if (command === '/detail') {
    const value = String(parts[1] || '').trim().toLowerCase();
    const options = getOptions('generation.detail_level');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /detail <level>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.detail_level', value);
    await api.sendMessage(chatId, `Updated generation.detail_level = ${current}`);
    return true;
  }

  if (command === '/crazyness') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('generation.invent_temperature');
    const parsed = Number.parseFloat(value);
    if (!value || !Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      await api.sendMessage(chatId, `Usage: /crazyness <0..2>\nAllowed presets: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.invent_temperature', value);
    await api.sendMessage(chatId, `Updated generation.invent_temperature = ${current}`);
    return true;
  }

  if (command === '/concurrency') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('runtime.image_concurrency');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /concurrency <n>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'runtime.image_concurrency', value);
    await api.sendMessage(chatId, `Updated runtime.image_concurrency = ${current}`);
    return true;
  }

  if (command === '/retries') {
    const value = String(parts[1] || '').trim();
    const options = getOptions('runtime.retries');
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /retries <n>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'runtime.retries', value);
    await api.sendMessage(chatId, `Updated runtime.retries = ${current}`);
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

  if (command === '/choose') {
    const pathKey = String(parts[1] || '').trim();
    const idx = Number.parseInt(parts[2] || '', 10);
    const options = getOptions(pathKey);
    if (!pathKey) {
      await api.sendMessage(chatId, [
        'Usage: /choose <path> <number>',
        '',
        listOptionPathsMessage(),
        '',
        'Example: /choose generation.objective 2',
        'Tip: run /options <path> first.'
      ].join('\n'));
      return true;
    }
    if (!Number.isFinite(idx) || idx < 1 || idx > options.length) {
      await api.sendMessage(chatId, [
        `Usage: /choose ${pathKey} <number>`,
        formatOptionsMessage(pathKey, configStore.getCurrent(chatId, pathKey))
      ].join('\n\n'));
      return true;
    }
    const chosen = options[idx - 1];
    const parsed = parseUserValue(pathKey, chosen);
    const current = await configStore.setConfigValue(chatId, pathKey, parsed);
    await api.sendMessage(chatId, `Updated ${pathKey} = ${String(current)}`);
    return true;
  }

  if (command === '/set') {
    const pathKey = String(parts[1] || '').trim();
    const rawValue = parts.slice(2).join(' ').trim();
    if (!pathKey || !rawValue) {
      await api.sendMessage(chatId, 'Usage: /set <path> <value>');
      return true;
    }
    try {
      const parsed = parseUserValue(pathKey, rawValue);
      const current = await configStore.setConfigValue(chatId, pathKey, parsed);
      await api.sendMessage(chatId, `Updated ${pathKey} = ${String(current)}`);
    } catch (error) {
      await api.sendMessage(chatId, `Set failed: ${error.message}`);
    }
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
      await api.sendMessage(chatId, `Usage: /setkey <KEY> <VALUE>\nAllowed: ${SECRET_KEYS.join(', ')}`);
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
      await api.sendMessage(chatId, 'Usage: /unsetkey <KEY>');
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
      await api.sendMessage(chatId, 'Usage: /share <user_id>');
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

  return false;
}

async function processMessage(message) {
  const chatId = Number(message?.chat?.id || 0);
  const text = String(message?.text || message?.caption || '').trim();
  const incomingUsername = String(message?.from?.username || message?.chat?.username || '').trim();
  if (!chatId) return;
  const incoming = classifyIncoming(text);
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

    if (incoming.kind === 'command' && incoming.command === '/invent') {
      const seed = text.replace(/^\/invent\b/i, '').trim();
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

      await api.sendChatAction(chatId, 'upload_photo');
      await api.sendMessage(chatId, 'Inventing an expanded story...');

      const effectiveConfigPath = configStore.writeEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
      const effectiveConfig = configStore.getEffectiveConfig(chatId);
      configStore.applySecretsToEnv(chatId);
      const inventedStory = await inventStoryText(seed, effectiveConfigPath);
      await sendLongMessage(chatId, formatInventedStoryMessage(inventedStory));
      await api.sendMessage(chatId, 'Invented story ready. Generating your comic...');
      const configLine = compactConfigString(effectiveConfig);
      await api.sendMessage(chatId, configLine);
      const deliveryMode = normalizeDeliveryMode(effectiveConfig?.generation?.delivery_mode || 'default');
      const alreadySent = new Set();
      const generationId = createGenerationId(chatId);
      const result = await generatePanelsWithRuntimeConfig(inventedStory, runtime, effectiveConfigPath, {
        userId: chatId,
        generationId,
        onPanelReady: (deliveryMode === 'default')
          ? async (panelMessage) => {
              await sendPanelWithRetry(chatId, panelMessage, Number(panelMessage?.index || 1) - 1);
              alreadySent.add(Number(panelMessage?.index || 0));
            }
          : undefined
      });
      await sendPanelSequence(chatId, result, 'invent', '', alreadySent, deliveryMode, effectiveConfig);
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

    const effectiveConfigPath = configStore.writeEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
    const effectiveConfig = configStore.getEffectiveConfig(chatId);
    configStore.applySecretsToEnv(chatId);
    let generationInput = text;
    let shortPromptExpanded = false;
    let inventedStoryPreview = '';
    if (incoming.kind === 'text' && isShortTextPrompt(text)) {
      shortPromptExpanded = true;
      await api.sendMessage(
        chatId,
        'Your prompt is too short, so we need to invent a longer story first. I am using AI to expand it.'
      );
      const inventedStory = await inventStoryText(text, effectiveConfigPath);
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
    const alreadySent = new Set();
    const generationId = createGenerationId(chatId);
    const result = await generatePanelsWithRuntimeConfig(generationInput, runtime, effectiveConfigPath, {
      userId: chatId,
      generationId,
      onPanelReady: (deliveryMode === 'default')
        ? async (panelMessage) => {
            await sendPanelWithRetry(chatId, panelMessage, Number(panelMessage?.index || 1) - 1);
            alreadySent.add(Number(panelMessage?.index || 0));
          }
        : undefined
    });
    await sendPanelSequence(chatId, result, result.kind === 'url' ? 'url' : 'text', '', alreadySent, deliveryMode, effectiveConfig);
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
  const key = chatId > 0 ? String(chatId) : 'global';
  const current = chatQueues.get(key) || Promise.resolve();
  const next = current
    .then(async () => {
      if (!update?.message) return;
      await Promise.race([
        processMessage(update.message),
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
