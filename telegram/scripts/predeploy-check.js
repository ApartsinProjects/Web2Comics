#!/usr/bin/env node
const { execSync } = require('child_process');
const { loadEnvFiles } = require('../src/env');
const path = require('path');

function run(cmd, env) {
  execSync(cmd, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(env || {}) }
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function parseBool(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function validateCloudflareTokenRoles(env = process.env) {
  const accountId = firstNonEmpty(env.CLOUDFLARE_ACCOUNT_ID);
  const workersAiToken = firstNonEmpty(env.CLOUDFLARE_WORKERS_AI_TOKEN);
  const accountApiToken = firstNonEmpty(env.CLOUDFLARE_ACCOUNT_API_TOKEN);
  const legacyApiToken = firstNonEmpty(env.CLOUDFLARE_API_TOKEN);
  const anyCloudflareSet = Boolean(accountId || workersAiToken || accountApiToken || legacyApiToken);
  const issues = [];

  if (!anyCloudflareSet) {
    return {
      enabled: false,
      accountId: '',
      workersAiToken: '',
      accountApiToken: '',
      issues
    };
  }

  if (!accountId) issues.push('Missing CLOUDFLARE_ACCOUNT_ID.');
  if (!workersAiToken) issues.push('Missing CLOUDFLARE_WORKERS_AI_TOKEN (Workers AI provider token).');
  if (!accountApiToken) issues.push('Missing CLOUDFLARE_ACCOUNT_API_TOKEN (Cloudflare account token for R2 API).');

  if (legacyApiToken && workersAiToken && legacyApiToken !== workersAiToken) {
    issues.push('CLOUDFLARE_API_TOKEN must match CLOUDFLARE_WORKERS_AI_TOKEN when set.');
  }
  if (legacyApiToken && accountApiToken && legacyApiToken === accountApiToken) {
    issues.push('CLOUDFLARE_API_TOKEN looks like the account token; it must represent Workers AI token only.');
  }

  return {
    enabled: true,
    accountId,
    workersAiToken,
    accountApiToken,
    issues
  };
}

async function fetchJson(url, options = {}, label = 'request') {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const details = errors.map((e) => `${e.code}:${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`${label} failed: ${details}`);
  }
  return json;
}

async function verifyCloudflareWorkersAiToken(accountId, workersAiToken) {
  const model = '@cf/meta/llama-3.1-8b-instruct';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  await fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workersAiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt: 'ping' })
  }, 'Cloudflare Workers AI token check');
}

async function verifyCloudflareAccountToken(accountId, accountApiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
  await fetchJson(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accountApiToken}`,
      'Content-Type': 'application/json'
    }
  }, 'Cloudflare account API token check');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  loadEnvFiles([
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'telegram/.env')
  ]);

  const tokenRoles = validateCloudflareTokenRoles(process.env);
  if (tokenRoles.issues.length) {
    throw new Error(`Cloudflare token role validation failed:\n- ${tokenRoles.issues.join('\n- ')}`);
  }
  if (!tokenRoles.enabled) {
    console.log('[predeploy] cloudflare token-role check skipped (no Cloudflare vars set)');
  } else {
    console.log('[predeploy] cloudflare token-role mapping OK');
    const skipAuth = parseBool(process.env.RENDER_SKIP_PROVIDER_AUTH_CHECK);
    if (skipAuth) {
      console.log('[predeploy] cloudflare live auth probes skipped (RENDER_SKIP_PROVIDER_AUTH_CHECK=true)');
    } else {
      await verifyCloudflareWorkersAiToken(tokenRoles.accountId, tokenRoles.workersAiToken);
      console.log('[predeploy] cloudflare workers AI token probe OK');
      await verifyCloudflareAccountToken(tokenRoles.accountId, tokenRoles.accountApiToken);
      console.log('[predeploy] cloudflare account API token probe OK');
    }
  }

  run('npm run test:telegram');

  const runReal = String(process.env.RUN_RENDER_REAL_GEMINI || '') === '1';
  if (runReal) {
    run('npm run test:telegram:gemini-real');
  }

  console.log('[predeploy] render test checks passed');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[predeploy] failed:', error && error.message ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  validateCloudflareTokenRoles
};
