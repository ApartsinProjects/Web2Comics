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

module.exports = {
  parseEnvFile,
  loadEnvFiles
};
