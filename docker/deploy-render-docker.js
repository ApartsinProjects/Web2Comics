#!/usr/bin/env node
const path = require('path');
const { loadEnvFiles } = require('../telegram/src/env');
const { RenderApiClient } = require('../telegram/scripts/render-api');
const {
  parseArgs,
  readTelegramYaml,
  readCloudflareYaml,
  readAwsYaml
} = require('../telegram/scripts/lib');
const { normalizeCloudflareR2Endpoint } = require('../telegram/src/r2-endpoint');

const HELP = [
  'Usage: node docker/deploy-render-docker.js [options]',
  '',
  'Options:',
  '  --render-api-key <key>          Render API key',
  '  --owner-id <id>                 Render owner/workspace id',
  '  --service-name <name>           Service name (default: web2comics-telegram-render-bot)',
  '  --repo-url <url>                Git repo url',
  '  --branch <branch>               Repo branch (default: engine)',
  '  --region <region>               Render region (default: oregon)',
  '  --plan <plan>                   Render plan (default: free)',
  '  --telegram-token <token>        Telegram bot token',
  '  --webhook-secret <secret>       Telegram webhook secret',
  '  --allowed-chat-ids <csv>        Allowed chats csv (default: all)',
  '  --admin-chat-ids <csv>          Admin chat ids csv',
  '  --help                          Print help'
].join('\n');

function firstNonEmpty(...values) {
  for (const v of values) {
    const t = String(v == null ? '' : v).trim();
    if (t) return t;
  }
  return '';
}

function resolveCloudflareAiToken(cfYaml) {
  const tokens = (cfYaml && cfYaml.api_tokens) || {};
  return firstNonEmpty(
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN,
    tokens.workers_ai_token,
    tokens.cloudflare_ai_token,
    tokens.ai_token
  );
}

function resolveCloudflareAccountApiToken(cfYaml) {
  const tokens = (cfYaml && cfYaml.api_tokens) || {};
  return firstNonEmpty(
    process.env.CLOUDFLARE_ACCOUNT_API_TOKEN,
    tokens.account_api_token,
    tokens.r2_account_token,
    tokens.account_token,
    tokens.r2_token,
    tokens.env_e2e_token,
    tokens.additional_token_1,
    tokens.additional_token_2
  );
}

function resolveR2Env(args, cfYaml, awsYaml) {
  const cfR2 = (cfYaml && cfYaml.r2) || {};
  const endpoints = cfR2.endpoints || {};
  const keys = cfR2.s3_clients || {};
  const kp2 = keys.keypair_2 || {};
  const kp1 = keys.keypair_1 || {};

  const accountId = firstNonEmpty(
    args['cloudflare-account-id'],
    process.env.CLOUDFLARE_ACCOUNT_ID,
    cfYaml && cfYaml.account_id
  );
  const endpointRaw = firstNonEmpty(
    args['r2-endpoint'],
    process.env.R2_S3_ENDPOINT,
    endpoints.global_s3,
    endpoints.regional_s3_eu,
    accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''
  );
  const endpoint = normalizeCloudflareR2Endpoint(endpointRaw, accountId);
  return {
    CLOUDFLARE_ACCOUNT_ID: String(accountId || '').trim(),
    R2_S3_ENDPOINT: String(endpoint || '').trim(),
    R2_BUCKET: firstNonEmpty(args['r2-bucket'], process.env.R2_BUCKET, cfR2.bucket, 'web2comics-bot-data'),
    R2_ACCESS_KEY_ID: firstNonEmpty(args['r2-access-key-id'], process.env.R2_ACCESS_KEY_ID, kp2.access_key_id, kp1.access_key_id, awsYaml.aws_access_key_id),
    R2_SECRET_ACCESS_KEY: firstNonEmpty(args['r2-secret-access-key'], process.env.R2_SECRET_ACCESS_KEY, kp2.secret_access_key, kp1.secret_access_key, awsYaml.aws_secret_access_key)
  };
}

async function resolveOwnerId(render, ownerId) {
  if (ownerId) return ownerId;
  const owners = await render.listOwners();
  if (!owners.length) throw new Error('No Render owners/workspaces found for this API key.');
  const resolved = String((owners[0].owner && owners[0].owner.id) || owners[0].id || '').trim();
  if (!resolved) throw new Error('Unable to resolve ownerId from Render API.');
  return resolved;
}

async function setTelegramWebhook(token, secret, publicBaseUrl) {
  const webhookUrl = `${String(publicBaseUrl || '').replace(/\/+$/, '')}/telegram/webhook/${secret}`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true
    })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(json)}`);
  }
  return webhookUrl;
}

async function waitForServiceUrl(render, serviceId, timeoutMs = 180000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const svc = await render.getService(serviceId);
    const url = String(svc?.serviceDetails?.url || '').trim();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return '';
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'telegram/.env')
  ]);
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    console.log(HELP);
    return;
  }

  const tgYaml = readTelegramYaml(repoRoot);
  const cfYaml = readCloudflareYaml(repoRoot);
  const awsYaml = readAwsYaml(repoRoot);

  const renderApiKey = firstNonEmpty(args['render-api-key'], process.env.RENDER_API_KEY);
  const serviceName = firstNonEmpty(args['service-name'], process.env.RENDER_SERVICE_NAME, 'web2comics-telegram-render-bot');
  const repoUrl = firstNonEmpty(args['repo-url'], process.env.RENDER_REPO_URL, 'https://github.com/ApartsinProjects/Web2Comics');
  const branch = firstNonEmpty(args.branch, process.env.RENDER_REPO_BRANCH, 'engine');
  const plan = firstNonEmpty(args.plan, process.env.RENDER_PLAN, 'free');
  const region = firstNonEmpty(args.region, process.env.RENDER_REGION, 'oregon');
  const telegramToken = firstNonEmpty(args['telegram-token'], process.env.TELEGRAM_BOT_TOKEN, tgYaml.bot_token);
  const webhookSecret = firstNonEmpty(args['webhook-secret'], process.env.TELEGRAM_WEBHOOK_SECRET, tgYaml.webhook_secret);
  const adminChatIds = firstNonEmpty(args['admin-chat-ids'], process.env.TELEGRAM_ADMIN_CHAT_IDS, tgYaml.admin_chat_id, tgYaml.admin_chat_ids, '1796415913');
  const allowedChatIds = firstNonEmpty(args['allowed-chat-ids'], process.env.COMICBOT_ALLOWED_CHAT_IDS, 'all');

  if (!renderApiKey) throw new Error('Missing Render API key (--render-api-key or RENDER_API_KEY)');
  if (!telegramToken) throw new Error('Missing telegram token (--telegram-token or TELEGRAM_BOT_TOKEN)');
  if (!webhookSecret) throw new Error('Missing webhook secret (--webhook-secret or TELEGRAM_WEBHOOK_SECRET)');

  const render = new RenderApiClient(renderApiKey);
  const ownerId = await resolveOwnerId(render, firstNonEmpty(args['owner-id'], process.env.RENDER_OWNER_ID));
  const list = await render.listServicesByName(serviceName, ownerId);
  let service = list.find((row) => String(row?.service?.name || row?.name || '').trim() === serviceName);

  const dockerDetails = {
    runtime: 'docker',
    plan,
    region,
    envSpecificDetails: {
      dockerCommand: 'node telegram/src/webhook-bot.js',
      dockerContext: '.',
      dockerfilePath: 'docker/Dockerfile'
    },
    healthCheckPath: '/healthz',
    numInstances: 1
  };

  if (!service) {
    service = await render.createWebService({
      type: 'web_service',
      name: serviceName,
      ownerId,
      repo: repoUrl,
      branch,
      autoDeploy: 'yes',
      serviceDetails: dockerDetails
    });
    console.log(`[docker-deploy] created service: ${serviceName}`);
  } else {
    console.log(`[docker-deploy] service exists: ${serviceName}`);
  }

  const serviceId = String((service.service && service.service.id) || service.id || '').trim();
  if (!serviceId) throw new Error('Could not resolve service id.');

  await render.updateService(serviceId, { serviceDetails: dockerDetails });
  console.log('[docker-deploy] runtime switched to docker');

  const r2 = resolveR2Env(args, cfYaml, awsYaml);
  const envVars = {
    TELEGRAM_BOT_TOKEN: telegramToken,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    COMICBOT_ALLOWED_CHAT_IDS: allowedChatIds,
    RENDER_BOT_PERSISTENCE_MODE: 'r2',
    RENDER_BOT_BASE_CONFIG: 'telegram/config/default.render.yml',
    RENDER_BOT_STATE_FILE: 'telegram/data/runtime-state.json',
    RENDER_BOT_OUT_DIR: 'telegram/out',
    RENDER_BOT_FETCH_TIMEOUT_MS: '45000',
    RENDER_BOT_DEFAULT_PROVIDER: firstNonEmpty(process.env.RENDER_BOT_DEFAULT_PROVIDER, 'gemini'),
    RENDER_BOT_DEFAULT_OBJECTIVE: firstNonEmpty(process.env.RENDER_BOT_DEFAULT_OBJECTIVE, 'explain-like-im-five'),
    R2_STATE_KEY: firstNonEmpty(process.env.R2_STATE_KEY, 'state/runtime-config.json'),
    R2_IMAGE_PREFIX: firstNonEmpty(process.env.R2_IMAGE_PREFIX, 'images'),
    R2_IMAGE_STATUS_KEY: firstNonEmpty(process.env.R2_IMAGE_STATUS_KEY, 'status/image-storage-status.json'),
    R2_CRASH_LOG_PREFIX: firstNonEmpty(process.env.R2_CRASH_LOG_PREFIX, 'crash_log'),
    R2_CRASH_LOG_STATUS_KEY: firstNonEmpty(process.env.R2_CRASH_LOG_STATUS_KEY, 'status/crash-storage-status.json'),
    CLOUDFLARE_WORKERS_AI_TOKEN: resolveCloudflareAiToken(cfYaml),
    CLOUDFLARE_ACCOUNT_API_TOKEN: resolveCloudflareAccountApiToken(cfYaml),
    ...r2,
    GEMINI_API_KEY: String(process.env.GEMINI_API_KEY || '').trim(),
    OPENAI_API_KEY: String(process.env.OPENAI_API_KEY || '').trim(),
    OPENROUTER_API_KEY: String(process.env.OPENROUTER_API_KEY || '').trim(),
    HUGGINGFACE_INFERENCE_API_TOKEN: String(process.env.HUGGINGFACE_INFERENCE_API_TOKEN || '').trim()
  };

  await render.setServiceEnvVars(serviceId, envVars);
  console.log('[docker-deploy] env vars synced');

  const deploy = await render.triggerDeploy(serviceId);
  const deployId = String(deploy?.id || deploy?.deploy?.id || '').trim();
  console.log(`[docker-deploy] deploy triggered${deployId ? `: ${deployId}` : ''}`);

  const serviceUrl = await waitForServiceUrl(render, serviceId, 180000);
  if (!serviceUrl) {
    console.log('[docker-deploy] warning: service URL is not available yet, webhook registration skipped');
    return;
  }
  const webhookUrl = await setTelegramWebhook(telegramToken, webhookSecret, serviceUrl);
  console.log(`[docker-deploy] webhook set: ${webhookUrl}`);
}

main().catch((error) => {
  console.error(`[docker-deploy] failed: ${String(error?.message || error)}`);
  process.exit(1);
});
