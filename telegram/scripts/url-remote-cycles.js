#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { loadEnvFiles } = require('../src/env');
const { parseArgs, readCloudflareYaml, readAwsYaml } = require('./lib');

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listKeys(s3, bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token
    }));
    const rows = Array.isArray(res && res.Contents) ? res.Contents : [];
    rows.forEach((r) => {
      const key = String((r && r.Key) || '').trim();
      if (key) out.push(key);
    });
    token = res && res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out.sort();
}

async function readJson(s3, bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await out.Body.transformToString();
  return JSON.parse(text || '{}');
}

async function postWebhook(baseUrl, secret, chatId, text) {
  const update = {
    update_id: Date.now(),
    source: 'test',
    message: {
      chat: { id: Number(chatId) },
      from: { id: Number(chatId), username: 'url_cycle_user', first_name: 'UrlCycle' },
      source: 'test',
      text
    }
  };
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/telegram/webhook/${secret}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': secret
    },
    body: JSON.stringify(update)
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function health(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`);
  const body = await res.text();
  return { status: res.status, body };
}

async function waitForHealthy(baseUrl, timeoutMs, pollMs) {
  const startedAt = Date.now();
  let last = { status: 0, body: '' };
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      last = await health(baseUrl);
      if (last.status === 200) {
        return { ok: true, elapsedMs: Date.now() - startedAt, last };
      }
    } catch (error) {
      last = { status: 0, body: String(error && error.message ? error.message : error) };
    }
    await sleep(pollMs);
  }
  return { ok: false, elapsedMs: Date.now() - startedAt, last };
}

async function findRequestByMarker(s3, bucket, marker) {
  const status = await readJson(s3, bucket, process.env.R2_REQUEST_LOG_STATUS_KEY || 'logs/requests/status.json');
  const logs = Array.isArray(status && status.logs) ? status.logs : [];
  const latest = logs.slice(-150).reverse();
  for (const row of latest) {
    const key = String((row && row.key) || '').trim();
    if (!key) continue;
    const item = await readJson(s3, bucket, key);
    if (String(item && item.requestText || '').includes(marker)) {
      return { key, item };
    }
  }
  return null;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const args = parseArgs(process.argv.slice(2));
  const metadataPath = path.resolve(args['metadata-in'] || path.join(repoRoot, 'telegram/out/deploy-render-metadata.json'));
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};

  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'telegram/.env')
  ]);

  const cfYaml = readCloudflareYaml(repoRoot);
  const awsYaml = readAwsYaml(repoRoot);
  const cfR2 = (cfYaml && cfYaml.r2) || {};
  const s3Clients = (cfR2 && cfR2.s3_clients) || {};
  const key2 = s3Clients.keypair_2 || {};
  const key1 = s3Clients.keypair_1 || {};

  const baseUrl = firstNonEmpty(args['service-url'], process.env.RENDER_PUBLIC_BASE_URL, metadata.publicUrl);
  const webhookSecret = firstNonEmpty(args['webhook-secret'], process.env.TELEGRAM_WEBHOOK_SECRET, metadata.webhookSecret);
  const chatId = Number(firstNonEmpty(args['chat-id'], process.env.TELEGRAM_TEST_CHAT_ID, metadata.telegramTestChatId, '1796415913'));
  const endpoint = firstNonEmpty(
    args['r2-endpoint'],
    process.env.R2_S3_ENDPOINT,
    cfR2.endpoints && cfR2.endpoints.global_s3,
    process.env.CLOUDFLARE_ACCOUNT_ID ? `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''
  );
  const bucket = firstNonEmpty(args['r2-bucket'], process.env.R2_BUCKET, cfR2.bucket);
  const accessKeyId = firstNonEmpty(args['r2-access-key-id'], process.env.R2_ACCESS_KEY_ID, key2.access_key_id, key1.access_key_id, awsYaml.aws_access_key_id);
  const secretAccessKey = firstNonEmpty(args['r2-secret-access-key'], process.env.R2_SECRET_ACCESS_KEY, key2.secret_access_key, key1.secret_access_key, awsYaml.aws_secret_access_key);
  const timeoutMs = Math.max(30000, Number(args['timeout-ms'] || 180000));
  const pollMs = Math.max(1000, Number(args['poll-ms'] || 5000));
  const warmupTimeoutMs = Math.max(10000, Number(args['warmup-timeout-ms'] || 90000));

  if (!baseUrl || !webhookSecret || !chatId || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing required inputs for URL cycle test (service/webhook/chat/r2 credentials).');
  }

  process.env.R2_REQUEST_LOG_STATUS_KEY = String(process.env.R2_REQUEST_LOG_STATUS_KEY || 'logs/requests/status.json').trim();

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });

  const defaultSites = [
    'https://www.google.com',
    'https://www.youtube.com',
    'https://www.facebook.com',
    'https://www.wikipedia.org',
    'https://www.reddit.com'
  ];
  const sites = String(args.sites || '')
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const effectiveSites = sites.length ? sites : defaultSites;

  const summary = [];
  for (const site of effectiveSites) {
    const marker = `urlcycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const testUrl = `${site}${site.includes('?') ? '&' : '?'}src=${marker}`;
    const beforeImages = await listKeys(s3, bucket, 'images/');
    const warm = await waitForHealthy(baseUrl, warmupTimeoutMs, pollMs);
    let h = warm.last;
    let posted = { status: 0, body: '' };
    if (warm.ok) {
      posted = await postWebhook(baseUrl, webhookSecret, chatId, testUrl);
      if (posted.status >= 500) {
        const warmRetry = await waitForHealthy(baseUrl, warmupTimeoutMs, pollMs);
        h = warmRetry.last;
        if (warmRetry.ok) {
          posted = await postWebhook(baseUrl, webhookSecret, chatId, testUrl);
        }
      }
    }

    let requestEntry = null;
    let newImageCount = 0;
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      try {
        requestEntry = await findRequestByMarker(s3, bucket, marker);
      } catch (_) {}
      try {
        const afterImages = await listKeys(s3, bucket, 'images/');
        newImageCount = afterImages.filter((k) => !beforeImages.includes(k)).length;
      } catch (_) {}
      if (requestEntry || newImageCount > 0) break;
      await sleep(pollMs);
    }

    summary.push({
      site,
      marker,
      healthStatus: h.status,
      warmupOk: warm.ok,
      warmupMs: warm.elapsedMs,
      webhookStatus: posted.status,
      webhookBody: posted.body.slice(0, 120),
      requestLogFound: Boolean(requestEntry),
      requestResultOk: Boolean(requestEntry && requestEntry.item && requestEntry.item.result && requestEntry.item.result.ok),
      requestError: requestEntry && requestEntry.item && requestEntry.item.result ? String(requestEntry.item.result.error || '') : '',
      newImageCount
    });
  }

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    service: baseUrl,
    bucket,
    statusKey: process.env.R2_REQUEST_LOG_STATUS_KEY,
    summary
  }, null, 2));
}

main().catch((error) => {
  console.error('[url-remote-cycles] failed:', error && error.message ? error.message : String(error));
  process.exit(1);
});
