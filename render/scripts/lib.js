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

function randomSecret(len = 36) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

module.exports = {
  parseArgs,
  readTelegramYaml,
  randomSecret
};
