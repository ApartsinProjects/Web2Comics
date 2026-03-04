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

async function startFakeTelegramServer() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      calls.push({ method: req.method, url: req.url, body });
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
    RENDER_BOT_FAKE_GENERATOR: 'true',
    RENDER_BOT_STATE_FILE: statePath,
    RENDER_BOT_BASE_CONFIG: path.join(repoRoot, 'render/config/default.render.yml'),
    RENDER_BOT_OUT_DIR: path.join(repoRoot, 'render/out')
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

  it('handles URL message and sends comic photo response', async () => {
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
        from: { id: 777, username: 'url_user', first_name: 'Url' },
        text: 'https://example.com',
        entities: [{ offset: 0, length: 19, type: 'url' }]
      });
      expect(res.status).toBe(200);
      await waitFor(() => tg.calls.some((c) => c.url.endsWith('/sendPhoto')), 10000, 100);
      const msgTexts = tg.calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => String(c.body.text || ''));
      expect(msgTexts.some((m) => m.includes('Generating your comic'))).toBe(true);
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
});
