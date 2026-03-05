#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '');
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      out[k] = String(next);
      i += 1;
    } else {
      out[k] = 'true';
    }
  }
  return out;
}

function readEnvFromLocalFiles(root) {
  const files = [path.join(root, '.env.local'), path.join(root, '.env.e2e.local'), path.join(root, 'telegram/.env')];
  const env = {};
  files.forEach((file) => {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const idx = t.indexOf('=');
      if (idx <= 0) return;
      const k = t.slice(0, idx).trim();
      const v = t.slice(idx + 1).trim();
      if (!(k in env)) env[k] = v;
    });
  });
  return env;
}

async function cfFetch(token, endpoint, options = {}) {
  const url = `https://api.cloudflare.com/client/v4${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const msg = (json.errors || []).map((e) => `${e.code}:${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`Cloudflare API ${endpoint} failed: ${msg}`);
  }
  return json.result;
}

function findGroup(groups, preferredPatterns) {
  for (const p of preferredPatterns) {
    const found = groups.find((g) => p.test(String(g.name || '')));
    if (found) return found;
  }
  return null;
}

async function createToken(token, payload) {
  return cfFetch(token, '/user/tokens', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = readEnvFromLocalFiles(root);
  const parentToken = String(args['parent-token'] || process.env.CLOUDFLARE_API_TOKEN || fileEnv.CLOUDFLARE_API_TOKEN || '').trim();
  const accountId = String(args['account-id'] || process.env.CLOUDFLARE_ACCOUNT_ID || fileEnv.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const outFile = path.resolve(args['out-file'] || '.cloudflare.tokens.yaml');

  if (!parentToken) throw new Error('Missing parent token. Use --parent-token or CLOUDFLARE_API_TOKEN.');
  if (!accountId) throw new Error('Missing account id. Use --account-id or CLOUDFLARE_ACCOUNT_ID.');

  await cfFetch(parentToken, '/user/tokens/verify');
  const groups = await cfFetch(parentToken, '/user/tokens/permission_groups');

  const r2Write = findGroup(groups, [/Workers R2 Storage Write/i, /R2 Storage Write/i]);
  const r2Read = findGroup(groups, [/Workers R2 Storage Read/i, /R2 Storage Read/i]);
  const workersScriptsWrite = findGroup(groups, [/Workers Scripts Write/i]);
  const workersKvWrite = findGroup(groups, [/Workers KV Storage Write/i]);

  if (!r2Write || !r2Read) {
    throw new Error('Could not resolve required R2 permission groups from this token context.');
  }

  const resources = { [`com.cloudflare.api.account.${accountId}`]: '*' };

  const tokensToCreate = [
    {
      key: 'r2_rw_token',
      payload: {
        name: `web2comics-r2-rw-${Date.now()}`,
        policies: [
          {
            effect: 'allow',
            resources,
            permission_groups: [r2Read, r2Write]
          }
        ]
      }
    }
  ];

  if (workersScriptsWrite || workersKvWrite) {
    const groupsForWorker = [workersScriptsWrite, workersKvWrite, r2Read, r2Write].filter(Boolean);
    tokensToCreate.push({
      key: 'workers_deploy_token',
      payload: {
        name: `web2comics-workers-deploy-${Date.now()}`,
        policies: [
          {
            effect: 'allow',
            resources,
            permission_groups: groupsForWorker
          }
        ]
      }
    });
  }

  const results = {};
  for (const item of tokensToCreate) {
    const created = await createToken(parentToken, item.payload);
    results[item.key] = {
      id: created.id,
      name: created.name,
      value: created.value,
      status: created.status
    };
  }

  const yaml = [
    `created_at: "${new Date().toISOString()}"`,
    `account_id: "${accountId}"`,
    'tokens:'
  ];
  Object.entries(results).forEach(([k, v]) => {
    yaml.push(`  ${k}:`);
    yaml.push(`    id: "${String(v.id || '')}"`);
    yaml.push(`    name: "${String(v.name || '')}"`);
    yaml.push(`    status: "${String(v.status || '')}"`);
    yaml.push(`    value: "${String(v.value || '')}"`);
  });

  fs.writeFileSync(outFile, `${yaml.join('\n')}\n`, 'utf8');
  console.log(`Created ${Object.keys(results).length} token(s). Saved to ${outFile}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
