const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
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
    COMICBOT_ALLOWED_CHAT_IDS: '777,888,1796415913',
    TELEGRAM_ADMIN_CHAT_IDS: '1796415913',
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
  const updateId = Date.now() * 1000 + (updateSeq++);
  return fetch(`http://127.0.0.1:${botPort}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': secret
    },
    body: JSON.stringify({
      update_id: updateId,
      message
    })
  });
}

function sentMessages(calls) {
  return calls.filter((c) => c.url.endsWith('/sendMessage'));
}

function extractMultipartField(raw, fieldName) {
  const text = String(raw || '');
  const marker = `name="${fieldName}"`;
  const pos = text.indexOf(marker);
  if (pos < 0) return '';
  const start = text.indexOf('\r\n\r\n', pos);
  if (start < 0) return '';
  const end = text.indexOf('\r\n--', start + 4);
  if (end < 0) return '';
  return text.slice(start + 4, end).trim();
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
      const chunk = sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
      expect(chunk.some((m) => m.includes(expected))).toBe(true);
    }

    try {
      await runCommandAndExpect('/help', 'aistudio.google.com/apikey');
      await runCommandAndExpect('/help', '/invent <story>');
      const helpMsgs = sentMessages(tg.calls).map((c) => String(c.body.text || ''));
      expect(helpMsgs.some((m) => m.includes('/peek'))).toBe(false);
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
      await runCommandAndExpect('/restart', 'Your bot state was restarted to defaults.');
      await runCommandAndExpect('/reset_config', 'Runtime config overrides were reset to base config.');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 40000);

  it('supports /user command and admin-only help/commands', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-admin-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function command(chatId, text) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      const userMsg = await command(777, '/user');
      expect(userMsg.some((m) => m.includes('Your user id: 777'))).toBe(true);

      const adminHelp = await command(1796415913, '/help');
      expect(adminHelp.some((m) => m.includes('Admin commands:'))).toBe(true);
      expect(adminHelp.some((m) => m.includes('/share <user_id>'))).toBe(true);

      const nonAdminHelp = await command(888, '/help');
      expect(nonAdminHelp.some((m) => m.includes('Admin commands:'))).toBe(false);

      const deny = await command(777, '/share 888');
      expect(deny.some((m) => m.includes('Access denied.'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('lets admin share keys with another user', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-share-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function command(chatId, text) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      await command(1796415913, '/setkey GEMINI_API_KEY ADMIN_SHARED_KEY_1');
      await command(1796415913, '/share 888');
      const creds = await command(888, '/credentials');
      expect(creds.some((m) => m.includes('GEMINI_API_KEY: set (shared:1796415913)'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

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
      expect(first888.some((m) => m.includes('GEMINI_API_KEY: set (env)'))).toBe(true);

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

  it('stores new user profile metadata from telegram message', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-profile-'));
    const statePath = path.join(tmpDir, 'state.json');
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, statePath);

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 888, type: 'private', username: 'profile_chat' },
        from: {
          id: 888,
          username: 'profile_user',
          first_name: 'John',
          last_name: 'Doe',
          language_code: 'en',
          is_bot: false
        },
        text: '/help'
      });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length >= 1, 8000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }

    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(raw.users['888'].profile.user.username).toBe('profile_user');
    expect(raw.users['888'].profile.user.first_name).toBe('John');
    expect(raw.users['888'].profile.user.language_code).toBe('en');
    expect(raw.users['888'].profile.chat.username).toBe('profile_chat');
  }, 30000);

  it('supports hidden /peek with latest 10 global requests', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-peek-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function send(chatId, text) {
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
    }

    try {
      for (let i = 1; i <= 12; i += 1) {
        const chatId = i % 2 === 0 ? 777 : 888;
        await send(chatId, `/set output.width ${1000 + i}`);
      }
      const before = sentMessages(tg.calls).length;
      await send(777, '/peek');
      await waitFor(() => sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Last 10 global requests:')), 10000, 100);
      const text = sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Last 10 global requests:')) || '';
      expect(text).toContain('Last 10 global requests:');
      expect((text.match(/^\d+\./gm) || []).length).toBe(10);
      expect(text).toContain('user:');
      expect(text).toContain('msg:');
      expect(text).toContain('cfg:');
      expect(text).toContain('image:');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('restarts user state to defaults and clears runtime keys', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-restart-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function command(text) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: 777 }, text });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      await command('/setkey GEMINI_API_KEY SECRET777');
      await command('/panels 8');
      await command('/restart');
      const creds = await command('/credentials');
      expect(creds.some((m) => m.includes('GEMINI_API_KEY: set (env)'))).toBe(true);
      const cfg = await command('/config');
      expect(cfg.some((m) => m.includes('generation.panel_count: 3'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('processes multiple users concurrently while preserving per-user panel order', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-concurrency-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    try {
      const before = tg.calls.length;
      const [r1, r2] = await Promise.all([
        postUpdate(botPort, { chat: { id: 777 }, text: 'Story A for user 777' }),
        postUpdate(botPort, { chat: { id: 888 }, text: 'Story B for user 888' })
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 6, 12000, 100);
      const chunk = tg.calls.slice(before).filter((c) => c.url.endsWith('/sendPhoto'));
      const byChat = new Map();
      chunk.forEach((c) => {
        const chatId = String(extractMultipartField(c.raw, 'chat_id'));
        const caption = extractMultipartField(c.raw, 'caption');
        if (!byChat.has(chatId)) byChat.set(chatId, []);
        byChat.get(chatId).push(caption);
      });

      const c777 = byChat.get('777') || [];
      const c888 = byChat.get('888') || [];
      expect(c777.length).toBeGreaterThanOrEqual(3);
      expect(c888.length).toBeGreaterThanOrEqual(3);
      expect(c777[0]).toContain('1.');
      expect(c777[1]).toContain('2.');
      expect(c777[2]).toContain('3.');
      expect(c888[0]).toContain('1.');
      expect(c888[1]).toContain('2.');
      expect(c888[2]).toContain('3.');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);
});
