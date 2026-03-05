const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function readTelegramYaml(repoRoot) {
  const p = path.resolve(repoRoot, '.telegram.yaml');
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(p, 'utf8')) || {};
    return parsed && parsed.telegram ? parsed.telegram : {};
  } catch (_) {
    return {};
  }
}

function readCloudflareYaml(repoRoot) {
  const p = path.resolve(repoRoot, '.cloudflare.yaml');
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(p, 'utf8')) || {};
    return parsed && parsed.cloudflare ? parsed.cloudflare : {};
  } catch (_) {
    return {};
  }
}

function readAwsYaml(repoRoot) {
  const p = path.resolve(repoRoot, '.aws.yaml');
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(p, 'utf8')) || {};
    return parsed || {};
  } catch (_) {
    return {};
  }
}

function randomSecret(len = 36) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function resolveLatestDeployId(rows, triggerStartedAtMs) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((row) => (row && row.deploy ? row.deploy : row))
    .filter(Boolean)
    .map((d) => ({
      id: String(d.id || '').trim(),
      createdAtMs: Date.parse(String(d.createdAt || ''))
    }))
    .filter((d) => d.id);

  if (!list.length) return '';
  const threshold = Number.isFinite(triggerStartedAtMs) ? (triggerStartedAtMs - 5000) : -Infinity;

  const recent = list
    .filter((d) => Number.isFinite(d.createdAtMs) && d.createdAtMs >= threshold)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  if (recent.length) return recent[0].id;

  list.sort((a, b) => (Number.isFinite(b.createdAtMs) ? b.createdAtMs : 0) - (Number.isFinite(a.createdAtMs) ? a.createdAtMs : 0));
  return list[0].id;
}

function validateProviderEnv(providerEnv, strictAll) {
  const map = providerEnv || {};
  const keys = Object.keys(map);
  const missing = keys.filter((k) => !String(map[k] || '').trim());

  if (strictAll) {
    return {
      ok: missing.length === 0,
      missing
    };
  }

  const anyPresent = keys.some((k) => String(map[k] || '').trim());
  return {
    ok: anyPresent,
    missing: anyPresent ? [] : keys.slice()
  };
}

module.exports = {
  parseArgs,
  readTelegramYaml,
  readCloudflareYaml,
  readAwsYaml,
  randomSecret,
  resolveLatestDeployId,
  validateProviderEnv
};
