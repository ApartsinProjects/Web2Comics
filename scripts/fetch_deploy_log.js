#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadEnvFiles } = require('../telegram/src/env');
const { RenderApiClient } = require('../telegram/scripts/render-api');

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

function readJsonSafe(filePath) {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function toIsoOrEmpty(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

async function resolveDeployWindow(render, serviceId, deployId, minutesFallback) {
  const now = Date.now();
  const minutes = Math.max(1, Number(minutesFallback || 30));
  if (!deployId) {
    const rows = await render.listDeploys(serviceId, 5);
    const list = (Array.isArray(rows) ? rows : []).map((r) => (r && r.deploy ? r.deploy : r)).filter(Boolean);
    if (list.length) {
      const sorted = list
        .map((d) => ({ d, ts: Date.parse(String(d.createdAt || '')) || 0 }))
        .sort((a, b) => b.ts - a.ts);
      const latest = sorted[0].d;
      const depId = String(latest.id || '').trim();
      const createdAt = Date.parse(String(latest.createdAt || '')) || (now - (minutes * 60 * 1000));
      const updatedAt = Date.parse(String(latest.updatedAt || latest.finishedAt || latest.createdAt || '')) || now;
      return {
        deployId: depId,
        startTime: new Date(createdAt - 60 * 1000).toISOString(),
        endTime: new Date(updatedAt + 60 * 1000).toISOString(),
        deploy: latest
      };
    }
  }

  if (deployId) {
    try {
      const deploy = await render.getDeploy(serviceId, deployId);
      const createdAt = Date.parse(String(deploy?.createdAt || '')) || (now - (minutes * 60 * 1000));
      const updatedAt = Date.parse(String(deploy?.updatedAt || deploy?.finishedAt || deploy?.createdAt || '')) || now;
      return {
        deployId,
        startTime: new Date(createdAt - 60 * 1000).toISOString(),
        endTime: new Date(updatedAt + 60 * 1000).toISOString(),
        deploy
      };
    } catch (_) {
      // Fall through to generic range below.
    }
  }

  return {
    deployId: String(deployId || '').trim(),
    startTime: new Date(now - (minutes * 60 * 1000)).toISOString(),
    endTime: new Date(now).toISOString(),
    deploy: null
  };
}

function formatLogLine(row) {
  const ts = firstNonEmpty(row?.timestamp, row?.time, row?.createdAt, row?.created_at, '-');
  const level = firstNonEmpty(row?.level, row?.severity, row?.source, '').toUpperCase();
  const msg = String(row?.message || '').replace(/\s+/g, ' ').trim();
  return `${ts}${level ? ` [${level}]` : ''} ${msg}`.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  loadEnvFiles([
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, 'telegram/.env')
  ]);

  const metadataPath = path.resolve(args['metadata-in'] || path.join(repoRoot, 'telegram/out/deploy-render-metadata.json'));
  const metadata = readJsonSafe(metadataPath);

  const renderApiKey = firstNonEmpty(args['render-api-key'], process.env.RENDER_API_KEY);
  const ownerId = firstNonEmpty(args['owner-id'], process.env.RENDER_OWNER_ID, metadata.ownerId);
  const serviceId = firstNonEmpty(args['service-id'], metadata.serviceId);
  const serviceName = firstNonEmpty(args['service-name'], metadata.serviceName);
  const deployId = firstNonEmpty(args['deploy-id']);
  const minutes = asInt(args.minutes, 30);
  const limit = asInt(args.limit, 200);
  const outDir = path.resolve(args['out-dir'] || path.join(repoRoot, 'telegram/out/deploy-logs'));

  if (!renderApiKey) throw new Error('Missing Render API key (RENDER_API_KEY or --render-api-key).');
  if (!ownerId) throw new Error('Missing owner ID (--owner-id or deploy metadata).');
  if (!serviceId) throw new Error('Missing service ID (--service-id or deploy metadata).');

  const render = new RenderApiClient(renderApiKey);
  const windowInfo = await resolveDeployWindow(render, serviceId, deployId, minutes);
  const logs = await render.listLogs({
    ownerId,
    resourceId: serviceId,
    direction: 'backward',
    startTime: windowInfo.startTime,
    endTime: windowInfo.endTime
  });
  const rows = Array.isArray(logs?.logs) ? logs.logs : [];
  const selected = rows.slice(0, limit);

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${serviceName || 'render-service'}-${windowInfo.deployId || 'latest'}-${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const txtPath = path.join(outDir, `${baseName}.log`);

  const payload = {
    fetchedAt: new Date().toISOString(),
    ownerId,
    serviceId,
    serviceName,
    deployId: windowInfo.deployId || '',
    startTime: windowInfo.startTime,
    endTime: windowInfo.endTime,
    deployCreatedAt: toIsoOrEmpty(windowInfo?.deploy?.createdAt),
    deployUpdatedAt: toIsoOrEmpty(windowInfo?.deploy?.updatedAt || windowInfo?.deploy?.finishedAt),
    logCount: selected.length,
    logs: selected
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(txtPath, selected.map(formatLogLine).join('\n') + (selected.length ? '\n' : ''), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    ownerId,
    serviceId,
    serviceName,
    deployId: payload.deployId,
    startTime: payload.startTime,
    endTime: payload.endTime,
    logCount: payload.logCount,
    jsonPath,
    txtPath
  }, null, 2));
}

main().catch((error) => {
  console.error(`[fetch_deploy_log] failed: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});

