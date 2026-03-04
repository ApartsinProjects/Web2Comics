const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

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

function waitFor(conditionFn, timeoutMs = 10000, stepMs = 120) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    async function tick() {
      try {
        if (await conditionFn()) return resolve(true);
      } catch (_) {}
      if (Date.now() - start >= timeoutMs) return reject(new Error('Timeout waiting for condition'));
      setTimeout(tick, stepMs);
    }
    tick();
  });
}

async function startFakeTelegramServer() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      calls.push({ method: req.method, url: req.url, body, raw });
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
  const env = {
    ...process.env,
    PORT: String(botPort),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'TEST_SECRET',
    TELEGRAM_API_BASE_URL: telegramBaseUrl,
    COMICBOT_ALLOWED_CHAT_IDS: '777,888',
    RENDER_BOT_STATE_FILE: statePath,
    RENDER_BOT_BASE_CONFIG: path.join(repoRoot, 'render/config/default.render.yml'),
    RENDER_BOT_OUT_DIR: path.join(repoRoot, 'render/out'),
    RENDER_BOT_FAKE_GENERATOR: 'true'
  };

  const child = spawn(process.execPath, ['render/src/webhook-bot.js'], {
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
  }, 15000, 150);

  return {
    stop: async () => {
      if (child.exitCode != null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  };
}

async function postUpdate(botPort, message, secret = 'TEST_SECRET') {
  return fetch(`http://127.0.0.1:${botPort}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': secret
    },
    body: JSON.stringify({
      update_id: Date.now(),
      message
    })
  });
}

function sentMessages(calls) {
  return calls.filter((c) => c.url.endsWith('/sendMessage'));
}

describe('render bot comprehensive interaction suite', () => {
  it('handles text and URL telegram messages and sends comic images', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-interactions-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    try {
      const textRes = await postUpdate(botPort, { chat: { id: 777 }, text: 'A short test story about robots.' });
      expect(textRes.status).toBe(200);
      await waitFor(() => tg.calls.some((c) => c.url.endsWith('/sendPhoto')), 10000, 100);
      expect(sentMessages(tg.calls).some((c) => String(c.body.text || '').includes('Generating your comic'))).toBe(true);

      const beforePhotos = tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length;
      const urlRes = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'https://example.com',
        entities: [{ offset: 0, length: 19, type: 'url' }]
      });
      expect(urlRes.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length > beforePhotos, 10000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('covers command matrix and option selection flows', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-commands-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function runCommandAndExpect(commandText, expected) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: 777 }, text: commandText });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      const last = sentMessages(tg.calls).pop();
      expect(String(last.body.text || '')).toContain(expected);
    }

    try {
      await runCommandAndExpect('/help', 'aistudio.google.com/apikey');
      await runCommandAndExpect('/presets', 'Friendly presets');
      await runCommandAndExpect('/vendor gemini', 'Provider updated: gemini');
      await runCommandAndExpect('/language en', 'Updated generation.output_language = en');
      await runCommandAndExpect('/panels 4', 'Updated generation.panel_count = 4');
      await runCommandAndExpect('/objective summarize', 'Updated generation.objective = summarize');
      await runCommandAndExpect('/detail low', 'Updated generation.detail_level = low');
      await runCommandAndExpect('/concurrency 2', 'Updated runtime.image_concurrency = 2');
      await runCommandAndExpect('/retries 1', 'Updated runtime.retries = 1');
      await runCommandAndExpect('/options generation.objective', 'Options for `generation.objective`');
      await runCommandAndExpect('/choose generation.objective 2', 'Updated generation.objective = fun');
      await runCommandAndExpect('/set generation.output_language he', 'Updated generation.output_language = he');
      await runCommandAndExpect('/credentials', 'Provider key status');
      await runCommandAndExpect('/setkey GEMINI_API_KEY SUPER_SECRET_TOKEN_123', 'Stored key GEMINI_API_KEY in runtime state.');
      const latest = sentMessages(tg.calls).pop();
      expect(String(latest.body.text || '').includes('SUPER_SECRET_TOKEN_123')).toBe(false);
      await runCommandAndExpect('/unsetkey GEMINI_API_KEY', 'Removed runtime override for GEMINI_API_KEY');
      await runCommandAndExpect('/reset_config', 'Runtime config overrides were reset to base config.');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 40000);

  it('isolates settings and keys per user, new user starts from defaults', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-users-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function command(chatId, text) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      await command(777, '/setkey GEMINI_API_KEY USER777_SECRET_ABC');
      const keyStatus777 = await command(777, '/credentials');
      expect(keyStatus777.some((m) => m.includes('GEMINI_API_KEY: set'))).toBe(true);

      const first888 = await command(888, '/credentials');
      expect(first888.some((m) => m.includes('free Gemini'))).toBe(true);
      expect(first888.some((m) => m.includes('/help  /config  /presets'))).toBe(true);
      expect(first888.some((m) => m.includes('GEMINI_API_KEY: missing'))).toBe(true);

      await command(777, '/panels 8');
      const cfg777 = await command(777, '/config');
      expect(cfg777.some((m) => m.includes('generation.panel_count: 8'))).toBe(true);

      const cfg888 = await command(888, '/config');
      expect(cfg888.some((m) => m.includes('generation.panel_count: 3'))).toBe(true);
      expect(cfg888.some((m) => m.includes('generation.panel_count: 8'))).toBe(false);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 40000);

  it('persists interaction history and caps at last 20 entries', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-history-'));
    const statePath = path.join(tmpDir, 'state.json');
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, statePath);

    try {
      for (let i = 0; i < 22; i += 1) {
        const chatId = i % 2 === 0 ? 777 : 888;
        const res = await postUpdate(botPort, { chat: { id: chatId }, text: '/help' });
        expect(res.status).toBe(200);
      }
      await waitFor(() => sentMessages(tg.calls).length >= 22, 15000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }

    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(Array.isArray(raw.history)).toBe(true);
    expect(raw.history.length).toBe(20);
    expect(raw.history.every((h) => typeof h.chatId === 'number')).toBe(true);
    expect(raw.history.every((h) => h.requestText && h.result && h.config)).toBe(true);
  }, 50000);
});
