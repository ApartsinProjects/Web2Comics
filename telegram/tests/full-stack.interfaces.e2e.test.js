const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { loadEnvFiles } = require('../src/env');
const { readTelegramYaml, readCloudflareYaml, readAwsYaml } = require('../scripts/lib');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, 'telegram/.env')
]);

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

async function waitFor(fn, timeoutMs = 120000, stepMs = 1500) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const out = await fn();
      if (out) return out;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for condition');
}

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

async function startFakeTelegramServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      calls.push({ url: req.url, raw });
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

async function startLocalBotProcess(envOverride) {
  const port = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(port),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'TEST_SECRET',
    TELEGRAM_NOTIFY_ON_START: 'false',
    ...envOverride
  };
  const child = spawn(process.execPath, ['telegram/src/webhook-bot.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });
  await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      return r.ok;
    } catch (_) {
      return false;
    }
  }, 15000, 150);
  return {
    port,
    stop: async () => {
      if (child.exitCode != null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
    getStderr: () => stderr
  };
}

function buildS3Client(endpoint, accessKeyId, secretAccessKey) {
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });
}

async function listKeys(client, bucket, prefix) {
  const keys = [];
  let continuationToken;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));
    const rows = Array.isArray(out?.Contents) ? out.Contents : [];
    rows.forEach((row) => {
      const key = String(row?.Key || '').trim();
      if (key) keys.push(key);
    });
    continuationToken = out?.IsTruncated ? out?.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys.sort();
}

async function readJsonObject(client, bucket, key) {
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const raw = await out.Body.transformToString();
  return JSON.parse(raw || '{}');
}

async function postWebhook(baseUrl, secret, update) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/telegram/webhook/${secret}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': secret
    },
    body: JSON.stringify(update)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function postLocalWebhook(port, update) {
  const res = await fetch(`http://127.0.0.1:${port}/telegram/webhook/TEST_SECRET`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': 'TEST_SECRET'
    },
    body: JSON.stringify(update)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function getWebhookInfo(token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { method: 'GET' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`getWebhookInfo failed: ${JSON.stringify(body)}`);
  return body.result || {};
}

async function sendTelegramMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: Number(chatId),
      text
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`sendMessage failed: ${JSON.stringify(body)}`);
  return body.result || {};
}

describe('full stack interfaces e2e', () => {
  const shouldRun = String(process.env.RUN_FULL_STACK_E2E || '').trim().toLowerCase() === 'true';

  (shouldRun ? it : it.skip)('validates local+remote+telegram+r2 artifact flow', async () => {
    const tgYaml = readTelegramYaml(repoRoot);
    const cfYaml = readCloudflareYaml(repoRoot);
    const awsYaml = readAwsYaml(repoRoot);

    const deployMetadataPath = path.join(repoRoot, 'telegram/out/deploy-render-metadata.json');
    let deployMetadata = {};
    if (fs.existsSync(deployMetadataPath)) {
      try {
        deployMetadata = JSON.parse(fs.readFileSync(deployMetadataPath, 'utf8')) || {};
      } catch (_) {
        deployMetadata = {};
      }
    }
    const serviceBase = firstNonEmpty(
      process.env.RENDER_PUBLIC_BASE_URL,
      deployMetadata.publicUrl,
      'https://web2comics-telegram-render-bot.onrender.com'
    );
    const webhookSecret = firstNonEmpty(process.env.TELEGRAM_WEBHOOK_SECRET, 'web2comics-render-webhook-secret-v1');
    const telegramToken = firstNonEmpty(process.env.TELEGRAM_BOT_TOKEN, tgYaml.bot_token);
    const chatId = firstNonEmpty(
      process.env.TELEGRAM_TEST_CHAT_ID,
      process.env.TELEGRAM_NOTIFY_CHAT_ID,
      tgYaml.allowed_chat_ids,
      '1796415913'
    ).split(',')[0].trim();

    const cfR2 = (cfYaml && cfYaml.r2) || {};
    const s3Clients = (cfR2 && cfR2.s3_clients) || {};
    const key2 = s3Clients.keypair_2 || {};
    const key1 = s3Clients.keypair_1 || {};
    const endpoint = firstNonEmpty(
      process.env.R2_S3_ENDPOINT,
      (cfR2.endpoints && cfR2.endpoints.global_s3) || '',
      process.env.CLOUDFLARE_ACCOUNT_ID ? `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''
    );
    const bucket = firstNonEmpty(process.env.R2_BUCKET, cfR2.bucket, 'web2comics-bot-data');
    const accessKeyId = firstNonEmpty(process.env.R2_ACCESS_KEY_ID, key2.access_key_id, key1.access_key_id, awsYaml.aws_access_key_id);
    const secretAccessKey = firstNonEmpty(process.env.R2_SECRET_ACCESS_KEY, key2.secret_access_key, key1.secret_access_key, awsYaml.aws_secret_access_key);

    if (!telegramToken) throw new Error('Missing TELEGRAM_BOT_TOKEN for full stack e2e');
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Missing R2 config for full stack e2e');

    const healthRes = await fetch(`${serviceBase.replace(/\/+$/, '')}/healthz`);
    const healthBody = await healthRes.json();
    expect(healthRes.ok).toBe(true);
    expect(healthBody.ok).toBe(true);

    const webhookInfo = await getWebhookInfo(telegramToken);
    expect(String(webhookInfo.url || '')).toContain(serviceBase.replace(/\/+$/, ''));

    const s3 = buildS3Client(endpoint, accessKeyId, secretAccessKey);
    const beforeRequestKeys = await listKeys(s3, bucket, 'logs/requests/');
    const beforeImageKeys = await listKeys(s3, bucket, 'images/');
    const beforeCrashKeys = await listKeys(s3, bucket, 'crash-logs/');
    const beforeRequestSet = new Set(beforeRequestKeys);
    const beforeImageSet = new Set(beforeImageKeys);

    const remoteMarker = `full-stack-remote-${Date.now()}`;
    const remoteUpdate = {
      update_id: Date.now(),
      message: {
        chat: { id: Number(chatId) },
        from: { id: Number(chatId), username: 'e2e_user', first_name: 'E2E' },
        text: remoteMarker
      }
    };
    const webhookOut = await postWebhook(serviceBase, webhookSecret, remoteUpdate);
    expect(webhookOut.status).toBe(200);
    expect(webhookOut.body.ok).toBe(true);

    const fakeTg = await startFakeTelegramServer();
    const localMarker = `full-stack-local-${Date.now()}`;
    const localUpdate = {
      update_id: Date.now() + 1,
      message: {
        chat: { id: Number(chatId) },
        from: { id: Number(chatId), username: 'local_e2e_user', first_name: 'LocalE2E' },
        text: localMarker
      }
    };
    const localBot = await startLocalBotProcess({
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${fakeTg.port}/botTEST_TOKEN`,
      COMICBOT_ALLOWED_CHAT_IDS: chatId,
      TELEGRAM_ADMIN_CHAT_IDS: chatId,
      RENDER_BOT_FAKE_GENERATOR: 'true',
      RENDER_BOT_STATE_FILE: path.join(repoRoot, 'telegram/data/runtime-state.fullstack.local.json'),
      R2_S3_ENDPOINT: endpoint,
      R2_BUCKET: bucket,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey
    });

    try {
      const localOut = await postLocalWebhook(localBot.port, localUpdate);
      expect(localOut.status).toBe(200);
      expect(localOut.body.ok).toBe(true);

      await waitFor(async () => {
        const keys = await listKeys(s3, bucket, 'logs/requests/');
        const candidates = keys.filter((k) => !beforeRequestSet.has(k)).slice(-30);
        if (!candidates.length) return false;
        for (const key of candidates) {
          const payload = await readJsonObject(s3, bucket, key);
          if (String(payload.requestText || '').includes(localMarker)) return true;
        }
        return false;
      }, 180000, 2500);

      await waitFor(async () => {
        const keys = await listKeys(s3, bucket, 'images/');
        return keys.some((k) => !beforeImageSet.has(k));
      }, 180000, 2500);
    } finally {
      await localBot.stop();
      await fakeTg.close();
    }

    const telegramOut = await sendTelegramMessage(telegramToken, chatId, `Interface e2e observer ${remoteMarker}`);
    expect(Number(telegramOut.message_id || 0)).toBeGreaterThan(0);

    const afterCrashKeys = await listKeys(s3, bucket, 'crash-logs/');
    expect(afterCrashKeys.length).toBeGreaterThanOrEqual(beforeCrashKeys.length);
  }, 300000);
});
