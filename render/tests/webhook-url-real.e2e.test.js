const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnvFiles } = require('../src/env');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, 'render/.env')
]);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = Number(addr && addr.port);
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(check, timeoutMs = 90000, intervalMs = 250) {
  const start = Date.now();
  let lastErr = null;
  while ((Date.now() - start) < timeoutMs) {
    try {
      const out = await check();
      if (out) return out;
    } catch (error) {
      lastErr = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastErr) throw lastErr;
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function startFakeTelegramServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch (_) {
        body = {};
      }
      calls.push({ method: req.method, url: req.url, raw, body });
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

async function startLocalHtmlPage() {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`
      <html>
        <head><title>URL Story</title></head>
        <body>
          <h1>The Inventor and the Storm</h1>
          <p>An inventor builds a kite machine before a sudden storm.</p>
          <p>A rival steals the blueprint, but gets trapped on a tower.</p>
          <p>They team up to fix the machine and save the town lights.</p>
        </body>
      </html>
    `);
  });
  const port = await getFreePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}/story`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startBot(envOverride = {}) {
  const botPort = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(botPort),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'TEST_SECRET',
    TELEGRAM_NOTIFY_ON_START: 'false',
    ...envOverride
  };
  const child = spawn(process.execPath, ['render/src/webhook-bot.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });

  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${botPort}/healthz`);
    return res.ok;
  }, 15000, 150);

  return {
    port: botPort,
    stop: async () => {
      if (child.exitCode != null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
    stderr: () => stderr
  };
}

function postUpdate(port, message) {
  return fetch(`http://127.0.0.1:${port}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': 'TEST_SECRET'
    },
    body: JSON.stringify({
      update_id: Date.now(),
      message
    })
  });
}

describe('webhook URL real e2e', () => {
  const shouldRun = String(process.env.RUN_RENDER_REAL_GEMINI || '') === '1'
    && String(process.env.GEMINI_API_KEY || '').trim().length > 0;

  (shouldRun ? it : it.skip)('loads a real web page URL and generates comic panels from it', async () => {
    const tg = await startFakeTelegramServer();
    const page = await startLocalHtmlPage();
    const bot = await startBot({
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${tg.port}/botTEST_TOKEN`,
      COMICBOT_ALLOWED_CHAT_IDS: '777',
      TELEGRAM_ADMIN_CHAT_IDS: '777',
      RENDER_BOT_FAKE_GENERATOR: 'false'
    });

    try {
      await postUpdate(bot.port, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_real_user', first_name: 'UrlReal' },
        text: '/models text gemini-2.5-flash'
      });
      await postUpdate(bot.port, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_real_user', first_name: 'UrlReal' },
        text: '/models image gemini-2.0-flash-exp-image-generation'
      });

      const res = await postUpdate(bot.port, {
        chat: { id: 777 },
        from: { id: 777, username: 'url_real_user', first_name: 'UrlReal' },
        text: page.url
      });
      expect(res.status).toBe(200);

      await waitFor(() => tg.calls.some((c) => c.url.endsWith('/sendPhoto')), 180000, 1000);
      await waitFor(
        () => tg.calls.some((c) => c.url.endsWith('/sendMessage') && String(c.body.text || '').includes('Done: url -> comic panels')),
        180000,
        1000
      );
    } finally {
      await bot.stop();
      await page.close();
      await tg.close();
    }
  }, 240000);
});
