#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { loadEnvFiles } = require('../src/env');
const { parseArgs, readTelegramYaml, readCloudflareYaml, readAwsYaml } = require('./lib');
const { RenderApiClient } = require('./render-api');

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function parseBool(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function waitFor(fn, timeoutMs = 180000, stepMs = 2500, label = 'condition') {
  const start = Date.now();
  let lastError = '';
  while ((Date.now() - start) < timeoutMs) {
    try {
      const out = await fn();
      if (out) return out;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`Timeout waiting for ${label}${lastError ? ` (last: ${lastError})` : ''}`);
}

function createS3(endpoint, accessKeyId, secretAccessKey) {
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });
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
    const rows = Array.isArray(res?.Contents) ? res.Contents : [];
    rows.forEach((r) => {
      const key = String(r?.Key || '').trim();
      if (key) out.push(key);
    });
    token = res?.IsTruncated ? res?.NextContinuationToken : undefined;
  } while (token);
  return out.sort();
}

async function readJson(s3, bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await res.Body.transformToString();
  return JSON.parse(text || '{}');
}

async function healthStatus(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`);
  const body = await res.json().catch(() => ({}));
  return { ok: Boolean(res.ok && body && body.ok), code: res.status, body };
}

async function assertHealth(baseUrl, stage = 'health') {
  const st = await healthStatus(baseUrl);
  if (!st.ok) {
    throw new Error(`Service unhealthy during ${stage} (${st.code}): ${JSON.stringify(st.body || {})}`);
  }
  return st;
}

async function findMarkerRequestEntry(s3, bucket, beforeSet, marker) {
  const keys = await listKeys(s3, bucket, 'logs/requests/');
  const candidates = keys.filter((k) => !beforeSet.has(k)).slice(-120);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const key = candidates[i];
    const obj = await readJson(s3, bucket, key);
    if (String(obj.requestText || '').includes(marker)) {
      return { key, obj };
    }
  }
  return null;
}

async function loadR2Diagnostics(s3, bucket) {
  const out = { latestCrash: null, latestRequests: [] };
  try {
    const crashStatus = await readJson(s3, bucket, 'crash-logs/status.json');
    const crashRows = Array.isArray(crashStatus?.logs) ? crashStatus.logs : [];
    const lastCrash = crashRows.slice().sort((a, b) => Date.parse(String(b?.createdAt || '')) - Date.parse(String(a?.createdAt || '')))[0];
    if (lastCrash && lastCrash.key) {
      out.latestCrash = await readJson(s3, bucket, String(lastCrash.key));
    }
  } catch (_) {}
  try {
    const reqStatus = await readJson(s3, bucket, 'logs/requests/status.json');
    const reqRows = Array.isArray(reqStatus?.logs) ? reqStatus.logs : [];
    const latest = reqRows
      .slice()
      .sort((a, b) => Date.parse(String(b?.createdAt || '')) - Date.parse(String(a?.createdAt || '')))
      .slice(0, 5);
    for (const row of latest) {
      if (!row?.key) continue;
      try {
        const payload = await readJson(s3, bucket, String(row.key));
        out.latestRequests.push({
          key: row.key,
          createdAt: row.createdAt,
          requestText: payload.requestText,
          result: payload.result
        });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

async function postWebhook(baseUrl, secret, text, chatId) {
  const update = {
    update_id: Date.now(),
    source: 'test',
    message: {
      chat: { id: Number(chatId) },
      from: { id: Number(chatId), username: 'sanity_user', first_name: 'Sanity' },
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
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`webhook sanity failed (${res.status}): ${JSON.stringify(body)}`);
  }
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
  if (!res.ok || !body.ok) {
    throw new Error(`telegram sendMessage failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.result || {};
}

async function fetchRenderLogs(renderApiKey, ownerId, serviceId) {
  if (!renderApiKey || !ownerId || !serviceId) return [];
  const render = new RenderApiClient(renderApiKey);
  const end = Date.now();
  const start = end - (15 * 60 * 1000);
  const logs = await render.listLogs({
    ownerId,
    resourceId: serviceId,
    direction: 'backward',
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString()
  });
  const rows = Array.isArray(logs?.logs) ? logs.logs : [];
  return rows.slice(0, 60).map((r) => String(r?.message || '').trim()).filter(Boolean);
}

function loadMetadata(metadataPath) {
  const p = path.resolve(metadataPath);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return {};
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const args = parseArgs(process.argv.slice(2));
  const envOnly = parseBool(args['env-only'] || process.env.BOT_SECRETS_ENV_ONLY);
  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'telegram/.env')
  ]);

  const metadata = loadMetadata(firstNonEmpty(
    args['metadata-in'],
    process.env.RENDER_DEPLOY_METADATA_OUT,
    path.join(repoRoot, 'telegram/out/deploy-render-metadata.json')
  ));
  const tgYaml = envOnly ? {} : readTelegramYaml(repoRoot);
  const cfYaml = envOnly ? {} : readCloudflareYaml(repoRoot);
  const awsYaml = envOnly ? {} : readAwsYaml(repoRoot);
  const cfR2 = (cfYaml && cfYaml.r2) || {};
  const s3Clients = (cfR2 && cfR2.s3_clients) || {};
  const key2 = s3Clients.keypair_2 || {};
  const key1 = s3Clients.keypair_1 || {};

  const baseUrl = firstNonEmpty(args['service-url'], process.env.RENDER_PUBLIC_BASE_URL, metadata.publicUrl);
  const webhookSecret = firstNonEmpty(args['webhook-secret'], process.env.TELEGRAM_WEBHOOK_SECRET, metadata.webhookSecret);
  const telegramToken = firstNonEmpty(args['telegram-token'], process.env.TELEGRAM_BOT_TOKEN, tgYaml.bot_token);
  const chatId = firstNonEmpty(
    args['telegram-test-chat-id'],
    process.env.TELEGRAM_TEST_CHAT_ID,
    process.env.TELEGRAM_NOTIFY_CHAT_ID,
    metadata.telegramTestChatId,
    tgYaml.allowed_chat_ids
  ).split(',').map((v) => v.trim()).find(Boolean);
  const endpoint = firstNonEmpty(
    args['r2-endpoint'],
    process.env.R2_S3_ENDPOINT,
    (cfR2.endpoints && cfR2.endpoints.global_s3) || '',
    process.env.CLOUDFLARE_ACCOUNT_ID ? `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''
  );
  const bucket = firstNonEmpty(args['r2-bucket'], process.env.R2_BUCKET, cfR2.bucket);
  const accessKeyId = firstNonEmpty(args['r2-access-key-id'], process.env.R2_ACCESS_KEY_ID, key2.access_key_id, key1.access_key_id, awsYaml.aws_access_key_id);
  const secretAccessKey = firstNonEmpty(args['r2-secret-access-key'], process.env.R2_SECRET_ACCESS_KEY, key2.secret_access_key, key1.secret_access_key, awsYaml.aws_secret_access_key);

  const missing = [];
  if (!baseUrl) missing.push('RENDER_PUBLIC_BASE_URL/service-url');
  if (!webhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET');
  if (!telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!chatId) missing.push('TELEGRAM_TEST_CHAT_ID/TELEGRAM_NOTIFY_CHAT_ID');
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) missing.push('R2_* credentials');
  if (missing.length) throw new Error(`Missing inputs: ${missing.join(', ')}`);

  console.log('[sanity] health check');
  await assertHealth(baseUrl, 'startup');

  console.log('[sanity] capture R2 baseline');
  const s3 = createS3(endpoint, accessKeyId, secretAccessKey);
  const beforeReq = new Set(await listKeys(s3, bucket, 'logs/requests/'));
  const beforeImg = new Set(await listKeys(s3, bucket, 'images/'));

  const marker = `sanity-${Date.now()}`;
  console.log(`[sanity] webhook generation trigger -> ${marker}`);
  await postWebhook(baseUrl, webhookSecret, marker, chatId);
  await assertHealth(baseUrl, 'post-webhook');

  console.log('[sanity] wait for request log marker');
  const requestEntry = await waitFor(async () => {
    await assertHealth(baseUrl, 'request-log-wait');
    const found = await findMarkerRequestEntry(s3, bucket, beforeReq, marker);
    if (!found) return false;
    if (found.obj && found.obj.result && found.obj.result.ok === false) {
      throw new Error(`Remote generation failed early: ${String(found.obj.result.error || 'unknown error')}`);
    }
    return found;
  }, 180000, 2500, 'request log marker');
  console.log(`[sanity] marker request found: ${requestEntry.key}`);

  console.log('[sanity] wait for image artifact growth (live provider path)');
  await waitFor(async () => {
    await assertHealth(baseUrl, 'image-growth-wait');
    const found = await findMarkerRequestEntry(s3, bucket, beforeReq, marker);
    if (found && found.obj && found.obj.result && found.obj.result.ok === false) {
      throw new Error(`Remote generation failed: ${String(found.obj.result.error || 'unknown error')}`);
    }
    const keys = await listKeys(s3, bucket, 'images/');
    return keys.some((k) => !beforeImg.has(k));
  }, 240000, 3000, 'generated images');

  console.log('[sanity] telegram API check');
  const msg = await sendTelegramMessage(telegramToken, chatId, `Web2Comic sanity passed for marker ${marker}`);
  if (!Number(msg?.message_id || 0)) throw new Error('telegram message_id missing');

  console.log('[sanity] PASS');
}

main().catch(async (error) => {
  console.error('[sanity] FAIL:', error && error.message ? error.message : String(error));
  try {
    const repoRoot = path.resolve(__dirname, '../..');
    const args = parseArgs(process.argv.slice(2));
    const envOnly = parseBool(args['env-only'] || process.env.BOT_SECRETS_ENV_ONLY);
    const metadata = loadMetadata(firstNonEmpty(
      args['metadata-in'],
      process.env.RENDER_DEPLOY_METADATA_OUT,
      path.join(repoRoot, 'telegram/out/deploy-render-metadata.json')
    ));
    const cfYaml = envOnly ? {} : readCloudflareYaml(repoRoot);
    const awsYaml = envOnly ? {} : readAwsYaml(repoRoot);
    const cfR2 = (cfYaml && cfYaml.r2) || {};
    const s3Clients = (cfR2 && cfR2.s3_clients) || {};
    const key2 = s3Clients.keypair_2 || {};
    const key1 = s3Clients.keypair_1 || {};
    const endpoint = firstNonEmpty(
      args['r2-endpoint'],
      process.env.R2_S3_ENDPOINT,
      (cfR2.endpoints && cfR2.endpoints.global_s3) || '',
      process.env.CLOUDFLARE_ACCOUNT_ID ? `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''
    );
    const bucket = firstNonEmpty(args['r2-bucket'], process.env.R2_BUCKET, cfR2.bucket);
    const accessKeyId = firstNonEmpty(args['r2-access-key-id'], process.env.R2_ACCESS_KEY_ID, key2.access_key_id, key1.access_key_id, awsYaml.aws_access_key_id);
    const secretAccessKey = firstNonEmpty(args['r2-secret-access-key'], process.env.R2_SECRET_ACCESS_KEY, key2.secret_access_key, key1.secret_access_key, awsYaml.aws_secret_access_key);
    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      const s3 = createS3(endpoint, accessKeyId, secretAccessKey);
      const diag = await loadR2Diagnostics(s3, bucket);
      if (diag.latestCrash) {
        console.error('[sanity] Latest R2 crash log:');
        console.error(JSON.stringify(diag.latestCrash, null, 2));
      }
      if (diag.latestRequests.length) {
        console.error('[sanity] Latest R2 request logs:');
        console.error(JSON.stringify(diag.latestRequests, null, 2));
      }
    }
    const baseUrl = firstNonEmpty(args['service-url'], process.env.RENDER_PUBLIC_BASE_URL, metadata.publicUrl);
    if (baseUrl) {
      const st = await healthStatus(baseUrl);
      console.error('[sanity] service status snapshot:', JSON.stringify(st));
    }
  } catch (diagError) {
    console.error('[sanity] failed to collect R2/service diagnostics:', String(diagError?.message || diagError));
  }
  try {
    const args = parseArgs(process.argv.slice(2));
    const metadata = loadMetadata(firstNonEmpty(
      args['metadata-in'],
      process.env.RENDER_DEPLOY_METADATA_OUT,
      path.join(path.resolve(__dirname, '../..'), 'telegram/out/deploy-render-metadata.json')
    ));
    const renderApiKey = firstNonEmpty(args['render-api-key'], process.env.RENDER_API_KEY);
    const ownerId = firstNonEmpty(args['owner-id'], process.env.RENDER_OWNER_ID, metadata.ownerId);
    const serviceId = firstNonEmpty(args['service-id'], process.env.RENDER_SERVICE_ID, metadata.serviceId);
    const lines = await fetchRenderLogs(renderApiKey, ownerId, serviceId);
    if (lines.length) {
      console.error('[sanity] Render logs tail:');
      lines.forEach((line) => console.error(line));
    }
  } catch (logError) {
    console.error('[sanity] failed to fetch Render logs:', String(logError?.message || logError));
  }
  process.exit(1);
});
