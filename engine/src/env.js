const fs = require('fs');
const path = require('path');

function parseEnvLines(raw) {
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

function loadLocalEnvFiles(rootDir) {
  const root = path.resolve(rootDir || process.cwd());
  const candidates = [
    path.join(root, '.env.e2e.local'),
    path.join(root, '.env.local')
  ];
  candidates.forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    const values = parseEnvLines(fs.readFileSync(filePath, 'utf8'));
    Object.entries(values).forEach(([k, v]) => {
      if (!process.env[k]) process.env[k] = v;
    });
  });
}

module.exports = {
  loadLocalEnvFiles,
  parseEnvLines
};
