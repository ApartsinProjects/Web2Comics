#!/usr/bin/env node
const path = require('path');
const { loadEnvFiles } = require('../src/env');
const { RenderApiClient } = require('./render-api');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const {
  parseArgs,
  readTelegramYaml,
  readCloudflareYaml,
  readAwsYaml,
  resolveLatestDeployId,
  validateProviderEnv
} = require('./lib');

let globalStage = 'init';
let globalOwnerId = '';
let globalServiceId = '';
let globalRenderApiKey = '';

async function setTelegramWebhook(token, secret, publicBaseUrl) {
  const url = `${String(publicBaseUrl || '').replace(/\/+$/, '')}/telegram/webhook/${secret}`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true
    })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(json)}`);
  }
  return url;
}

function pickCloudflareApiToken(cfYaml) {
  const tokens = (cfYaml && cfYaml.api_tokens) || {};
  return firstNonEmpty(
    tokens.deployment_token,
    tokens.additional_token_2,
    tokens.additional_token_1,
    tokens.env_e2e_token,
    tokens.primary_invalid_or_old,
    process.env.CLOUDFLARE_API_TOKEN
  );
}

function resolveR2Config(args, cfYaml, awsYaml) {
  const cfR2 = (cfYaml && cfYaml.r2) || {};
  const s3Clients = (cfR2 && cfR2.s3_clients) || {};
  const key2 = s3Clients.keypair_2 || {};
  const key1 = s3Clients.keypair_1 || {};
  const endpoints = (cfR2 && cfR2.endpoints) || {};
  const accountId = firstNonEmpty(
    args['cloudflare-account-id'],
    process.env.CLOUDFLARE_ACCOUNT_ID,
    cfYaml && cfYaml.account_id
  );
  const bucket = firstNonEmpty(args['r2-bucket'], process.env.R2_BUCKET, cfR2.bucket, 'web2comics-bot-data');
  const endpoint = firstNonEmpty(
    args['r2-endpoint'],
    process.env.R2_S3_ENDPOINT,
    endpoints.global_s3,
    endpoints.regional_s3_eu,
    accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''
  );
  const accessKeyId = firstNonEmpty(
    args['r2-access-key-id'],
    process.env.R2_ACCESS_KEY_ID,
    key2.access_key_id,
    key1.access_key_id,
    awsYaml.aws_access_key_id
  );
  const secretAccessKey = firstNonEmpty(
    args['r2-secret-access-key'],
    process.env.R2_SECRET_ACCESS_KEY,
    key2.secret_access_key,
    key1.secret_access_key,
    awsYaml.aws_secret_access_key
  );
  return {
    endpoint: String(endpoint || '').trim(),
    bucket: String(bucket || '').trim(),
    accessKeyId: String(accessKeyId || '').trim(),
    secretAccessKey: String(secretAccessKey || '').trim()
  };
}

async function cfApi(token, endpoint, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const msg = errors.map((e) => `${e.code}:${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`Cloudflare API ${endpoint} failed: ${msg}`);
  }
  return json.result;
}

async function ensureCloudflareR2Bucket(options = {}) {
  const token = String(options.token || '').trim();
  const accountId = String(options.accountId || '').trim();
  const bucket = String(options.bucket || '').trim();
  if (!token || !accountId || !bucket) return { enabled: false, created: false };

  const listed = await cfApi(token, `/accounts/${accountId}/r2/buckets`, { method: 'GET' });
  const buckets = Array.isArray(listed?.buckets) ? listed.buckets : [];
  const exists = buckets.some((b) => String(b?.name || '') === bucket);
  if (exists) return { enabled: true, created: false };

  await cfApi(token, `/accounts/${accountId}/r2/buckets/${bucket}`, {
    method: 'PUT',
    body: JSON.stringify({ locationHint: 'weur' })
  });
  return { enabled: true, created: true };
}

async function resolveWorkingCloudflareToken(accountId, candidates) {
  const seen = new Set();
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
  for (const token of list) {
    try {
      await cfApi(token, `/accounts/${accountId}/r2/buckets`, { method: 'GET' });
      return token;
    } catch (_) {
      // try next token
    }
  }
  return '';
}

async function verifyR2S3WriteRead(options = {}) {
  const endpoint = String(options.endpoint || '').trim();
  const bucket = String(options.bucket || '').trim();
  const accessKeyId = String(options.accessKeyId || '').trim();
  const secretAccessKey = String(options.secretAccessKey || '').trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return { enabled: false, ok: false };

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });
  const key = `deploy-probe/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = Buffer.from(`probe ${new Date().toISOString()}`, 'utf8');

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'text/plain'
  }));
  const got = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key
  }));
  const txt = await got.Body.transformToString();
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  }));
  return { enabled: true, ok: txt.includes('probe ') };
}

async function getExistingWebhookSecret(token) {
  const apiUrl = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const res = await fetch(apiUrl, { method: 'GET' });
  const json = await res.json();
  if (!res.ok || !json?.ok) return '';
  const url = String(json?.result?.url || '').trim();
  if (!url) return '';
  const parts = url.split('/').filter(Boolean);
  return String(parts[parts.length - 1] || '').trim();
}

async function waitForPostgresConnectionString(render, postgresId, timeoutMs = 240000) {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await render.getPostgresConnectionInfo(postgresId);
      const conn = String(info?.internalConnectionString || '').trim();
      if (conn) return conn;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for Postgres connection string. ${lastError}`);
}

function extractDeployId(deployResponse) {
  return String(
    (deployResponse && deployResponse.id)
      || (deployResponse && deployResponse.deploy && deployResponse.deploy.id)
      || ''
  ).trim();
}

async function resolveDeployId(render, serviceId, deployResponse, triggerStartedAtMs) {
  const direct = extractDeployId(deployResponse);
  if (direct) return direct;

  const rows = await render.listDeploys(serviceId, 10);
  return resolveLatestDeployId(rows, triggerStartedAtMs);
}

async function waitForDeploy(render, serviceId, deployId, timeoutMs = 360000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const deploy = await render.getDeploy(serviceId, deployId);
    const status = String(deploy?.status || '').toLowerCase();
    if (status === 'live') return deploy;
    if (status.includes('fail') || status === 'canceled') return deploy;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for deploy ${deployId}`);
}

async function fetchRecentServiceLogs(render, ownerId, serviceId) {
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
  return rows
    .slice(0, 60)
    .map((row) => String(row?.message || '').trim())
    .filter(Boolean);
}

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

function firstChatId(value, fallback = '') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return String(fallback || '').trim();
  const first = raw.split(',').map((v) => v.trim()).find(Boolean);
  return String(first || fallback || '').trim();
}

function normalizeIdCsv(...values) {
  const uniq = new Set();
  values.forEach((value) => {
    String(value == null ? '' : value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((v) => uniq.add(v));
  });
  return Array.from(uniq).join(',');
}

async function main() {
  globalStage = 'load-env';
  const repoRoot = path.resolve(__dirname, '../..');
  const preArgs = parseArgs(process.argv.slice(2));
  const envOnly = parseBool(preArgs['env-only'] || process.env.BOT_SECRETS_ENV_ONLY);
  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'render/.env')
  ]);

  const args = preArgs;
  const metadataOut = firstNonEmpty(
    args['metadata-out'],
    process.env.RENDER_DEPLOY_METADATA_OUT,
    path.join(repoRoot, 'render/out/deploy-render-metadata.json')
  );
  const tgYaml = envOnly ? {} : readTelegramYaml(repoRoot);
  const cfYaml = envOnly ? {} : readCloudflareYaml(repoRoot);
  const awsYaml = envOnly ? {} : readAwsYaml(repoRoot);
  const testDeployment = parseBool(args['test-deployment'] || process.env.RENDER_TEST_DEPLOYMENT);
  const allowPartialKeys = parseBool(args['allow-partial-keys'] || process.env.RENDER_ALLOW_PARTIAL_KEYS);
  const requireAllKeys = allowPartialKeys
    ? false
    : (parseBool(args['require-all-keys'] || process.env.RENDER_REQUIRE_ALL_KEYS) || true);

  const renderApiKey = firstNonEmpty(args['render-api-key'], process.env.RENDER_API_KEY);
  globalRenderApiKey = renderApiKey;
  const repoUrl = firstNonEmpty(args['repo-url'], process.env.RENDER_REPO_URL, 'https://github.com/ApartsinProjects/Web2Comics');
  const branch = firstNonEmpty(args.branch, process.env.RENDER_REPO_BRANCH, 'main');
  const defaultServiceName = testDeployment ? 'web2comics-telegram-render-bot-test' : 'web2comics-telegram-render-bot';
  const serviceName = firstNonEmpty(args['service-name'], process.env.RENDER_SERVICE_NAME, defaultServiceName);
  const ownerIdArg = firstNonEmpty(args['owner-id'], process.env.RENDER_OWNER_ID);
  const region = firstNonEmpty(args.region, process.env.RENDER_REGION, 'oregon');
  const plan = firstNonEmpty(args.plan, process.env.RENDER_PLAN, 'free');

  const telegramToken = firstNonEmpty(args['telegram-token'], process.env.TELEGRAM_BOT_TOKEN, tgYaml.bot_token);
  const cloudflareAccountId = firstNonEmpty(args['cloudflare-account-id'], process.env.CLOUDFLARE_ACCOUNT_ID, cfYaml.account_id);
  const cloudflareTokenCandidates = [
    args['cloudflare-api-token'],
    pickCloudflareApiToken(cfYaml),
    process.env.CLOUDFLARE_API_TOKEN
  ];
  const cloudflareApiToken = cloudflareAccountId
    ? await resolveWorkingCloudflareToken(cloudflareAccountId, cloudflareTokenCandidates)
    : '';

  const providerEnv = {
    GEMINI_API_KEY: firstNonEmpty(args['gemini-key'], process.env.GEMINI_API_KEY),
    OPENAI_API_KEY: firstNonEmpty(args['openai-key'], process.env.OPENAI_API_KEY),
    OPENROUTER_API_KEY: firstNonEmpty(args['openrouter-key'], process.env.OPENROUTER_API_KEY),
    CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: cloudflareApiToken,
    HUGGINGFACE_INFERENCE_API_TOKEN: firstNonEmpty(args['huggingface-token'], process.env.HUGGINGFACE_INFERENCE_API_TOKEN)
  };
  const resolvedR2 = resolveR2Config(args, cfYaml, awsYaml);
  const r2Env = {
    R2_S3_ENDPOINT: resolvedR2.endpoint,
    R2_BUCKET: resolvedR2.bucket,
    R2_ACCESS_KEY_ID: resolvedR2.accessKeyId,
    R2_SECRET_ACCESS_KEY: resolvedR2.secretAccessKey,
    R2_IMAGE_PREFIX: firstNonEmpty(args['r2-image-prefix'], process.env.R2_IMAGE_PREFIX, 'images'),
    R2_IMAGE_STATUS_KEY: firstNonEmpty(args['r2-image-status-key'], process.env.R2_IMAGE_STATUS_KEY, 'status/image-storage-status.json'),
    R2_CRASH_LOG_PREFIX: firstNonEmpty(args['r2-crash-log-prefix'], process.env.R2_CRASH_LOG_PREFIX, 'crash-logs'),
    R2_CRASH_LOG_STATUS_KEY: firstNonEmpty(args['r2-crash-log-status-key'], process.env.R2_CRASH_LOG_STATUS_KEY, 'crash-logs/status.json'),
    R2_REQUEST_LOG_PREFIX: firstNonEmpty(args['r2-request-log-prefix'], process.env.R2_REQUEST_LOG_PREFIX, 'logs/requests'),
    R2_REQUEST_LOG_STATUS_KEY: firstNonEmpty(args['r2-request-log-status-key'], process.env.R2_REQUEST_LOG_STATUS_KEY, 'logs/requests/status.json'),
    R2_CRASH_LOG_RETENTION_DAYS: firstNonEmpty(args['r2-crash-retention-days'], process.env.R2_CRASH_LOG_RETENTION_DAYS, '5'),
    R2_REQUEST_LOG_RETENTION_DAYS: firstNonEmpty(args['r2-request-retention-days'], process.env.R2_REQUEST_LOG_RETENTION_DAYS, '5')
  };
  const r2BudgetEnv = {
    RENDER_BOT_IMAGE_CAPACITY_BYTES: firstNonEmpty(args['r2-image-capacity-bytes'], process.env.RENDER_BOT_IMAGE_CAPACITY_BYTES, String(4 * 1024 * 1024 * 1024)),
    RENDER_BOT_IMAGE_CLEANUP_THRESHOLD_RATIO: firstNonEmpty(args['r2-image-threshold-ratio'], process.env.RENDER_BOT_IMAGE_CLEANUP_THRESHOLD_RATIO, '0.5'),
    R2_CRASH_LOG_CAPACITY_BYTES: firstNonEmpty(args['r2-crash-capacity-bytes'], process.env.R2_CRASH_LOG_CAPACITY_BYTES, String(512 * 1024 * 1024)),
    R2_CRASH_LOG_CLEANUP_THRESHOLD_RATIO: firstNonEmpty(args['r2-crash-threshold-ratio'], process.env.R2_CRASH_LOG_CLEANUP_THRESHOLD_RATIO, '0.8'),
    R2_REQUEST_LOG_CAPACITY_BYTES: firstNonEmpty(args['r2-request-capacity-bytes'], process.env.R2_REQUEST_LOG_CAPACITY_BYTES, String(512 * 1024 * 1024)),
    R2_REQUEST_LOG_CLEANUP_THRESHOLD_RATIO: firstNonEmpty(args['r2-request-threshold-ratio'], process.env.R2_REQUEST_LOG_CLEANUP_THRESHOLD_RATIO, '0.8')
  };

  const notifyChatId = firstChatId(
    firstNonEmpty(args['notify-chat-id'], process.env.TELEGRAM_NOTIFY_CHAT_ID, tgYaml.allowed_chat_ids),
    '1796415913'
  );
  const telegramTestChatId = firstChatId(
    firstNonEmpty(args['telegram-test-chat-id'], process.env.TELEGRAM_TEST_CHAT_ID, tgYaml.allowed_chat_ids),
    notifyChatId
  );
  const allowedChatIds = normalizeIdCsv(
    firstNonEmpty(args['allowed-chat-ids'], process.env.COMICBOT_ALLOWED_CHAT_IDS, tgYaml.allowed_chat_ids),
    notifyChatId
  );
  const adminChatIds = normalizeIdCsv(
    firstNonEmpty(args['admin-chat-ids'], process.env.TELEGRAM_ADMIN_CHAT_IDS, '1796415913'),
    notifyChatId
  );
  let databaseUrl = firstNonEmpty(
    args['database-url'],
    args['pg-url'],
    process.env.RENDER_BOT_PG_URL,
    process.env.DATABASE_URL
  );
  const pgTable = firstNonEmpty(args['pg-table'], process.env.RENDER_BOT_PG_TABLE, 'render_bot_state');
  const pgStateKey = firstNonEmpty(args['pg-state-key'], process.env.RENDER_BOT_PG_STATE_KEY, 'runtime_config');
  const postgresIdArg = firstNonEmpty(args['postgres-id'], process.env.RENDER_POSTGRES_ID);
  const defaultPostgresName = `${serviceName}-db`;
  const postgresName = firstNonEmpty(args['postgres-name'], process.env.RENDER_POSTGRES_NAME, defaultPostgresName);
  const postgresPlan = firstNonEmpty(args['postgres-plan'], process.env.RENDER_POSTGRES_PLAN, 'free');
  const postgresVersion = firstNonEmpty(args['postgres-version'], process.env.RENDER_POSTGRES_VERSION, '16');
  const postgresRegion = firstNonEmpty(args['postgres-region'], process.env.RENDER_POSTGRES_REGION, region);

  globalStage = 'validate-input';
  if (!renderApiKey) {
    throw new Error('Missing Render API key. Set RENDER_API_KEY or pass --render-api-key');
  }
  if (!telegramToken) {
    throw new Error('Missing Telegram bot token. Provide TELEGRAM_BOT_TOKEN (GitHub Secret) or --telegram-token');
  }
  const existingWebhookSecret = await getExistingWebhookSecret(telegramToken);
  const webhookSecret = firstNonEmpty(
    args['webhook-secret'],
    process.env.TELEGRAM_WEBHOOK_SECRET,
    existingWebhookSecret,
    'web2comics-render-webhook-secret-v1'
  );
  const keyCheck = validateProviderEnv(providerEnv, requireAllKeys);
  if (!keyCheck.ok) {
    if (requireAllKeys) {
      throw new Error(`Missing provider keys for strict deployment: ${keyCheck.missing.join(', ')}. Set all provider secrets or use --allow-partial-keys.`);
    }
    throw new Error('Missing provider keys. At least one provider key is required (e.g. GEMINI_API_KEY).');
  }
  const providerKeyStatus = Object.entries(providerEnv)
    .map(([k, v]) => `${k}:${String(v || '').trim() ? 'set' : 'missing'}`)
    .join(', ');
  console.log(`[deploy] provider key status -> ${providerKeyStatus}`);

  const render = new RenderApiClient(renderApiKey);

  globalStage = 'provision-r2';
  if (providerEnv.CLOUDFLARE_API_TOKEN && providerEnv.CLOUDFLARE_ACCOUNT_ID && r2Env.R2_BUCKET) {
    const r2Out = await ensureCloudflareR2Bucket({
      token: providerEnv.CLOUDFLARE_API_TOKEN,
      accountId: providerEnv.CLOUDFLARE_ACCOUNT_ID,
      bucket: r2Env.R2_BUCKET
    });
    if (r2Out.created) console.log(`[deploy] created cloudflare R2 bucket: ${r2Env.R2_BUCKET}`);
    else console.log(`[deploy] cloudflare R2 bucket exists: ${r2Env.R2_BUCKET}`);
  } else {
    console.log('[deploy] cloudflare account token/id not provided; skipping bucket provisioning');
  }

  if (r2Env.R2_S3_ENDPOINT && r2Env.R2_BUCKET && r2Env.R2_ACCESS_KEY_ID && r2Env.R2_SECRET_ACCESS_KEY) {
    await verifyR2S3WriteRead({
      endpoint: r2Env.R2_S3_ENDPOINT,
      bucket: r2Env.R2_BUCKET,
      accessKeyId: r2Env.R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY
    });
    console.log('[deploy] R2 S3 probe ok');
  } else {
    console.log('[deploy] R2 S3 credentials incomplete; image/crash logs will use file fallback');
  }

  globalStage = 'resolve-owner';
  let ownerId = ownerIdArg;
  if (!ownerId) {
    const owners = await render.listOwners();
    if (!owners.length) throw new Error('No Render owners/workspaces found for this API key.');
    ownerId = String((owners[0].owner && owners[0].owner.id) || owners[0].id || '');
    if (!ownerId) throw new Error('Unable to resolve ownerId from Render API.');
  }

  globalOwnerId = ownerId;

  globalStage = 'provision-postgres';
  let postgresId = postgresIdArg;
  if (!databaseUrl) {
    if (!postgresId) {
      const existingPg = await render.listPostgresByName(postgresName, ownerId);
      const pgRecord = existingPg.find((row) => String(row?.postgres?.name || row?.name || '') === postgresName);
      if (pgRecord) {
        postgresId = String((pgRecord.postgres && pgRecord.postgres.id) || pgRecord.id || '');
        console.log(`[deploy] postgres exists: ${postgresName}`);
      } else {
        try {
          const createPgPayload = {
            name: postgresName,
            ownerId,
            plan: postgresPlan,
            version: postgresVersion,
            region: postgresRegion
          };
          const createdPg = await render.createPostgres(createPgPayload);
          postgresId = String((createdPg.postgres && createdPg.postgres.id) || createdPg.id || '');
          console.log(`[deploy] created postgres: ${postgresName}`);
        } catch (error) {
          const msg = String(error?.message || error);
          const freeTierLimit = msg.toLowerCase().includes('more than one active free tier database');
          if (!freeTierLimit) throw error;
          const existingAny = await render.listPostgresByName('', ownerId);
          const fallback = (Array.isArray(existingAny) ? existingAny : [])[0];
          const fallbackId = String((fallback?.postgres && fallback.postgres.id) || fallback?.id || '').trim();
          const fallbackName = String((fallback?.postgres && fallback.postgres.name) || fallback?.name || '').trim();
          if (!fallbackId) throw error;
          postgresId = fallbackId;
          console.log(`[deploy] free postgres limit hit; reusing existing postgres: ${fallbackName || fallbackId}`);
        }
      }
    }

    if (!postgresId) {
      throw new Error('Unable to resolve Postgres ID. Pass --postgres-id or --database-url.');
    }
    databaseUrl = await waitForPostgresConnectionString(render, postgresId);
    console.log('[deploy] postgres connection resolved');
  } else {
    console.log('[deploy] using provided postgres url');
  }

  globalStage = 'provision-service';
  const existing = await render.listServicesByName(serviceName, ownerId);
  let serviceRecord = existing.find((row) => String(row?.service?.name || '') === serviceName);

  if (!serviceRecord) {
    const createPayload = {
      type: 'web_service',
      name: serviceName,
      ownerId,
      repo: repoUrl,
      branch,
      autoDeploy: 'yes',
      serviceDetails: {
        runtime: 'node',
        plan,
        region,
        envSpecificDetails: {
          buildCommand: 'npm install && npx playwright install chromium',
          startCommand: 'node render/src/webhook-bot.js'
        },
        healthCheckPath: '/healthz',
        numInstances: 1
      }
    };
    serviceRecord = await render.createWebService(createPayload);
    console.log(`[deploy] created service: ${serviceName}`);
  } else {
    console.log(`[deploy] service exists: ${serviceName}`);
  }

  const serviceId = String((serviceRecord.service && serviceRecord.service.id) || serviceRecord.id || '');
  if (!serviceId) throw new Error('Could not determine service ID.');
  globalServiceId = serviceId;

  globalStage = 'update-service-config';
  try {
    await render.updateService(serviceId, {
      serviceDetails: {
        runtime: 'node',
        envSpecificDetails: {
          buildCommand: 'npm install && npx playwright install chromium',
          startCommand: 'node render/src/webhook-bot.js'
        }
      }
    });
    console.log('[deploy] service build/start commands updated');
  } catch (error) {
    console.log(`[deploy] warning: failed to update service commands: ${String(error?.message || error)}`);
  }

  globalStage = 'sync-env-vars';
  const envVars = {
    TELEGRAM_BOT_TOKEN: telegramToken,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    RENDER_BOT_BASE_CONFIG: 'render/config/default.render.yml',
    RENDER_BOT_STATE_FILE: 'render/data/runtime-state.json',
    DATABASE_URL: databaseUrl,
    RENDER_BOT_PG_URL: databaseUrl,
    RENDER_BOT_PG_TABLE: pgTable,
    RENDER_BOT_PG_STATE_KEY: pgStateKey,
    RENDER_BOT_OUT_DIR: 'render/out',
    RENDER_BOT_FETCH_TIMEOUT_MS: '45000',
    RENDER_BOT_DEBUG_ARTIFACTS: 'false',
    TELEGRAM_NOTIFY_ON_START: 'true',
    TELEGRAM_NOTIFY_CHAT_ID: notifyChatId,
    TELEGRAM_TEST_CHAT_ID: telegramTestChatId,
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    COMICBOT_ALLOWED_CHAT_IDS: allowedChatIds,
    ...providerEnv,
    ...r2Env,
    ...r2BudgetEnv
  };

  await render.setServiceEnvVars(serviceId, envVars);
  console.log('[deploy] env vars synced');

  globalStage = 'trigger-deploy';
  const triggerStartedAtMs = Date.now();
  const deployStart = await render.triggerDeploy(serviceId);
  console.log('[deploy] deploy triggered');
  const deployId = await resolveDeployId(render, serviceId, deployStart, triggerStartedAtMs);
  if (!deployId) throw new Error('Could not resolve deploy ID after trigger.');
  globalStage = 'wait-deploy';
  const finalDeploy = await waitForDeploy(render, serviceId, deployId);
  const deployStatus = String(finalDeploy?.status || '').toLowerCase();
  if (deployStatus !== 'live') {
    console.log(`[deploy] deploy ended with status: ${deployStatus || 'unknown'}`);
    try {
      const tail = await fetchRecentServiceLogs(render, ownerId, serviceId);
      if (tail.length) {
        console.log('[deploy] recent logs:');
        tail.forEach((line) => console.log(line));
      } else {
        console.log('[deploy] no recent logs found via API.');
      }
    } catch (error) {
      console.log(`[deploy] failed to fetch logs: ${String(error?.message || error)}`);
    }
    throw new Error(`Render deploy failed with status: ${deployStatus || 'unknown'}`);
  }
  console.log('[deploy] deploy is live');

  globalStage = 'resolve-public-url';
  let service = await render.getService(serviceId);
  const start = Date.now();
  while (!(service?.serviceDetails?.url) && (Date.now() - start < 180000)) {
    await new Promise((r) => setTimeout(r, 5000));
    service = await render.getService(serviceId);
  }

  const publicUrl = String(service?.serviceDetails?.url || '').trim();
  if (!publicUrl) {
    console.log('[deploy] Service URL not ready yet. Wait for deploy completion in Render dashboard, then run webhook setup manually.');
    console.log('npm run render:set-webhook -- --url <your-service-url>');
    console.log(`Use TELEGRAM_WEBHOOK_SECRET=${webhookSecret}`);
    return;
  }

  globalStage = 'set-telegram-webhook';
  const webhookUrl = await setTelegramWebhook(telegramToken, webhookSecret, publicUrl);

  globalStage = 'write-deploy-metadata';
  try {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(metadataOut), { recursive: true });
    fs.writeFileSync(metadataOut, JSON.stringify({
      timestamp: new Date().toISOString(),
      ownerId,
      serviceId,
      serviceName,
      branch,
      publicUrl,
      webhookUrl,
      webhookSecret,
      telegramTestChatId,
      notifyChatId
    }, null, 2), 'utf8');
    console.log(`[deploy] metadata written: ${metadataOut}`);
  } catch (error) {
    console.log(`[deploy] warning: failed to write metadata: ${String(error?.message || error)}`);
  }

  console.log('');
  console.log('Deployment complete');
  console.log(`- Service ID: ${serviceId}`);
  console.log(`- Public URL: ${publicUrl}`);
  console.log(`- Health: ${publicUrl.replace(/\/+$/, '')}/healthz`);
  console.log(`- Webhook: ${webhookUrl}`);
  console.log('Try in Telegram: /start');
}

main().catch(async (error) => {
  console.error(`[deploy] failed at stage '${globalStage}':`, error && error.message ? error.message : String(error));
  if (globalRenderApiKey && globalOwnerId && globalServiceId) {
    try {
      const render = new RenderApiClient(globalRenderApiKey);
      const tail = await fetchRecentServiceLogs(render, globalOwnerId, globalServiceId);
      if (tail.length) {
        console.error('[deploy] diagnostic logs tail:');
        tail.forEach((line) => console.error(line));
      } else {
        console.error('[deploy] diagnostic logs tail: none');
      }
    } catch (logError) {
      console.error('[deploy] failed to fetch diagnostic logs:', String(logError?.message || logError));
    }
  }
  process.exit(1);
});
