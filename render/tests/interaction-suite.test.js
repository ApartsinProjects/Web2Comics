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

async function startBotProcess(botPort, telegramBaseUrl, statePath, extraEnv = {}) {
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
    RENDER_BOT_FAKE_GENERATOR: 'true',
    ...extraEnv
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
      expect(sentMessages(tg.calls).every((c) => c.body.protect_content === false)).toBe(true);
      const firstPhoto = tg.calls.find((c) => c.url.endsWith('/sendPhoto'));
      expect(extractMultipartField(firstPhoto && firstPhoto.raw, 'protect_content')).toBe('false');

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
      await runCommandAndExpect('/about', 'Alexander (Sasha) Apartsin');
      await runCommandAndExpect('/explain', 'Generation summary line format:');
      await runCommandAndExpect('/explain', 'm:<delivery_mode>');
      const helpMsgs = sentMessages(tg.calls).map((c) => String(c.body.text || ''));
      expect(helpMsgs.some((m) => m.includes('/peek'))).toBe(false);
      await runCommandAndExpect('/presets', 'Friendly presets');
      await runCommandAndExpect('/vendor gemini', 'Provider updated: gemini');
      await runCommandAndExpect('/language en', 'Updated generation.output_language = en');
      await runCommandAndExpect('/mode media_group', 'Updated generation.delivery_mode = media_group');
      await runCommandAndExpect('/panels 4', 'Updated generation.panel_count = 4');
      await runCommandAndExpect('/objective', 'Available objectives:');
      await runCommandAndExpect('/objective summarize', 'Updated generation.objective = summarize');
      await runCommandAndExpect('/crazyness 1.2', 'Updated generation.invent_temperature = 1.2');
      await runCommandAndExpect('/detail low', 'Updated generation.detail_level = low');
      await runCommandAndExpect('/new_style my-style bold inks, dramatic shadows', "Saved style 'my-style'");
      await runCommandAndExpect('/style my-style', 'Updated style preset = my-style');
      await runCommandAndExpect('/set_style cinematic hand-drawn frames', 'Updated generation.style_prompt');
      await runCommandAndExpect('/set_prompt story Focus on cause and effect', 'Updated generation.custom_story_prompt');
      await runCommandAndExpect('/set_prompt panel Keep faces expressive', 'Updated generation.custom_panel_prompt');
      await runCommandAndExpect('/set_prompt objective summarize Keep it extra concise', 'Updated objective prompt override for summarize');
      await runCommandAndExpect('/prompts', 'Prompt catalog');
      await runCommandAndExpect('/prompts', 'Story summary: <storyboard.description short summary>');
      await runCommandAndExpect('/prompts', 'Panel visual brief: <panel.image_prompt>');
      await runCommandAndExpect('/concurrency 2', 'Updated runtime.image_concurrency = 2');
      await runCommandAndExpect('/retries 1', 'Updated runtime.retries = 1');
      await runCommandAndExpect('/options', 'Config paths with predefined options:');
      await runCommandAndExpect('/options generation.objective', 'Options for `generation.objective`');
      await runCommandAndExpect('/choose', 'Config paths with predefined options:');
      await runCommandAndExpect('/choose generation.objective 2', 'Updated generation.objective = fun');
      await runCommandAndExpect('/set generation.output_language he', 'Updated generation.output_language = he');
      await runCommandAndExpect('/credentials', 'Provider key status');
      await runCommandAndExpect('/setkey GEMINI_API_KEY SUPER_SECRET_TOKEN_123', 'Stored key GEMINI_API_KEY in runtime state.');
      const latest = sentMessages(tg.calls).pop();
      expect(String(latest.body.text || '').includes('SUPER_SECRET_TOKEN_123')).toBe(false);
      await runCommandAndExpect('/unsetkey GEMINI_API_KEY', 'Removed runtime override for GEMINI_API_KEY');
      await runCommandAndExpect('/restart', 'Your bot state was restarted to defaults.');
      await runCommandAndExpect('/reset_default', 'Runtime config overrides were reset to base config.');
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
      expect(adminHelp.some((m) => m.includes('/log'))).toBe(true);
      expect(adminHelp.some((m) => m.includes('/users'))).toBe(true);
      expect(adminHelp.some((m) => m.includes('/ban'))).toBe(true);
      expect(adminHelp.some((m) => m.includes('/unban'))).toBe(true);

      const nonAdminHelp = await command(888, '/help');
      expect(nonAdminHelp.some((m) => m.includes('Admin commands:'))).toBe(false);

      const deny = await command(777, '/share 888');
      expect(deny.some((m) => m.includes('Access denied.'))).toBe(true);
      const denyUsers = await command(777, '/users');
      expect(denyUsers.some((m) => m.includes('Access denied.'))).toBe(true);

      const users = await command(1796415913, '/users');
      expect(users.some((m) => m.includes('Known users:'))).toBe(true);
      expect(users.some((m) => m.includes('777'))).toBe(true);
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

  it('supports admin /ban and /unban by id or username', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-ban-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function command(chatId, text, fromUsername = '') {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, {
        chat: { id: chatId, username: fromUsername || undefined },
        from: { id: chatId, username: fromUsername || undefined },
        text
      });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      const empty = await command(1796415913, '/ban');
      expect(empty.some((m) => m.includes('Banned users: none'))).toBe(true);

      const denied = await command(777, '/ban 888', 'user777');
      expect(denied.some((m) => m.includes('Access denied.'))).toBe(true);

      const byId = await command(1796415913, '/ban 888');
      expect(byId.some((m) => m.includes('Added to blacklist: 888'))).toBe(true);

      const blockedUser = await command(888, '/user', 'user888');
      expect(blockedUser.some((m) => m.includes('Access denied: banned user.'))).toBe(true);

      await command(777, '/help', 'target_username');
      const byName = await command(1796415913, '/ban target_username');
      expect(byName.some((m) => m.includes('Added to blacklist: target_username'))).toBe(true);
      expect(byName.some((m) => m.includes('username: @target_username'))).toBe(true);

      const blockedByName = await command(777, 'A normal story prompt', 'target_username');
      expect(blockedByName.some((m) => m.includes('Access denied: banned user.'))).toBe(true);

      const listed = await command(1796415913, '/ban');
      expect(listed.some((m) => m.includes('Banned users:'))).toBe(true);
      expect(listed.some((m) => m.includes('ids: 888'))).toBe(true);
      expect(listed.some((m) => m.includes('@target_username'))).toBe(true);

      const denyUnban = await command(777, '/unban 888', 'user777');
      expect(denyUnban.some((m) => m.includes('Access denied'))).toBe(true);

      const unbanById = await command(1796415913, '/unban 888');
      expect(unbanById.some((m) => m.includes('Removed from blacklist: 888'))).toBe(true);
      const userBack = await command(888, '/user', 'user888');
      expect(userBack.some((m) => m.includes('Your user id: 888'))).toBe(true);

      const unbanByName = await command(1796415913, '/unban target_username');
      expect(unbanByName.some((m) => m.includes('Removed from blacklist: target_username'))).toBe(true);
      const byNameBack = await command(777, '/help', 'target_username');
      expect(byNameBack.some((m) => m.includes('Web2Comic'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('enforces share flow: blocked without key, allowed with shared key, own key overrides shared', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-share-override-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'state.json'),
      {
        OPENAI_API_KEY: ' '
      }
    );

    async function command(chatId, text) {
      const before = sentMessages(tg.calls).length;
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
      await waitFor(() => sentMessages(tg.calls).length > before, 8000, 100);
      return sentMessages(tg.calls).slice(before).map((c) => String(c.body.text || ''));
    }

    try {
      const blocked = await command(888, '/text_vendor openai');
      expect(blocked.some((m) => m.includes('Provider switch blocked: missing OPENAI_API_KEY'))).toBe(true);

      await command(1796415913, '/setkey OPENAI_API_KEY ADMIN_OPENAI_KEY_123');
      const shared = await command(1796415913, '/share 888');
      expect(shared.some((m) => m.includes('Shared your runtime keys with user 888'))).toBe(true);

      const allowedAfterShare = await command(888, '/text_vendor openai');
      expect(allowedAfterShare.some((m) => m.includes('Provider updated: openai'))).toBe(true);

      const sharedCreds = await command(888, '/credentials');
      expect(sharedCreds.some((m) => m.includes('OPENAI_API_KEY: set (shared:1796415913)'))).toBe(true);

      await command(888, '/setkey OPENAI_API_KEY USER_OWN_OPENAI_KEY_456');
      const ownCreds = await command(888, '/credentials');
      expect(ownCreds.some((m) => m.includes('OPENAI_API_KEY: set (runtime)'))).toBe(true);

      const allowedWithOwn = await command(888, '/text_vendor openai');
      expect(allowedWithOwn.some((m) => m.includes('Provider updated: openai'))).toBe(true);
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
      expect(cfg888.some((m) => m.includes('generation.panel_count: 8'))).toBe(true);
      expect(cfg888.some((m) => m.includes('generation.panel_count: 3'))).toBe(false);
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

  it('supports hidden /peek list and selection variants for latest generated comics', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-peek-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function send(chatId, text) {
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
    }

    try {
      for (let i = 1; i <= 6; i += 1) {
        const chatId = i % 2 === 0 ? 777 : 888;
        await send(chatId, `Generated comic seed ${i} for peek`);
      }
      await waitFor(() => sentMessages(tg.calls)
        .map((c) => String(c.body.text || ''))
        .filter((m) => m.includes('Done: text -> comic panels')).length >= 6, 20000, 100);
      await new Promise((r) => setTimeout(r, 600));
      const before = sentMessages(tg.calls).length;
      await send(777, '/peek');
      await waitFor(() => sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Last 10 generated comics:')), 10000, 100);
      const text = sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Last 10 generated comics:')) || '';
      expect(text).toContain('Last 10 generated comics:');
      expect((text.match(/^\d+\./gm) || []).length).toBe(6);
      expect(text).toContain('|');
      expect(text).toContain('Use /peek <number> to view one item.');

      const beforePeek5 = sentMessages(tg.calls).length;
      await send(777, '/peek5');
      await waitFor(() => sentMessages(tg.calls)
        .slice(beforePeek5)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Comic 5 of')), 10000, 100);
      const text5 = sentMessages(tg.calls)
        .slice(beforePeek5)
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Comic 5 of')) || '';
      expect(text5).toContain('date:');
      expect(text5).toContain('user:');
      expect(text5).toContain('name:');
      expect(text5).toContain('image:');
      expect(text5.toLowerCase()).toContain('users');
      expect(text5.toLowerCase()).toContain('generations');

      const beforePeek3 = sentMessages(tg.calls).length;
      await send(777, '/peek 3');
      await waitFor(() => sentMessages(tg.calls)
        .slice(beforePeek3)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Comic 3 of')), 10000, 100);
      const text3 = sentMessages(tg.calls)
        .slice(beforePeek3)
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Comic 3 of')) || '';
      expect(text3).toContain('name:');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('supports admin /log with count variants for latest logs', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-log-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function send(chatId, text) {
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
    }

    try {
      for (let i = 1; i <= 7; i += 1) {
        const chatId = i % 2 === 0 ? 777 : 888;
        await send(chatId, `/set output.width ${1200 + i}`);
      }
      await new Promise((r) => setTimeout(r, 700));

      const before = sentMessages(tg.calls).length;
      await send(1796415913, '/log');
      await waitFor(() => sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Last 10 logs:')), 20000, 150);
      const text = sentMessages(tg.calls)
        .slice(before)
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Last 10 logs:')) || '';
      expect(text).toContain('user:');
      expect(text).toContain('type:');
      expect(text).toContain('msg:');

      const before3 = sentMessages(tg.calls).length;
      await send(1796415913, '/log3');
      await waitFor(() => sentMessages(tg.calls)
        .slice(before3)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Last 3 logs:')), 20000, 150);

      const before2 = sentMessages(tg.calls).length;
      await send(1796415913, '/log 2');
      await waitFor(() => sentMessages(tg.calls)
        .slice(before2)
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Last 2 logs:')), 20000, 150);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 70000);

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
      expect(cfg.some((m) => m.includes('generation.panel_count: 8'))).toBe(true);
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
      expect(c777[0]).toContain('1(3)');
      expect(c777[1]).toContain('2(3)');
      expect(c777[2]).toContain('3(3)');
      expect(c888[0]).toContain('1(3)');
      expect(c888[1]).toContain('2(3)');
      expect(c888[2]).toContain('3(3)');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 50000);

  it('supports /mode delivery options: default, media_group, single', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-mode-'));
    const bot = await startBotProcess(botPort, `http://127.0.0.1:${tg.port}/botTEST_TOKEN`, path.join(tmpDir, 'state.json'));

    async function send(chatId, text) {
      const res = await postUpdate(botPort, { chat: { id: chatId }, text });
      expect(res.status).toBe(200);
    }

    try {
      async function waitDoneOrFail(fromIndex, timeoutMs = 20000) {
        await waitFor(() => {
          const msgs = sentMessages(tg.calls).slice(fromIndex).map((c) => String(c.body.text || ''));
          if (msgs.some((m) => m.includes('Generation failed:'))) return true;
          return msgs.some((m) => m.includes('Done: text -> comic panels'));
        }, timeoutMs, 100);
        const msgs = sentMessages(tg.calls).slice(fromIndex).map((c) => String(c.body.text || ''));
        const fail = msgs.find((m) => m.includes('Generation failed:'));
        if (fail) throw new Error(`Mode generation failed: ${fail}`);
      }

      const beforeDefault = tg.calls.length;
      const beforeDefaultMsgs = sentMessages(tg.calls).length;
      await send(777, '/mode default');
      await send(777, 'Mode default story');
      await waitDoneOrFail(beforeDefaultMsgs);
      expect(tg.calls.slice(beforeDefault).some((c) => c.url.endsWith('/sendMediaGroup'))).toBe(false);
      expect(tg.calls.slice(beforeDefault).filter((c) => c.url.endsWith('/sendPhoto')).length).toBeGreaterThanOrEqual(3);

      const beforeGroup = tg.calls.length;
      const beforeGroupMsgs = sentMessages(tg.calls).length;
      await send(777, '/mode media_group');
      await send(777, 'Mode media group story');
      await waitDoneOrFail(beforeGroupMsgs);
      await waitFor(() => tg.calls.slice(beforeGroup).some((c) => c.url.endsWith('/sendMediaGroup')), 20000, 100);
      const mg = tg.calls.slice(beforeGroup).find((c) => c.url.endsWith('/sendMediaGroup'));
      const mediaRaw = extractMultipartField(mg && mg.raw, 'media');
      expect(mediaRaw).toContain('"type":"photo"');
      expect(mediaRaw).toContain('"caption"');
      expect(extractMultipartField(mg && mg.raw, 'protect_content')).toBe('false');

      const beforeSingle = tg.calls.length;
      const beforeSingleMsgs = sentMessages(tg.calls).length;
      await send(777, '/mode single');
      await send(777, 'Mode single story');
      await waitDoneOrFail(beforeSingleMsgs);
      await waitFor(() => tg.calls.slice(beforeSingle).filter((c) => c.url.endsWith('/sendPhoto')).length >= 1, 20000, 100);
      expect(tg.calls.slice(beforeSingle).some((c) => c.url.endsWith('/sendMediaGroup'))).toBe(false);
      const singlePhoto = tg.calls.slice(beforeSingle).find((c) => c.url.endsWith('/sendPhoto'));
      const cap = extractMultipartField(singlePhoto && singlePhoto.raw, 'caption');
      expect(cap).toContain('Panels:');
      expect(cap).toContain('1.');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 60000);
});
