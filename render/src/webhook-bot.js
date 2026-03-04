const http = require('http');
const path = require('path');
const { loadEnvFiles } = require('./env');
const { TelegramApi } = require('./telegram-api');
const { RuntimeConfigStore } = require('./config-store');
const { allOptionPaths, getOptions, parseUserValue, formatOptionsMessage, SECRET_KEYS } = require('./options');
const { generateWithRuntimeConfig } = require('./generate');
const { createPersistence } = require('./persistence');
const { redactSensitiveText } = require('./redact');

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
  fetchTimeoutMs: Math.max(5000, Number(process.env.RENDER_BOT_FETCH_TIMEOUT_MS || 45000)),
  debugArtifacts: String(process.env.RENDER_BOT_DEBUG_ARTIFACTS || '').toLowerCase() === 'true',
  allowedChatIds: String(process.env.COMICBOT_ALLOWED_CHAT_IDS || '')
    .split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n))
};

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
if (!webhookSecret) throw new Error('Missing TELEGRAM_WEBHOOK_SECRET');

const api = new TelegramApi(token, process.env.TELEGRAM_API_BASE_URL || '');
let configStore = null;
const rawSendMessage = api.sendMessage.bind(api);

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

let jobQueue = Promise.resolve();

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

function isAllowedChat(chatId) {
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
  if (/^https?:\/\//i.test(t)) return { kind: 'url', command: '' };
  return { kind: 'text', command: '' };
}

function commandHelp() {
  return [
    'Web2Comics Render Bot',
    '',
    'Send plain text or URL to generate a comic image.',
    '',
    'Commands:',
    '/help',
    '/config',
    '/list_options',
    '/options <path>',
    '/choose <path> <number>',
    '/set <path> <value>',
    '/presets',
    '/vendor <name>',
    '/text_vendor <name>',
    '/image_vendor <name>',
    '/language <code>',
    '/panels <count>',
    '/objective <name>',
    '/style <preset>',
    '/detail <low|medium|high>',
    '/concurrency <1..5>',
    '/retries <0..3>',
    '/keys',
    '/credentials',
    '/setkey <KEY> <VALUE>',
    '/unsetkey <KEY>',
    '/reset_config',
    '',
    'Provider key links (Gemini free first):',
    '- Gemini: https://aistudio.google.com/apikey',
    '- OpenAI: https://platform.openai.com/api-keys',
    '- OpenRouter: https://openrouter.ai/settings/keys',
    '- Cloudflare: https://dash.cloudflare.com/profile/api-tokens',
    '- Hugging Face: https://huggingface.co/settings/tokens',
    '',
    'Docs: https://github.com/ApartsinProjects/Web2Comics/tree/engine/render'
  ].join('\n');
}

function presetsMessage() {
  return [
    'Friendly presets:',
    `- vendor: ${Object.keys(PROVIDER_DEFAULT_MODELS).join(', ')}`,
    `- language: ${getOptions('generation.output_language').join(', ')}`,
    `- objective: ${getOptions('generation.objective').join(', ')}`,
    `- panels: ${getOptions('generation.panel_count').join(', ')}`,
    `- detail: ${getOptions('generation.detail_level').join(', ')}`,
    `- style: ${Object.keys(STYLE_PRESETS).join(', ')}`,
    '',
    'Examples:',
    '/vendor gemini',
    '/language en',
    '/panels 4',
    '/objective summarize',
    '/style manga'
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

function onboardingMessage() {
  return [
    'Welcome to Web2Comics.',
    'Before generating comics, add your provider key (free Gemini first):',
    '1) Gemini key: https://aistudio.google.com/apikey',
    '2) Setup guide: https://github.com/ApartsinProjects/Web2Comics/tree/engine/render',
    'Set key: /setkey GEMINI_API_KEY <YOUR_KEY>',
    'Check: /credentials',
    '',
    'Once connected, useful commands:',
    '/help  /config  /presets  /vendor <name>  /panels <count>  /style <preset>'
  ].join('\n');
}

async function handleCommand(chatId, text) {
  const parts = splitCommand(text);
  const command = String(parts[0] || '').toLowerCase();

  if (command === '/start' || command === '/help') {
    await api.sendMessage(chatId, commandHelp());
    return true;
  }

  if (command === '/config') {
    await api.sendMessage(chatId, configStore.formatConfigSummary(chatId));
    return true;
  }

  if (command === '/presets') {
    await api.sendMessage(chatId, presetsMessage());
    return true;
  }

  if (command === '/vendor' || command === '/text_vendor' || command === '/image_vendor') {
    const vendor = String(parts[1] || '').trim().toLowerCase();
    if (!vendor) {
      await api.sendMessage(chatId, `Usage: ${command} <${Object.keys(PROVIDER_DEFAULT_MODELS).join('|')}>`);
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
    if (!value || !valueExists(options, value)) {
      await api.sendMessage(chatId, `Usage: /objective <name>\nAllowed: ${options.join(', ')}`);
      return true;
    }
    const current = await setConfigPathValue(chatId, 'generation.objective', value);
    await api.sendMessage(chatId, `Updated generation.objective = ${current}`);
    return true;
  }

  if (command === '/style') {
    const preset = String(parts[1] || '').trim().toLowerCase();
    const prompt = STYLE_PRESETS[preset];
    if (!prompt) {
      await api.sendMessage(chatId, `Usage: /style <preset>\nAllowed: ${Object.keys(STYLE_PRESETS).join(', ')}`);
      return true;
    }
    await configStore.setConfigValue(chatId, 'generation.style_prompt', prompt);
    await api.sendMessage(chatId, `Updated style preset = ${preset}`);
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
    const lines = ['Config paths with predefined options:'];
    allOptionPaths().forEach((key) => lines.push(`- ${key}`));
    await api.sendMessage(chatId, lines.join('\n'));
    return true;
  }

  if (command === '/options') {
    const pathKey = String(parts[1] || '').trim();
    if (!pathKey) {
      await api.sendMessage(chatId, 'Usage: /options <path>');
      return true;
    }
    await api.sendMessage(chatId, formatOptionsMessage(pathKey, configStore.getCurrent(chatId, pathKey)));
    return true;
  }

  if (command === '/choose') {
    const pathKey = String(parts[1] || '').trim();
    const idx = Number.parseInt(parts[2] || '', 10);
    const options = getOptions(pathKey);
    if (!pathKey || !Number.isFinite(idx) || idx < 1 || idx > options.length) {
      await api.sendMessage(chatId, 'Usage: /choose <path> <number>. Use /options <path> first.');
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

  if (command === '/keys' || command === '/credentials') {
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

  return false;
}

async function processMessage(message) {
  const chatId = Number(message?.chat?.id || 0);
  const text = String(message?.text || '').trim();
  if (!chatId || !text) return;
  const incoming = classifyIncoming(text);

  if (!isAllowedChat(chatId)) {
    await api.sendMessage(chatId, 'Access denied for this bot instance.');
    await configStore.recordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: { ok: false, type: 'denied', error: 'chat_not_allowed' },
      config: configStore.getEffectiveConfig(chatId)
    });
    return;
  }

  const firstSeen = configStore.markSeen(chatId);
  if (firstSeen) {
    await configStore.save();
    await api.sendMessage(chatId, onboardingMessage());
  }

  const handled = await handleCommand(chatId, text);
  if (handled) {
    await configStore.recordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: { ok: true, type: 'command' },
      config: configStore.getEffectiveConfig(chatId)
    });
    return;
  }

  await api.sendChatAction(chatId, 'upload_photo');
  await api.sendMessage(chatId, 'Generating your comic...');

  try {
    const effectiveConfigPath = configStore.writeEffectiveConfigFile(chatId, path.join(runtime.outDir, 'effective-config.yml'));
    configStore.applySecretsToEnv(chatId);
    const result = await generateWithRuntimeConfig(text, runtime, effectiveConfigPath);
    const caption = [
      `Done: ${result.kind === 'url' ? 'URL' : 'text'} -> comic`,
      `Panels: ${result.panelCount}`,
      `Time: ${(Number(result.elapsedMs || 0) / 1000).toFixed(1)}s`
    ].join('\n');
    await api.sendPhoto(chatId, result.outputPath, caption);
    await configStore.recordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: {
        ok: true,
        type: 'generation',
        outputPath: result.outputPath,
        panelCount: result.panelCount,
        elapsedMs: result.elapsedMs
      },
      config: configStore.getEffectiveConfig(chatId)
    });
  } catch (error) {
    await api.sendMessage(chatId, `Generation failed: ${String(error?.message || error)}`);
    await configStore.recordInteraction(chatId, {
      kind: incoming.kind,
      command: incoming.command,
      requestText: text,
      result: { ok: false, type: 'generation', error: String(error?.message || error) },
      config: configStore.getEffectiveConfig(chatId)
    });
  }
}

function enqueueUpdate(update) {
  jobQueue = jobQueue
    .then(async () => {
      if (!update?.message) return;
      await processMessage(update.message);
    })
    .catch((error) => {
      console.error('[render-bot] job failed:', error && error.message ? error.message : String(error));
    });
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

const webhookPath = `/telegram/webhook/${webhookSecret}`;

async function startServer() {
  const persistenceMode = createPersistence({
    pgUrl: process.env.RENDER_BOT_PG_URL || process.env.DATABASE_URL || '',
    pgTableName: process.env.RENDER_BOT_PG_TABLE || 'render_bot_state',
    pgStateKey: process.env.RENDER_BOT_PG_STATE_KEY || 'runtime_config',
    filePath: path.resolve(process.env.RENDER_BOT_STATE_FILE || path.join(repoRoot, 'render/data/runtime-state.json'))
  });
  configStore = new RuntimeConfigStore(
    path.resolve(process.env.RENDER_BOT_BASE_CONFIG || path.join(repoRoot, 'render/config/default.render.yml')),
    persistenceMode.impl
  );
  await configStore.load();
  configStore.applySecretsToEnv('global');

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
    console.log('[render-bot] ready');
  });
}

startServer().catch((error) => {
  console.error('[render-bot] startup failed:', error && error.message ? error.message : String(error));
  process.exit(1);
});
