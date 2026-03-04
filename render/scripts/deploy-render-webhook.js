#!/usr/bin/env node
const path = require('path');
const { loadEnvFiles } = require('../src/env');
const { RenderApiClient } = require('./render-api');
const { parseArgs, readTelegramYaml, randomSecret, resolveLatestDeployId, validateProviderEnv } = require('./lib');

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
      drop_pending_updates: false
    })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(json)}`);
  }
  return url;
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
  const repoRoot = path.resolve(__dirname, '../..');
  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'render/.env')
  ]);

  const args = parseArgs(process.argv.slice(2));
  const tgYaml = readTelegramYaml(repoRoot);
  const testDeployment = parseBool(args['test-deployment'] || process.env.RENDER_TEST_DEPLOYMENT);
  const requireAllKeys = parseBool(args['require-all-keys'] || process.env.RENDER_REQUIRE_ALL_KEYS) || testDeployment;

  const renderApiKey = firstNonEmpty(args['render-api-key'], process.env.RENDER_API_KEY);
  const repoUrl = firstNonEmpty(args['repo-url'], process.env.RENDER_REPO_URL, 'https://github.com/ApartsinProjects/Web2Comics');
  const branch = firstNonEmpty(args.branch, process.env.RENDER_REPO_BRANCH, 'main');
  const defaultServiceName = testDeployment ? 'web2comics-telegram-render-bot-test' : 'web2comics-telegram-render-bot';
  const serviceName = firstNonEmpty(args['service-name'], process.env.RENDER_SERVICE_NAME, defaultServiceName);
  const ownerIdArg = firstNonEmpty(args['owner-id'], process.env.RENDER_OWNER_ID);
  const region = firstNonEmpty(args.region, process.env.RENDER_REGION, 'oregon');
  const plan = firstNonEmpty(args.plan, process.env.RENDER_PLAN, 'free');

  const telegramToken = firstNonEmpty(args['telegram-token'], process.env.TELEGRAM_BOT_TOKEN, tgYaml.bot_token);
  const webhookSecret = firstNonEmpty(args['webhook-secret'], process.env.TELEGRAM_WEBHOOK_SECRET, randomSecret(40));

  const providerEnv = {
    GEMINI_API_KEY: firstNonEmpty(args['gemini-key'], process.env.GEMINI_API_KEY),
    OPENAI_API_KEY: firstNonEmpty(args['openai-key'], process.env.OPENAI_API_KEY),
    OPENROUTER_API_KEY: firstNonEmpty(args['openrouter-key'], process.env.OPENROUTER_API_KEY),
    CLOUDFLARE_ACCOUNT_ID: firstNonEmpty(args['cloudflare-account-id'], process.env.CLOUDFLARE_ACCOUNT_ID),
    CLOUDFLARE_API_TOKEN: firstNonEmpty(args['cloudflare-api-token'], process.env.CLOUDFLARE_API_TOKEN),
    HUGGINGFACE_INFERENCE_API_TOKEN: firstNonEmpty(args['huggingface-token'], process.env.HUGGINGFACE_INFERENCE_API_TOKEN)
  };

  const notifyChatId = firstChatId(
    firstNonEmpty(args['notify-chat-id'], process.env.TELEGRAM_NOTIFY_CHAT_ID, tgYaml.allowed_chat_ids),
    '1796415913'
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

  if (!renderApiKey) {
    throw new Error('Missing Render API key. Set RENDER_API_KEY or pass --render-api-key');
  }
  if (!telegramToken) {
    throw new Error('Missing Telegram bot token. Put it in .telegram.yaml or TELEGRAM_BOT_TOKEN or --telegram-token');
  }
  const keyCheck = validateProviderEnv(providerEnv, requireAllKeys);
  if (!keyCheck.ok) {
    if (requireAllKeys) {
      throw new Error(`Missing provider keys for strict deployment: ${keyCheck.missing.join(', ')}`);
    }
    throw new Error('Missing provider keys. At least one provider key is required (e.g. GEMINI_API_KEY).');
  }

  const render = new RenderApiClient(renderApiKey);

  let ownerId = ownerIdArg;
  if (!ownerId) {
    const owners = await render.listOwners();
    if (!owners.length) throw new Error('No Render owners/workspaces found for this API key.');
    ownerId = String((owners[0].owner && owners[0].owner.id) || owners[0].id || '');
    if (!ownerId) throw new Error('Unable to resolve ownerId from Render API.');
  }

  let postgresId = postgresIdArg;
  if (!databaseUrl) {
    if (!postgresId) {
      const existingPg = await render.listPostgresByName(postgresName, ownerId);
      const pgRecord = existingPg.find((row) => String(row?.postgres?.name || row?.name || '') === postgresName);
      if (pgRecord) {
        postgresId = String((pgRecord.postgres && pgRecord.postgres.id) || pgRecord.id || '');
        console.log(`[deploy] postgres exists: ${postgresName}`);
      } else {
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
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    COMICBOT_ALLOWED_CHAT_IDS: allowedChatIds,
    ...providerEnv
  };

  await render.setServiceEnvVars(serviceId, envVars);
  console.log('[deploy] env vars synced');

  const triggerStartedAtMs = Date.now();
  const deployStart = await render.triggerDeploy(serviceId);
  console.log('[deploy] deploy triggered');
  const deployId = await resolveDeployId(render, serviceId, deployStart, triggerStartedAtMs);
  if (!deployId) throw new Error('Could not resolve deploy ID after trigger.');
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

  const webhookUrl = await setTelegramWebhook(telegramToken, webhookSecret, publicUrl);

  console.log('');
  console.log('Deployment complete');
  console.log(`- Service ID: ${serviceId}`);
  console.log(`- Public URL: ${publicUrl}`);
  console.log(`- Health: ${publicUrl.replace(/\/+$/, '')}/healthz`);
  console.log(`- Webhook: ${webhookUrl}`);
  console.log('Try in Telegram: /start');
}

main().catch((error) => {
  console.error('[deploy] failed:', error && error.message ? error.message : String(error));
  process.exit(1);
});
