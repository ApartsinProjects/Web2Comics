#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const cfDir = path.join(root, 'cloudflare');
const wranglerConfig = path.join(cfDir, 'wrangler.toml');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function loadTelegramTokenFromYaml() {
  if (String(process.env.BOT_SECRETS_ENV_ONLY || '').trim().toLowerCase() === 'true') return;
  const file = path.join(root, '.telegram.yaml');
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/bot_token:\s*"([^"]+)"/i);
  if (m && m[1] && !process.env.TELEGRAM_BOT_TOKEN) process.env.TELEGRAM_BOT_TOKEN = m[1].trim();
}

function run(command, options = {}) {
  return execSync(command, {
    stdio: 'pipe',
    cwd: root,
    env: process.env,
    ...options
  }).toString('utf8');
}

function ensureResourceBindings() {
  const raw = fs.readFileSync(wranglerConfig, 'utf8');
  if (raw.includes('__REPLACE_STATE_KV_ID__')) {
    console.log('[cf] creating KV namespace and updating wrangler config...');
    run(`npx wrangler kv namespace create web2comics_state --config ${wranglerConfig} --binding STATE_KV --update-config`);
  }

  if (!raw.includes('bucket_name = "web2comics-bot-data"')) {
    console.log('[cf] creating R2 bucket binding and updating wrangler config...');
    run(`npx wrangler r2 bucket create web2comics-bot-data --config ${wranglerConfig} --binding BOT_R2 --update-config`);
  } else {
    try {
      run(`npx wrangler r2 bucket create web2comics-bot-data --config ${wranglerConfig}`);
    } catch (_) {
      // bucket probably exists
    }
  }
}

function putSecret(name, value) {
  if (!value) return;
  execSync(`npx wrangler secret put ${name} --config ${wranglerConfig}`, {
    cwd: root,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: `${value}\n`
  });
}

async function setWebhook() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const base = String(process.env.CLOUDFLARE_WORKER_URL || '').trim();
  if (!token || !secret || !base) {
    console.log('[cf] skip setWebhook: missing TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / CLOUDFLARE_WORKER_URL');
    return;
  }

  const webhookUrl = `${base.replace(/\/$/, '')}/telegram/webhook/${secret}`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      drop_pending_updates: true,
      allowed_updates: ['message']
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`setWebhook failed: ${JSON.stringify(data)}`);
  console.log('[cf] webhook registered:', webhookUrl);
}

async function main() {
  loadEnvFile(path.join(root, '.env.e2e.local'));
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, 'render/.env'));
  loadTelegramTokenFromYaml();

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID');
  }

  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    process.env.TELEGRAM_WEBHOOK_SECRET = `cf-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }

  ensureResourceBindings();

  putSecret('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN);
  putSecret('TELEGRAM_WEBHOOK_SECRET', process.env.TELEGRAM_WEBHOOK_SECRET);
  putSecret('GEMINI_API_KEY', process.env.GEMINI_API_KEY || '');

  console.log('[cf] deploying worker...');
  const deployOut = run(`npx wrangler deploy --config ${wranglerConfig}`);
  process.stdout.write(deployOut);

  if (!process.env.CLOUDFLARE_WORKER_URL) {
    const m = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/);
    if (m) process.env.CLOUDFLARE_WORKER_URL = m[0];
  }

  await setWebhook();
  console.log('[cf] deploy completed');
}

main().catch((error) => {
  console.error('[cf] deploy failed:', error && error.message ? error.message : String(error));
  process.exit(1);
});
