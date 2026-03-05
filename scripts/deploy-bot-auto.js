#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = String(next);
      i += 1;
    }
  }
  return out;
}

function asBool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function cmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args, env = {}) {
  const child = spawnSync(cmd(), args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, ...(env || {}) }
  });
  if (child.status !== 0) {
    throw new Error(`Command failed: npm ${args.join(' ')}`);
  }
}

function buildRenderDeployArgs(args) {
  const allowed = [
    'branch',
    'service-name',
    'owner-id',
    'region',
    'plan',
    'render-api-key',
    'repo-url',
    'telegram-token',
    'webhook-secret',
    'notify-chat-id',
    'telegram-test-chat-id',
    'allowed-chat-ids',
    'admin-chat-ids',
    'postgres-id',
    'postgres-name',
    'postgres-plan',
    'postgres-version',
    'postgres-region',
    'database-url',
    'pg-url',
    'pg-table',
    'pg-state-key',
    'cloudflare-account-id',
    'cloudflare-api-token',
    'r2-endpoint',
    'r2-bucket',
    'r2-access-key-id',
    'r2-secret-access-key',
    'r2-image-prefix',
    'r2-image-status-key',
    'r2-crash-log-prefix',
    'r2-crash-log-status-key',
    'r2-request-log-prefix',
    'r2-request-log-status-key',
    'r2-image-capacity-bytes',
    'r2-image-threshold-ratio',
    'r2-crash-capacity-bytes',
    'r2-crash-threshold-ratio',
    'r2-request-capacity-bytes',
    'r2-request-threshold-ratio',
    'r2-crash-retention-days',
    'r2-request-retention-days',
    'test-deployment',
    'require-all-keys',
    'allow-partial-keys',
    'env-only',
    'gemini-key',
    'openai-key',
    'openrouter-key',
    'huggingface-token'
  ];
  const out = [];
  allowed.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(args, key)) return;
    const value = String(args[key] || '').trim();
    if (!value || value.toLowerCase() === 'false') return;
    if (value.toLowerCase() === 'true') {
      out.push(`--${key}`);
      return;
    }
    out.push(`--${key}`, value);
  });
  return out;
}

function shouldRunRenderSmoke(args) {
  if (asBool(args['skip-smoke'], false)) return false;
  return asBool(args['with-render-smoke'], false);
}

function shouldRunCloudflareSmoke(args) {
  if (asBool(args['skip-smoke'], false)) return false;
  return asBool(args['with-cloudflare-smoke'], false);
}

function targetList(rawTarget) {
  const t = String(rawTarget || 'render').trim().toLowerCase();
  if (t === 'both') return ['render', 'cloudflare'];
  if (t === 'cloudflare') return ['cloudflare'];
  return ['render'];
}

function printSummary(args, targets) {
  console.log('[deploy:auto] config');
  console.log(`- targets: ${targets.join(', ')}`);
  console.log(`- skip prechecks: ${asBool(args['skip-prechecks'], false)}`);
  console.log(`- skip local tests: ${asBool(args['skip-local-tests'], false)}`);
  console.log(`- render smoke: ${shouldRunRenderSmoke(args)}`);
  console.log(`- cloudflare smoke: ${shouldRunCloudflareSmoke(args)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = targetList(args.target);
  printSummary(args, targets);

  if (!asBool(args['skip-prechecks'], false)) {
    runNpm(['run', 'test:render:predeploy']);
  }

  if (!asBool(args['skip-local-tests'], false)) {
    runNpm(['run', 'test:render:local']);
  }

  if (targets.includes('render')) {
    const renderDeployArgs = buildRenderDeployArgs(args);
    runNpm(['run', 'render:deploy:auto', '--', ...renderDeployArgs]);
    if (shouldRunRenderSmoke(args)) {
      runNpm(['run', 'test:render:full-stack'], { RUN_FULL_STACK_E2E: 'true' });
    }
  }

  if (targets.includes('cloudflare')) {
    runNpm(['run', 'deploy:cloudflare']);
    if (shouldRunCloudflareSmoke(args)) {
      runNpm(['run', 'test:cloudflare:smoke']);
    }
  }

  console.log('[deploy:auto] done');
}

main();
