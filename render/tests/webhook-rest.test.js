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
      calls.push({ method: req.method, url: req.url, body, raw });
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
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Web2Comics Render Bot')
      );
      expect(String(helpCall?.body?.text || '')).toContain('Web2Comics Render Bot');
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

  it('supports /credentials command and redacts sensitive values in replies', async () => {
    const tg = await startFakeTelegramServer();
    const botPort = await getFreePort();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-webhook-'));
    const bot = await startBotProcess(
      botPort,
      `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      path.join(tmpDir, 'runtime-state.json')
    );

    try {
      const credsRes = await postUpdate(botPort, { chat: { id: 777 }, text: '/credentials' });
      expect(credsRes.status).toBe(200);
      await waitFor(() => tg.calls.some((c) =>
        c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Provider key status')
      ), 8000, 100);

      const redactRes = await postUpdate(botPort, {
        chat: { id: 777 },
        text: '/set generation.style_prompt TEST_TOKEN'
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
      expect(String(updatedMsg || '')).toContain('[REDACTED]');
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
      const chunk = tg.calls.slice(before);
      const photos = chunk.filter((c) => c.url.endsWith('/sendPhoto'));
      expect(photos.length).toBeGreaterThanOrEqual(3);
      const captions = photos.slice(0, 3).map((c) => extractMultipartField(c.raw, 'caption'));
      expect(captions[0]).toContain('1. Fake panel 1');
      expect(captions[1]).toContain('2. Fake panel 2');
      expect(captions[2]).toContain('3. Fake panel 3');
      const msgTexts = chunk.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.some((m) => m.includes('Generating your comic'))).toBe(true);
      expect(msgTexts.some((m) => m.includes('Done: url -> comic panels'))).toBe(true);
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
        text: '/set runtime.retries not-a-number'
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls
        .filter((c) => c.url.endsWith('/sendMessage'))
        .map((c) => String(c.body.text || ''))
        .some((m) => m.includes('Set failed:')), 8000, 100);
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
      expect(captions[0]).toContain('1. Fake panel 1');
      expect(captions[1]).toContain('2. Fake panel 2');
      expect(captions[2]).toContain('3. Fake panel 3');
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
});
