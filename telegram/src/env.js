const fs = require('fs');
const path = require('path');

function parseEnvFile(raw) {
  const out = {};
  String(raw || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) return;
    out[key] = value;
  });
  return out;
}

function loadEnvFiles(paths) {
  (Array.isArray(paths) ? paths : []).forEach((p) => {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) return;
    const kv = parseEnvFile(fs.readFileSync(resolved, 'utf8'));
    Object.entries(kv).forEach(([k, v]) => {
      if (!process.env[k]) process.env[k] = v;
    });
  });
}

function readSecretFile(secretPath) {
  const resolved = path.resolve(String(secretPath || '').trim());
  if (!resolved || !fs.existsSync(resolved)) return '';
  try {
    return String(fs.readFileSync(resolved, 'utf8') || '').trim();
  } catch (_) {
    return '';
  }
}

function secretFileCandidatesForKey(key, options = {}) {
  const k = String(key || '').trim();
  if (!k) return [];
  const fileVar = String(process.env[`${k}_FILE`] || '').trim();
  const baseDir = String(options.baseDir || '/run/secrets').trim();
  const normalized = k.toLowerCase();
  const dashed = normalized.replace(/_/g, '-');
  return [fileVar, path.join(baseDir, k), path.join(baseDir, normalized), path.join(baseDir, dashed)]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function loadSecretValues(secretKeys, options = {}) {
  const keys = Array.isArray(secretKeys) ? secretKeys : [];
  keys.forEach((key) => {
    const envValue = String(process.env[key] || '').trim();
    if (envValue) return;
    const candidates = secretFileCandidatesForKey(key, options);
    for (const file of candidates) {
      const value = readSecretFile(file);
      if (!value) continue;
      process.env[key] = value;
      break;
    }
  });
}

module.exports = {
  parseEnvFile,
  loadEnvFiles,
  loadSecretValues
};
