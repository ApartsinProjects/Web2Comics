#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

function asInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function listCrashJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => name.endsWith('.json') && name !== 'latest.json')
    .map((name) => path.join(dirPath, name))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch (_) {
        return false;
      }
    });
}

function safeDate(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function formatEntry(entry, idx) {
  const ts = String(entry?.timestamp || entry?.createdAt || '-');
  const event = String(entry?.event || 'unknown');
  const msg = String(entry?.error?.message || entry?.message || '').replace(/\s+/g, ' ').trim();
  const shortMsg = msg.length > 200 ? `${msg.slice(0, 200)}...` : msg;
  const code = String(entry?.error?.code || entry?.code || '').trim();
  return [
    `${idx + 1}. ${ts} | ${event}`,
    code ? `   code: ${code}` : '',
    shortMsg ? `   msg: ${shortMsg}` : ''
  ].filter(Boolean).join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const dir = path.resolve(args.dir || path.join(repoRoot, 'crash_log'));
  const n = asInt(args.n, 10);

  if (!fs.existsSync(dir)) {
    console.log(`No crash log directory found: ${dir}`);
    process.exit(0);
  }

  const files = listCrashJsonFiles(dir);
  if (!files.length) {
    console.log(`No crash entries found in ${dir}`);
    process.exit(0);
  }

  const rows = files
    .map((filePath) => {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return { filePath, data };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const at = safeDate(a.data?.timestamp || a.data?.createdAt);
      const bt = safeDate(b.data?.timestamp || b.data?.createdAt);
      return bt - at;
    })
    .slice(0, n);

  console.log(`Crash log dir: ${dir}`);
  console.log(`Showing latest ${rows.length} entries:`);
  rows.forEach((row, idx) => {
    console.log(formatEntry(row.data, idx));
    console.log(`   file: ${row.filePath}`);
  });
}

main();

