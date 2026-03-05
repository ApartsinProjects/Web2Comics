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

function runNpm(args, env = {}) {
  const command = process.platform === 'win32'
    ? `npm ${args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')}`
    : `npm ${args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')}`;
  const child = spawnSync(command, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, ...(env || {}) },
    shell: true
  });
  if (child.error) {
    throw new Error(`Command spawn failed: npm ${args.join(' ')} :: ${String(child.error.message || child.error)}`);
  }
  if (child.status !== 0) {
    throw new Error(`Command failed (exit=${child.status}): npm ${args.join(' ')}`);
  }
}

function runStep(label, args, env = {}) {
  const started = Date.now();
  console.log(`[deploy:auto] step:start ${label}`);
  try {
    runNpm(args, env);
    console.log(`[deploy:auto] step:ok ${label} (${Date.now() - started}ms)`);
  } catch (error) {
    console.error(`[deploy:auto] step:failed ${label} (${Date.now() - started}ms): ${String(error?.message || error)}`);
    throw error;
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
    'r2-state-key',
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

function shouldRunRenderSanity(args) {
  if (asBool(args['skip-sanity'], false)) return false;
  if (Object.prototype.hasOwnProperty.call(args, 'with-render-sanity')) {
    return asBool(args['with-render-sanity'], false);
  }
  return true;
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
  console.log(`- render sanity e2e: ${shouldRunRenderSanity(args)}`);
  console.log(`- cloudflare smoke: ${shouldRunCloudflareSmoke(args)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = targetList(args.target);
  printSummary(args, targets);

  if (!asBool(args['skip-prechecks'], false)) {
    runStep('predeploy-checks', ['run', 'test:render:predeploy']);
  }

  if (!asBool(args['skip-local-tests'], false)) {
    runStep('local-tests', ['run', 'test:render:local']);
  }

  if (targets.includes('render')) {
    const renderDeployArgs = buildRenderDeployArgs(args);
    runStep('render-deploy', ['run', 'render:deploy:auto', '--', ...renderDeployArgs]);
    if (shouldRunRenderSanity(args)) {
      const sanityArgs = ['run', 'render:deploy:sanity'];
      const metadataIn = String(args['metadata-in'] || process.env.RENDER_DEPLOY_METADATA_OUT || '').trim();
      if (metadataIn) {
        sanityArgs.push('--', '--metadata-in', metadataIn);
      }
      runStep('render-sanity-e2e', sanityArgs);
    }
    if (shouldRunRenderSmoke(args)) {
      runStep('render-full-stack-smoke', ['run', 'test:render:full-stack'], { RUN_FULL_STACK_E2E: 'true' });
    }
  }

  if (targets.includes('cloudflare')) {
    runStep('cloudflare-deploy', ['run', 'deploy:cloudflare']);
    if (shouldRunCloudflareSmoke(args)) {
      runStep('cloudflare-smoke', ['run', 'test:cloudflare:smoke']);
    }
  }

  console.log('[deploy:auto] done');
}

main();
