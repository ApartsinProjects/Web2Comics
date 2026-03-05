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

function waitFor(conditionFn, timeoutMs = 10000, stepMs = 150) {
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

async function startFakeTelegramServer(options = {}) {
  const calls = [];
  let photoFailuresLeft = Number(options.failSendPhotoTimes || 0);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      calls.push({ method: req.method, url: req.url, body, raw, at: Date.now() });
      if (req.url.endsWith('/sendPhoto') && photoFailuresLeft > 0) {
        photoFailuresLeft -= 1;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, description: 'temporary sendPhoto failure' }));
        return;
      }
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
    COMICBOT_ALLOWED_CHAT_IDS: '777,888',
    RENDER_BOT_FAKE_GENERATOR: 'true',
    RENDER_BOT_STATE_FILE: statePath,
    RENDER_BOT_BASE_CONFIG: path.join(repoRoot, 'render/config/default.render.yml'),
    RENDER_BOT_OUT_DIR: path.join(repoRoot, 'render/out'),
    ...extraEnv
  };

  const child = spawn(process.execPath, ['render/src/webhook-bot.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });

  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${botPort}/healthz`);
      return res.ok;
    } catch (_) {
      return false;
    }
  }, 15000, 200);

  return {
    child,
    readLogs: () => ({ stdout, stderr }),
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

async function postRawUpdate(botPort, updatePayload, secret = 'TEST_SECRET') {
  return fetch(`http://127.0.0.1:${botPort}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': secret
    },
    body: JSON.stringify(updatePayload || {})
  });
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

describe('render webhook bot REST + telegram flow', () => {
  it('accepts webhook and sends /help response through telegram api', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/help'
      });
      expect(res.status).toBe(200);

      await waitFor(() => tg.calls.some((c) => c.url.endsWith('/sendMessage')), 8000, 100);
      const helpCall = tg.calls.find((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Web2Comic')
      );
      expect(String(helpCall?.body?.text || '')).toContain('Web2Comic');
    } finally {
      const logs = bot.readLogs();
      if (!tg.calls.length) {
        // Expose diagnostics for CI flakiness.
        // eslint-disable-next-line no-console
        console.log('[webhook-rest-test] bot stdout:', logs.stdout);
        // eslint-disable-next-line no-console
        console.log('[webhook-rest-test] bot stderr:', logs.stderr);
      }
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('help output includes one-line descriptions for all user commands', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-help-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, { chat: { id: 777 }, text: '/help' });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Commands:')
      ), 8000, 100);
      const text = tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .find((msg) => msg.includes('Commands:'));
      expect(text).toBeTruthy();

      const required = [
        '/start -',
        '/help -',
        '/welcome -',
        '/about -',
        '/version -',
        '/user -',
        '/config -',
        '/explain -',
        '/debug <on|off> -',
        '/invent <story> -',
        '/random -',
        '/panels <count> -',
        '/objective [name] -',
        '/style <preset-or-your-style> -',
        '/new_style <name> <text> -',
        '/language <code> -',
        '/mode <default|media_group|single> -',
        '/consistency <on|off> -',
        '/crazyness <0..2> -',
        '/detail <low|medium|high> -',
        '/concurrency <1..5> -',
        '/retries <0..3> -',
        '/vendor <name> -',
        '/text_vendor <name> -',
        '/image_vendor <name> -',
        '/models [text|image] [model] -',
        '/keys -',
        '/setkey <KEY> <VALUE> -',
        '/unsetkey <KEY> -',
        '/list_options -',
        '/options <path> -',
        '/prompts -',
        '/set_prompt story <text> -',
        '/set_prompt panel <text> -',
        '/set_prompt objective <name> <text> -',
        '/reset_config -',
        '/restart -'
      ];
      for (const marker of required) {
        expect(String(text)).toContain(marker);
      }
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 25000);

  it('returns unrecognized command for unknown slash commands', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-unknown-command-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, { chat: { id: 777 }, text: '/does_not_exist' });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Unrecognized command.')
      ), 8000, 100);
      const texts = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((t) => t.includes('Unrecognized command.'))).toBe(true);
      expect(texts.some((t) => t.includes('Done:'))).toBe(false);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('supports /random by generating story preview and comic panels', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-random-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, { chat: { id: 777 }, text: '/random' });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Invented story (expanded by AI):')
      ), 12000, 100);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Done: invent -> comic panels')
      ), 12000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('rejects webhook requests with invalid secret header', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, { chat: { id: 777 }, text: '/help' }, 'WRONG_SECRET');
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('invalid secret token');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('deduplicates repeated update_id payloads', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const update = {
        update_id: 42424242,
        message: { chat: { id: 777 }, text: '/user' }
      };
      const r1 = await postRawUpdate(botPort, update);
      expect(r1.status).toBe(200);
      const b1 = await r1.json();
      expect(b1.ok).toBe(true);
      expect(b1.queued).toBe(true);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && String(c.body.text || '').includes('Your user id: 777')
      ), 8000, 100);

      const before = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length;
      const r2 = await postRawUpdate(botPort, update);
      expect(r2.status).toBe(200);
      const b2 = await r2.json();
      expect(b2.ok).toBe(true);
      expect(b2.duplicate).toBe(true);
      await new Promise((r) => setTimeout(r, 600));
      const after = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length;
      expect(after).toBe(before);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('always allows admin chat id even if not in allowlist', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        COMICBOT_ALLOWED_CHAT_IDS: '777,888',
        TELEGRAM_ADMIN_CHAT_IDS: '1796415913'
      }
    );

    try {
      const res = await postUpdate(botPort, { chat: { id: 1796415913 }, text: '/user' });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Your user id: 1796415913')
      ), 8000, 100);
      const denied = tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Access denied for this bot instance')
      );
      expect(denied).toBe(false);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('supports /keys command and redacts sensitive values in replies', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const credsRes = await postUpdate(botPort, { chat: { id: 777 }, text: '/keys' });
      expect(credsRes.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Provider key status')
      ), 8000, 100);

      const redactRes = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/style TEST_TOKEN'
      });
      expect(redactRes.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('generation.style_prompt')), 8000, 100);
      const updatedMsg = tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Updated generation.style_prompt'));
      expect(String(updatedMsg || '')).toContain('Updated generation.style_prompt');
      expect(String(updatedMsg || '')).not.toContain('TEST_TOKEN');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('sends onboarding to first-time user only', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      await postUpdate(botPort, { chat: { id: 888 }, text: '/help' });
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length >= 2, 8000, 100);
      const messages = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(messages.some((m) => m.includes('free Gemini'))).toBe(true);

      const before = tg.calls.length;
      await postUpdate(botPort, { chat: { id: 888 }, text: '/help' });
      await waitFor(() => tg.calls.length > before, 8000, 100);
      const newMessages = tg.calls.slice(before).filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(newMessages.some((m) => m.includes('free Gemini'))).toBe(false);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('handles URL message and sends ordered panel photo responses', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_user', first_name: 'Url' },
        text: 'https://example.com',
        entities: [{ offset: 0, length: 19, type: 'url' }]
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 10000, 100);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const photos = chunk.filter((c) => c.url.endsWith('/sendPhoto'));
      expect(photos.length).toBeGreaterThanOrEqual(3);
      const captions = photos.slice(0, 3).map((c) => extractMultipartField(c.raw, 'caption'));
      expect(captions[0]).toContain('1(3) Fake panel 1');
      expect(captions[1]).toContain('2(3) Fake panel 2');
      expect(captions[2]).toContain('3(3) Fake panel 3');
      const msgTexts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.some((m) => m.includes('Generating your comic'))).toBe(true);
      expect(msgTexts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('keeps panel send order even when panel-ready callbacks arrive out of order', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_FAKE_OUT_OF_ORDER: 'true'
      }
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'order_user', first_name: 'Order' },
        text: 'Order test prompt'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 12000, 100);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: text -> comic panels')), 12000, 100);

      const chunk = tg.calls.slice(before);
      const photos = chunk.filter((c) => c.url.endsWith('/sendPhoto'));
      const captions = photos.slice(0, 3).map((c) => extractMultipartField(c.raw, 'caption'));
      expect(captions[0]).toContain('1(3) Fake panel 1');
      expect(captions[1]).toContain('2(3) Fake panel 2');
      expect(captions[2]).toContain('3(3) Fake panel 3');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles URL with surrounding text and still treats it as URL source', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_text_user', first_name: 'UrlText' },
        text: 'Please comicify this page: https://example.com/article about testing.'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 10000, 100);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 10000, 100);
      const chunk = tg.calls.slice(before);
      const msgTexts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('falls back to text when webpage extraction fails and reports it to user', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_FAKE_URL_FETCH_FAIL: 'true'
      }
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_fallback_user', first_name: 'Fallback' },
        text: 'Please convert this page into a comic for kids: https://example.com/article'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done:') || m.includes('Generation failed:')), 12000, 100);

      const chunk = tg.calls.slice(before);
      const msgTexts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.join('\n')).toContain("Can't extract from HTML, trying text.");
      expect(msgTexts.some((m) => m.includes('Done: text -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles video message with URL in caption (ignores video payload)', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'video_user', first_name: 'Video' },
        caption: 'https://example.com',
        video: { file_id: 'vid123', width: 320, height: 180, duration: 5 },
        caption_entities: [{ offset: 0, length: 19, type: 'url' }]
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 12000, 100);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const photos = chunk.filter((c) => c.url.endsWith('/sendPhoto'));
      expect(photos.length).toBeGreaterThanOrEqual(3);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles video caption text_link URL and treats input as URL source', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const caption = 'Check this page';
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'video_link_user', first_name: 'Video' },
        caption,
        video: { file_id: 'vid456', width: 640, height: 360, duration: 8 },
        caption_entities: [{ offset: 0, length: caption.length, type: 'text_link', url: 'https://example.com/path' }]
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 12000, 100);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const messages = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(messages.some((m) => m.includes('Generating your comic'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('does not trigger short-text expansion when short text includes URL', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'short_url_user', first_name: 'Short' },
        text: 'ok https://example.com'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes('Your prompt is too short'))).toBe(false);
      expect(texts.some((m) => m.includes('Generating your comic from the expanded story'))).toBe(false);
      expect(texts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('treats short protocol-less domain text as URL source', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'short_domain_user', first_name: 'ShortDomain' },
        text: 'example.com/story'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes('Your prompt is too short'))).toBe(false);
      expect(texts.some((m) => m.includes('Generating your comic from the expanded story'))).toBe(false);
      expect(texts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('for short protocol-less URL, falls back to invent-story flow when page load/extraction fails', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_FAKE_URL_FETCH_FAIL: 'true'
      }
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'short_domain_fallback', first_name: 'Fallback' },
        text: 'example.com'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: text -> comic panels') || m.includes('Generation failed:')), 12000, 100);

      const chunk = tg.calls.slice(before);
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes("Can't extract from HTML, inventing a story from your input."))).toBe(true);
      expect(texts.some((m) => m.includes('Invented story (expanded by AI):'))).toBe(true);
      expect(texts.some((m) => m.includes('Done: text -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles forwarded text containing URL as URL source', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'forward_user', first_name: 'Forward' },
        forward_from_chat: { id: -10012345, title: 'News Channel', type: 'channel' },
        forward_date: Math.floor(Date.now() / 1000),
        text: 'https://example.com/forwarded-story'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 10000, 100);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 12000, 100);
      const chunk = tg.calls.slice(before);
      const msgTexts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('expands short text prompt with AI story first, then generates comics', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'short_user', first_name: 'Short' },
        text: 'Space cat'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 12000, 100);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Done: text -> comic panels')
      ), 12000, 100);
      const chunk = tg.calls.slice(before);
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes('prompt is too short'))).toBe(true);
      expect(texts.some((m) => m.includes('Invented story (expanded by AI):'))).toBe(true);
      expect(texts.some((m) => m.includes('Generating your comic from the expanded story'))).toBe(true);
      expect(texts.some((m) => m.includes('Done: text -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('reports unexpected command handling errors back to user', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/setkey INVALID_KEY not-a-number'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('setkey failed:')), 8000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('validates /mode command usage and accepts valid values', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-mode-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      async function runAndCollect(text) {
        const before = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length;
        const res = await postUpdate(botPort, { chat: { id: 777 }, text });
        expect(res.status).toBe(200);
        await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length > before, 12000, 100);
        return tg.calls
          .filter((c) => c.url.endsWith('/sendMessage'))
          .slice(before)
          .map((c) => String(c.body.text || ''));
      }

      const msgs1 = await runAndCollect('/mode');
      expect(msgs1.some((m) => m.includes('Usage: /mode <name>'))).toBe(true);

      const msgs2 = await runAndCollect('/mode weird');
      expect(msgs2.some((m) => m.includes('Usage: /mode <name>'))).toBe(true);
      expect(msgs2.some((m) => m.includes('media_group'))).toBe(true);
      expect(msgs2.some((m) => m.includes('single'))).toBe(true);

      const msgs3 = await runAndCollect('/mode media_group');
      expect(msgs3.some((m) => m.includes('Updated generation.delivery_mode = media_group'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles URL generation in media_group mode', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-mode-url-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      await postUpdate(botPort, { chat: { id: 777 }, text: '/mode media_group' });
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_media_user', first_name: 'UrlMedia' },
        text: 'https://example.com'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.slice(before).some((c) => c.url.endsWith('/sendMediaGroup')), 10000, 100);
      await waitFor(() => tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: url -> comic panels')), 10000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('prints panel image prompts when /debug is enabled', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-debug-prompts-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const enable = await postUpdate(botPort, { chat: { id: 777 }, text: '/debug on' });
      expect(enable.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Updated generation.debug_prompts = on')), 8000, 100);

      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'debug_prompt_user', first_name: 'Dbg' },
        text: 'Debug panel prompts test story with enough words to avoid short mode.'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.slice(before).some((c) => c.url.endsWith('/sendPhoto')), 12000, 100);
      const texts = tg.calls
        .slice(before)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes('Image prompt 1(3):'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('refuses provider switch when required key is missing and points to manual', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        OPENAI_API_KEY: ' '
      }
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/text_vendor openai'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Provider switch blocked: missing OPENAI_API_KEY')), 8000, 100);
      const msg = tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .find((m) => m.includes('Provider switch blocked: missing OPENAI_API_KEY')) || '';
      expect(msg).toContain('deployment-runbook.md');
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('responds with explicit message for unsupported non-text updates', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        photo: [{ file_id: 'x' }]
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && String(c.body.text || '').includes('Unsupported message format')
      ), 8000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('handles telegram message combinations: text, photo+caption text/url/mixed, and image-only unsupported', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-combos-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const startCalls = tg.calls.length;

      const r1 = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'combo_user', first_name: 'Combo' },
        text: 'A normal text-only story message'
      });
      expect(r1.status).toBe(200);

      const r2 = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'combo_user', first_name: 'Combo' },
        photo: [{ file_id: 'img1' }],
        caption: 'Photo caption story text only'
      });
      expect(r2.status).toBe(200);

      const r3 = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'combo_user', first_name: 'Combo' },
        photo: [{ file_id: 'img2' }],
        caption: 'https://example.com/caption-url-story'
      });
      expect(r3.status).toBe(200);

      const r4 = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'combo_user', first_name: 'Combo' },
        photo: [{ file_id: 'img3' }],
        caption: 'Check this page https://example.com/mixed-caption and summarize'
      });
      expect(r4.status).toBe(200);

      const r5 = await postUpdate(botPort, {
        chat: { id: 777 },
        from: { id: 777, username: 'combo_user', first_name: 'Combo' },
        photo: [{ file_id: 'img4' }]
      });
      expect(r5.status).toBe(200);

      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 12, 20000, 100);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Unsupported message format')), 20000, 100);
      const chunk = tg.calls.slice(startCalls);
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));

      expect(texts.filter((m) => m.includes('Done: text -> comic panels')).length).toBeGreaterThanOrEqual(2);
      expect(texts.filter((m) => m.includes('Done: url -> comic panels')).length).toBeGreaterThanOrEqual(2);
      expect(texts.some((m) => m.includes('Unsupported message format'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 40000);

  it('reports timeout errors back to chat when a job exceeds timeout', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_JOB_TIMEOUT_MS: '120',
        RENDER_BOT_FAKE_GENERATOR_DELAY_MS: '600'
      }
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'This should timeout in test mode'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && String(c.body.text || '').includes('Unexpected bot error:')
          && String(c.body.text || '').includes('timed out after')
      ), 10000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('supports /invent flow and produces ordered panel photo responses', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before = tg.calls.length;
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/invent A shy inventor tries to impress the town.'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 3, 12000, 100);
      const chunk = tg.calls.slice(before);
      const photos = chunk.filter((c) => c.url.endsWith('/sendPhoto'));
      expect(photos.length).toBeGreaterThanOrEqual(3);
      const captions = photos.slice(0, 3).map((c) => extractMultipartField(c.raw, 'caption'));
      expect(captions[0]).toContain('1(3) Fake panel 1');
      expect(captions[1]).toContain('2(3) Fake panel 2');
      expect(captions[2]).toContain('3(3) Fake panel 3');
      const texts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(texts.some((m) => m.includes('Inventing an expanded story'))).toBe(true);
      expect(texts.some((m) => m.includes('Invented story ready'))).toBe(true);
      expect(texts.some((m) => m.includes('Done: invent -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('retries transient sendPhoto failures and still completes panel flow', async () => {
    const tg = await startFakeTelegramServer({ failSendPhotoTimes: 1 });
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const res = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'Retry photo test story'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.filter((c) => c.url.endsWith('/sendPhoto')).length >= 4, 12000, 100);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: text -> comic panels')), 12000, 100);
      const doneMessages = tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''));
      expect(doneMessages.some((m) => m.includes('Done: text -> comic panels'))).toBe(true);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('sends deploy-ready notification on startup when enabled', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        TELEGRAM_NOTIFY_ON_START: 'true',
        TELEGRAM_NOTIFY_CHAT_ID: '777'
      }
    );

    try {
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 777
          && String(c.body.text || '').includes('new version is ready')
      ), 8000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 20000);

  it('supports admin /echo on|off in test mode and echoes incoming inputs only when enabled', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-echo-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const before1 = tg.calls.length;
      await postUpdate(botPort, { chat: { id: 1796415913 }, text: '/echo on' });
      await waitFor(() => tg.calls
        .slice(before1)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Echo mode: on')), 8000, 100);

      const before2 = tg.calls.length;
      await postUpdate(botPort, { chat: { id: 777 }, text: 'Echo this text please' });
      await waitFor(() => tg.calls
        .slice(before2)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Echo input (text): Echo this text please')), 10000, 100);

      const before3 = tg.calls.length;
      await postUpdate(botPort, { chat: { id: 1796415913 }, text: '/echo off' });
      await waitFor(() => tg.calls
        .slice(before3)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Echo mode: off')), 8000, 100);

      const before4 = tg.calls.length;
      await postUpdate(botPort, { chat: { id: 777 }, text: 'No echo expected now' });
      await waitFor(() => tg.calls
        .slice(before4)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Done: text -> comic panels')), 12000, 100);
      const chunk4 = tg.calls.slice(before4)
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''));
      expect(chunk4.some((m) => m.includes('Echo input'))).toBe(false);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 40000);

  it('echoes REST input to admin chat when update source is test', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-source-test-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const marker = `source-test-${Date.now()}`;
      const before = tg.calls.length;
      const res = await postRawUpdate(botPort, {
        update_id: Date.now(),
        source: 'test',
        message: {
          chat: { id: 777 },
          from: { id: 777, username: 'rest_test_user', first_name: 'Rest' },
          source: 'test',
          text: marker
        }
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .slice(before)
        .some((c) =>
          c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 1796415913
          && String(c.body.text || '').includes('[test-source] incoming message')
          && String(c.body.text || '').includes(marker)
        ), 12000, 100);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 30000);

  it('accepts same-user follow-up request immediately while previous generation is running', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-queue-same-user-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_FAKE_GENERATOR_DELAY_MS: '1400'
      }
    );

    try {
      const beforeMessages = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length;
      const first = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'First queued story with enough words to avoid short prompt mode'
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.queued).toBe(true);

      const t0 = Date.now();
      const second = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'Second queued story with enough words to avoid short prompt mode'
      });
      const secondLatencyMs = Date.now() - t0;
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.queued).toBe(true);
      expect(secondLatencyMs).toBeLessThan(800);

      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .filter((m) => m.includes('Done: text -> comic panels')).length >= 2, 30000, 100);
      const chunk = tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .slice(beforeMessages)
        .map((c) => String(c.body.text || ''));
      expect(chunk.filter((m) => m.includes('Done: text -> comic panels')).length).toBeGreaterThanOrEqual(2);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 45000);

  it('does not block other users while one user generation is running', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-queue-cross-user-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json'),
      {
        RENDER_BOT_FAKE_GENERATOR_DELAY_MS: '1600'
      }
    );

    try {
      const first = await postUpdate(botPort, {
        chat: { id: 777 },
        text: 'Long running generation request for user 777 with enough text'
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.queued).toBe(true);

      const t0 = Date.now();
      const second = await postUpdate(botPort, {
        chat: { id: 888 },
        text: '/user'
      });
      const secondLatencyMs = Date.now() - t0;
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.queued).toBe(true);
      expect(secondLatencyMs).toBeLessThan(800);

      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 888
          && String(c.body.text || '').includes('Your user id: 888')
      ), 12000, 100);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 777
          && String(c.body.text || '').includes('Done: text -> comic panels')
      ), 25000, 100);

      const userReplyAt = tg.calls.find((c) =>
        c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 888
          && String(c.body.text || '').includes('Your user id: 888')
      )?.at || 0;
      const done777At = tg.calls.find((c) =>
        c.url.endsWith('/sendMessage')
          && Number(c.body.chat_id) === 777
          && String(c.body.text || '').includes('Done: text -> comic panels')
      )?.at || 0;
      expect(userReplyAt).toBeGreaterThan(0);
      expect(done777At).toBeGreaterThan(0);
      expect(userReplyAt).toBeLessThan(done777At);
    } finally {
      await bot.stop();
      await tg.close();
    }
  }, 45000);
});

