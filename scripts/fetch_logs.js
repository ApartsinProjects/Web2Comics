#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { loadEnvFiles } = require('../telegram/src/env');
const { S3Adapter } = require('../telegram/src/crash-log-store');
const { normalizeCloudflareR2Endpoint } = require('../telegram/src/r2-endpoint');

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

function asInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readYamlSafe(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return {};
  try {
    return yaml.load(fs.readFileSync(abs, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function getNested(obj, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function coalesceString(values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeDate(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchStatusLogs(adapter, bucket, statusKey, fallbackPrefix = '') {
  let raw = '';
  try {
    raw = await adapter.getObject(bucket, statusKey);
  } catch (_) {
    raw = '';
  }
  if (!raw) {
    if (!fallbackPrefix) return { status: null, keys: [] };
    const listed = await adapter.listKeys(bucket, fallbackPrefix);
    const filtered = listed.filter((k) => !k.endsWith('/status.json'));
    return { status: null, keys: filtered };
  }
  const status = JSON.parse(raw);
  const rows = Array.isArray(status?.logs) ? status.logs : [];
  const keys = rows
    .map((r) => String(r?.key || '').trim())
    .filter(Boolean);
  if (keys.length > 0) return { status, keys };
  if (!fallbackPrefix) return { status, keys: [] };
  const listed = await adapter.listKeys(bucket, fallbackPrefix);
  const filtered = listed.filter((k) => !k.endsWith('/status.json'));
  return { status, keys: filtered };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  loadEnvFiles([
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, 'telegram/.env'),
    path.join(repoRoot, 'comicbot/.env')
  ]);

  const cf = readYamlSafe(path.join(repoRoot, '.cloudflare.yaml'));
  const type = String(args.type || 'all').trim().toLowerCase();
  const outDir = path.resolve(args['out-dir'] || path.join(repoRoot, 'telegram/out/fetched-logs'));
  const limit = asInt(args.limit, 200);
  const sinceTs = args.since ? safeDate(args.since) : 0;
  const overwrite = asBool(args.overwrite, false);
  const analyze = asBool(args.analyze, true);

  const endpointRaw = coalesceString([
    args.endpoint,
    process.env.R2_S3_ENDPOINT,
    getNested(cf, 'cloudflare.r2.endpoints.global_s3'),
    getNested(cf, 'cloudflare.r2.endpoints.regional_s3_eu')
  ]);
  const endpoint = normalizeCloudflareR2Endpoint(endpointRaw, coalesceString([
    process.env.CLOUDFLARE_ACCOUNT_ID,
    getNested(cf, 'cloudflare.account_id')
  ]));
  const bucket = coalesceString([
    args.bucket,
    process.env.R2_BUCKET,
    getNested(cf, 'cloudflare.r2.bucket')
  ]);
  const accessKeyId = coalesceString([
    args['access-key-id'],
    process.env.R2_ACCESS_KEY_ID,
    getNested(cf, 'cloudflare.r2.s3_clients.keypair_1.access_key_id'),
    getNested(cf, 'cloudflare.r2.s3_clients.keypair_2.access_key_id')
  ]);
  const secretAccessKey = coalesceString([
    args['secret-access-key'],
    process.env.R2_SECRET_ACCESS_KEY,
    getNested(cf, 'cloudflare.r2.s3_clients.keypair_1.secret_access_key'),
    getNested(cf, 'cloudflare.r2.s3_clients.keypair_2.secret_access_key')
  ]);

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials. Provide env vars or .cloudflare.yaml values.');
  }

  const adapter = new S3Adapter({
    endpoint,
    accessKeyId,
    secretAccessKey
  });

  const requestStatusKey = String(args['request-status-key'] || process.env.R2_REQUEST_LOG_STATUS_KEY || 'logs/requests/status.json').trim();
  const requestPrefix = String(args['request-prefix'] || process.env.R2_REQUEST_LOG_PREFIX || 'logs/requests').trim();
  const crashStatusKey = String(args['crash-status-key'] || process.env.R2_CRASH_LOG_STATUS_KEY || 'crash-logs/status.json').trim();
  const crashPrefix = String(args['crash-prefix'] || process.env.R2_CRASH_LOG_PREFIX || 'crash-logs').trim();

  const targets = [];
  if (type === 'all' || type === 'request' || type === 'requests') {
    targets.push({ name: 'requests', statusKey: requestStatusKey, prefix: requestPrefix });
  }
  if (type === 'all' || type === 'crash' || type === 'crashes') {
    targets.push({ name: 'crash', statusKey: crashStatusKey, prefix: crashPrefix });
  }
  if (!targets.length) {
    throw new Error("Invalid --type. Use 'all', 'request', or 'crash'.");
  }

  ensureDir(outDir);
  const summary = {
    fetchedAt: new Date().toISOString(),
    endpointHost: (() => {
      try { return new URL(endpoint).host; } catch (_) { return endpoint; }
    })(),
    bucket,
    outDir,
    limit,
    since: args.since || '',
    targets: []
  };

  for (const target of targets) {
    const tOut = path.join(outDir, target.name);
    ensureDir(tOut);
    let status = null;
    let keys = [];
    try {
      const data = await fetchStatusLogs(adapter, bucket, target.statusKey, target.prefix);
      status = data.status;
      keys = data.keys;
    } catch (error) {
      summary.targets.push({
        name: target.name,
        statusKey: target.statusKey,
        fetched: 0,
        skipped: 0,
        error: String(error?.message || error)
      });
      continue;
    }

    const rows = keys.map((key) => {
      let createdAt = '';
      if (status && Array.isArray(status.logs)) {
        const m = status.logs.find((r) => String(r?.key || '') === key);
        createdAt = String(m?.createdAt || '');
      }
      return { key, createdAt };
    });
    rows.sort((a, b) => safeDate(b.createdAt) - safeDate(a.createdAt));
    const filtered = rows
      .filter((r) => !sinceTs || safeDate(r.createdAt) >= sinceTs)
      .slice(0, limit);

    let fetched = 0;
    let skipped = 0;
    for (const row of filtered) {
      const localPath = path.join(tOut, row.key);
      ensureDir(path.dirname(localPath));
      if (!overwrite && fs.existsSync(localPath)) {
        skipped += 1;
        continue;
      }
      try {
        const raw = await adapter.getObject(bucket, row.key);
        fs.writeFileSync(localPath, raw || '', 'utf8');
        fetched += 1;
      } catch (_) {
        // Skip unreadable object.
      }
    }

    if (status) {
      writeJson(path.join(tOut, 'status.json'), status);
    }
    summary.targets.push({
      name: target.name,
      statusKey: target.statusKey,
      prefix: target.prefix,
      totalAvailable: rows.length,
      selected: filtered.length,
      fetched,
      skipped
    });
  }

  writeJson(path.join(outDir, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));

  if (analyze) {
    const analyzeScript = path.join(repoRoot, 'scripts/analyze_logs.js');
    const child = spawnSync(process.execPath, [analyzeScript, '--dir', outDir], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
    if (child.error) {
      console.error(`[fetch_logs] analyze_logs spawn failed: ${String(child.error.message || child.error)}`);
    } else if (child.status !== 0) {
      console.error(`[fetch_logs] analyze_logs exited with code ${child.status}`);
    }
  }
}

main().catch((error) => {
  console.error(`[fetch_logs] failed: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
