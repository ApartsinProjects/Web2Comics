const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { STYLE_SHORTCUTS, OBJECTIVE_SHORTCUTS } = require('../src/data/styles-objectives');

let updateSeq = 1;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitFor(conditionFn, timeoutMs = 15000, stepMs = 120) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    async function tick() {
      try {
        const ok = await conditionFn();
        if (ok) return resolve(true);
      } catch (_) {}
      if (Date.now() - start >= timeoutMs) return reject(new Error('Timeout waiting for condition'));
      setTimeout(tick, stepMs);
    }
    tick();
  });
}

async function startFakeTelegramServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      calls.push({ method: req.method, url: req.url, body, raw, at: Date.now() });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { ok: true } }));
    });
  });
  const port = await getFreePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    calls,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startBotProcess(botPort, telegramBaseUrl, statePath) {
  const repoRoot = path.resolve(__dirname, '../..');
  const stateDir = path.dirname(statePath);
  const isolatedOutDir = path.join(stateDir, 'out');
  const isolatedCfgsDir = path.join(stateDir, 'cfgs');
  const isolatedDataDir = path.join(stateDir, 'data');
  fs.mkdirSync(isolatedOutDir, { recursive: true });
  fs.mkdirSync(isolatedCfgsDir, { recursive: true });
  fs.mkdirSync(isolatedDataDir, { recursive: true });
  const env = {
    ...process.env,
    PORT: String(botPort),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'TEST_SECRET',
    TELEGRAM_API_BASE_URL: telegramBaseUrl,
    COMICBOT_ALLOWED_CHAT_IDS: '777,888',
    TELEGRAM_ADMIN_CHAT_IDS: '888',
    RENDER_BOT_FAKE_GENERATOR: 'true',
    RENDER_BOT_FAKE_URL_EXTRACTOR: 'true',
    RENDER_BOT_FAKE_IMAGE_EXTRACTOR: 'true',
    RENDER_BOT_STATE_FILE: statePath,
    RENDER_BOT_BASE_CONFIG: path.join(repoRoot, 'telegram/config/default.render.yml'),
    RENDER_BOT_OUT_DIR: isolatedOutDir,
    RENDER_BOT_CFGS_DIR: isolatedCfgsDir,
    RENDER_BOT_BLACKLIST_FILE: path.join(isolatedDataDir, 'blacklist.json'),
    RENDER_BOT_KNOWN_USERS_FILE: path.join(isolatedDataDir, 'known-users.json'),
    RENDER_BOT_ASYNC_CHROMIUM_WARMUP: 'false',
    TELEGRAM_BOT_TOKEN_FILE: '',
    TELEGRAM_WEBHOOK_SECRET_FILE: '',
    GEMINI_API_KEY_FILE: '',
    OPENAI_API_KEY_FILE: '',
    OPENROUTER_API_KEY_FILE: '',
    HUGGINGFACE_INFERENCE_API_TOKEN_FILE: '',
    CLOUDFLARE_WORKERS_AI_TOKEN_FILE: '',
    CLOUDFLARE_ACCOUNT_API_TOKEN_FILE: '',
    CLOUDFLARE_API_TOKEN_FILE: '',
    FIRECRAWL_API_KEY_FILE: '',
    JINA_API_KEY_FILE: '',
    DRIFTBOT_API_KEY_FILE: '',
    UNSTRUCTURED_API_KEY_FILE: '',
    LLAMA_CLOUD_API_KEY_FILE: '',
    ASSEMBLYAI_API_KEY_FILE: '',
    GROQ_API_KEY_FILE: '',
    COHERE_API_KEY_FILE: '',
    R2_ACCESS_KEY_ID_FILE: '',
    R2_SECRET_ACCESS_KEY_FILE: ''
  };

  const child = spawn(process.execPath, ['telegram/src/webhook-bot.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${botPort}/healthz`);
      return res.ok;
    } catch (_) {
      return false;
    }
  });

  return {
    stop: async () => {
      if (child.exitCode != null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  };
}

async function postUpdate(botPort, text) {
  const updateId = Date.now() * 1000 + (updateSeq++);
  return fetch(`http://127.0.0.1:${botPort}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': 'TEST_SECRET'
    },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        chat: { id: 777 },
        from: { id: 777, username: 'command_user', first_name: 'Cmd' },
        text
      }
    })
  });
}

function userCommandSamples() {
  const styleShortcuts = Object.keys(STYLE_SHORTCUTS);
  const objectiveShortcuts = Object.keys(OBJECTIVE_SHORTCUTS);
  return [
    '/start',
    '/help',
    '/welcome',
    '/about',
    '/version',
    '/user',
    '/config',
    '/explain',
    '/prompts',
    '/objective',
    '/objective fun',
    '/objectives',
    ...objectiveShortcuts,
    '/style',
    '/style noir',
    '/styles',
    ...styleShortcuts,
    '/new_style my-style cinematic linework high contrast',
    '/language en',
    '/panels 4',
    '/mode default',
    '/mode media_group',
    '/mode single',
    '/consistency on',
    '/detail medium',
    '/crazyness 1.2',
    '/vendors',
    '/vendors text',
    '/vendor text gemini',
    '/vendor image gemini',
    '/vendor url jina',
    '/vendor pdf llamaparse',
    '/vendor image_extract gemini',
    '/vendor voice assemblyai',
    '/vendor enrich wikipedia',
    '/vendor enrich_fallback gemini',
    '/models',
    '/models text',
    '/models image',
    '/models url',
    '/models image_extract',
    '/models pdf',
    '/models voice',
    '/test',
    '/keys',
    '/setkey GEMINI_API_KEY test-key',
    '/unsetkey GEMINI_API_KEY',
    '/debug on',
    '/set_prompt story keep it concise and coherent',
    '/set_prompt panel clean composition no text',
    '/set_prompt objective summarize clear and factual',
    '/concurrency 2',
    '/retries 1',
    '/options generation.objective',
    '/list_options',
    '/reset_config',
    '/restart',
    '/extractor',
    '/pdf_extractor',
    '/image_extractor',
    '/voice_extractor',
    '/text_vendor',
    '/image_vendor',
    '/invent tiny seed for testing',
    '/random'
  ];
}

function splitIntoChunks(items, size = 12) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function hasInvalidCommandText(line) {
  const text = String(line || '').toLowerCase();
  return text.includes('unrecognized command') || text.includes('invalid command');
}

describe('user command coverage', () => {
  const commands = userCommandSamples();
  const commandGroups = splitIntoChunks(commands, 12);

  commandGroups.forEach((group, index) => {
    it(`handles command batch ${index + 1}/${commandGroups.length} without invalid fallback`, async () => {
      const tg = await startFakeTelegramServer();
      const botPort = await getFreePort();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `render-bot-cmds-${index + 1}-`));
      const bot = await startBotProcess(
        botPort,
        `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
        path.join(tmpDir, 'runtime-state.json')
      );

      try {
        for (const cmd of group) {
          const before = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length;
          const res = await postUpdate(botPort, cmd);
          expect(res.status).toBe(200);
          await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length > before, 40000, 120);
          const chunk = tg.calls
            .filter((c) => c.url.endsWith('/sendMessage'))
            .slice(before)
            .map((c) => String(c.body?.text || ''));
          const invalidLine = chunk.find((line) => hasInvalidCommandText(line));
          expect(invalidLine, `Unexpected invalid fallback for ${cmd}: ${invalidLine || ''}`).toBeUndefined();
        }
      } finally {
        await bot.stop();
        await tg.close();
      }
    }, 120000);
  });
});

