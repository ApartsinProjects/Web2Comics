#!/usr/bin/env node
const { execSync } = require('child_process');
const { loadEnvFiles } = require('../src/env');
const path = require('path');
const { readCloudflareYaml } = require('./lib');

function run(cmd, env) {
  execSync(cmd, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(env || {}) }
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function parseBool(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

async function fetchTextWithTimeout(url, init, timeoutMs, label) {
  const ms = Math.max(1000, Number(timeoutMs || 30000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...(init || {}), signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (error) {
    throw new Error(`${label || 'request'} failed: ${String(error?.message || error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function verifyGeminiKey(apiKey) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const { res, text } = await fetchTextWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 8 }
    })
  }, 30000, 'Gemini auth');
  if (!res.ok) throw new Error(`Gemini auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyOpenAIKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'OpenAI auth');
  if (!res.ok) throw new Error(`OpenAI auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyOpenRouterKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'OpenRouter auth');
  if (!res.ok) throw new Error(`OpenRouter auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyGroqKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'Groq auth');
  if (!res.ok) throw new Error(`Groq auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyHuggingFaceKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://huggingface.co/api/whoami-v2', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'Hugging Face auth');
  if (!res.ok) throw new Error(`Hugging Face auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyCohereKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://api.cohere.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'Cohere auth');
  if (!res.ok) throw new Error(`Cohere auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyFirecrawlKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: 'example.com',
      limit: 1
    })
  }, 45000, 'Firecrawl auth');
  if (!res.ok) throw new Error(`Firecrawl auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyJinaKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://r.jina.ai/http://example.com', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/plain'
    }
  }, 45000, 'Jina auth');
  if (!res.ok) throw new Error(`Jina auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyDriftbotKey(apiKey) {
  const query = encodeURIComponent('type:Person');
  const url = `https://kg.diffbot.com/kg/v3/dql?token=${encodeURIComponent(apiKey)}&query=${query}&size=1`;
  const { res, text } = await fetchTextWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }, 45000, 'Driftbot auth');
  if (!res.ok) throw new Error(`Driftbot auth failed (${res.status}): ${text.slice(0, 220)}`);
}

async function verifyLlamaCloudKey(apiKey) {
  if (!String(apiKey || '').trim().startsWith('llx-')) {
    throw new Error('LlamaCloud key format is invalid (expected prefix llx-)');
  }
  const base = String(process.env.LLAMAPARSE_BASE_URL || process.env.LLAMA_CLOUD_BASE_URL || 'https://api.cloud.llamaindex.ai')
    .trim()
    .replace(/\/+$/, '');
  const { res, text } = await fetchTextWithTimeout(`${base}/api/v1/parsing/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 30000, 'LlamaParse auth');
  if (res.status === 401 || res.status === 403) {
    throw new Error(`LlamaParse auth failed (${res.status}): ${text.slice(0, 220)}`);
  }
}

async function verifyUnstructuredKey(apiKey) {
  const { res, text } = await fetchTextWithTimeout('https://api.unstructuredapp.io/general/v0/general', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'unstructured-api-key': apiKey
    },
    body: new FormData()
  }, 30000, 'Unstructured auth');
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Unstructured auth failed (${res.status}): ${text.slice(0, 220)}`);
  }
}

async function runVendorCredentialPreflight(env = process.env) {
  const accountId = firstNonEmpty(env.CLOUDFLARE_ACCOUNT_ID);
  const workersAiToken = firstNonEmpty(env.CLOUDFLARE_WORKERS_AI_TOKEN, env.CLOUDFLARE_API_TOKEN);

  const checks = [
    {
      key: 'GEMINI_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.GEMINI_API_KEY)),
      run: () => verifyGeminiKey(firstNonEmpty(env.GEMINI_API_KEY))
    },
    {
      key: 'OPENAI_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.OPENAI_API_KEY)),
      run: () => verifyOpenAIKey(firstNonEmpty(env.OPENAI_API_KEY))
    },
    {
      key: 'OPENROUTER_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.OPENROUTER_API_KEY)),
      run: () => verifyOpenRouterKey(firstNonEmpty(env.OPENROUTER_API_KEY))
    },
    {
      key: 'GROQ_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.GROQ_API_KEY)),
      run: () => verifyGroqKey(firstNonEmpty(env.GROQ_API_KEY))
    },
    {
      key: 'HUGGINGFACE_INFERENCE_API_TOKEN',
      isPresent: Boolean(firstNonEmpty(env.HUGGINGFACE_INFERENCE_API_TOKEN)),
      run: () => verifyHuggingFaceKey(firstNonEmpty(env.HUGGINGFACE_INFERENCE_API_TOKEN))
    },
    {
      key: 'COHERE_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.COHERE_API_KEY)),
      run: () => verifyCohereKey(firstNonEmpty(env.COHERE_API_KEY))
    },
    {
      key: 'FIRECRAWL_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.FIRECRAWL_API_KEY)),
      run: () => verifyFirecrawlKey(firstNonEmpty(env.FIRECRAWL_API_KEY))
    },
    {
      key: 'JINA_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.JINA_API_KEY)),
      run: () => verifyJinaKey(firstNonEmpty(env.JINA_API_KEY))
    },
    {
      key: 'DRIFTBOT_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.DRIFTBOT_API_KEY, env.DIFFBOT_API_KEY)),
      run: () => verifyDriftbotKey(firstNonEmpty(env.DRIFTBOT_API_KEY, env.DIFFBOT_API_KEY))
    },
    {
      key: 'LLAMA_CLOUD_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.LLAMA_CLOUD_API_KEY, env.LLAMAPARSE_API_KEY)),
      run: () => verifyLlamaCloudKey(firstNonEmpty(env.LLAMA_CLOUD_API_KEY, env.LLAMAPARSE_API_KEY))
    },
    {
      key: 'UNSTRUCTURED_API_KEY',
      isPresent: Boolean(firstNonEmpty(env.UNSTRUCTURED_API_KEY)),
      run: () => verifyUnstructuredKey(firstNonEmpty(env.UNSTRUCTURED_API_KEY))
    },
    {
      key: 'CLOUDFLARE_WORKERS_AI_TOKEN',
      isPresent: Boolean(accountId && workersAiToken),
      run: () => verifyCloudflareWorkersAiToken(accountId, workersAiToken)
    },
    {
      key: 'CLOUDFLARE_ACCOUNT_API_TOKEN',
      isPresent: Boolean(accountId && firstNonEmpty(env.CLOUDFLARE_ACCOUNT_API_TOKEN)),
      run: () => verifyCloudflareAccountToken(accountId, firstNonEmpty(env.CLOUDFLARE_ACCOUNT_API_TOKEN))
    }
  ];

  const rows = [];
  for (const c of checks) {
    if (!c.isPresent) {
      rows.push({ key: c.key, status: 'MISSING', details: 'not provided' });
      continue;
    }
    try {
      await c.run();
      rows.push({ key: c.key, status: 'OK', details: '' });
    } catch (error) {
      rows.push({ key: c.key, status: 'FAIL', details: String(error?.message || error).slice(0, 260) });
    }
  }

  console.log('[predeploy] vendor credential preflight report');
  rows.forEach((r) => {
    const details = r.details ? ` :: ${r.details}` : '';
    console.log(`- [${r.status}] ${r.key}${details}`);
  });

  const bad = rows.filter((r) => r.status !== 'OK');
  if (bad.length) {
    const missing = bad.filter((r) => r.status === 'MISSING').map((r) => r.key);
    const failing = bad.filter((r) => r.status === 'FAIL').map((r) => `${r.key}: ${r.details}`);
    const lines = [];
    if (missing.length) lines.push(`missing: ${missing.join(', ')}`);
    if (failing.length) lines.push(`failing: ${failing.join(' | ')}`);
    throw new Error(`Vendor credential preflight failed (${bad.length} issue(s)): ${lines.join(' ; ')}`);
  }
}

function validateCloudflareTokenRoles(env = process.env) {
  const accountId = firstNonEmpty(env.CLOUDFLARE_ACCOUNT_ID);
  const workersAiToken = firstNonEmpty(env.CLOUDFLARE_WORKERS_AI_TOKEN);
  const accountApiToken = firstNonEmpty(env.CLOUDFLARE_ACCOUNT_API_TOKEN);
  const legacyApiToken = firstNonEmpty(env.CLOUDFLARE_API_TOKEN);
  const anyCloudflareSet = Boolean(accountId || workersAiToken || accountApiToken || legacyApiToken);
  const issues = [];

  if (!anyCloudflareSet) {
    return {
      enabled: false,
      accountId: '',
      workersAiToken: '',
      accountApiToken: '',
      issues
    };
  }

  if (!accountId) issues.push('Missing CLOUDFLARE_ACCOUNT_ID.');
  if (!workersAiToken) issues.push('Missing CLOUDFLARE_WORKERS_AI_TOKEN (Workers AI provider token).');
  if (!accountApiToken) issues.push('Missing CLOUDFLARE_ACCOUNT_API_TOKEN (Cloudflare account token for R2 API).');

  if (legacyApiToken && workersAiToken && legacyApiToken !== workersAiToken) {
    issues.push('CLOUDFLARE_API_TOKEN must match CLOUDFLARE_WORKERS_AI_TOKEN when set.');
  }
  if (legacyApiToken && accountApiToken && legacyApiToken === accountApiToken) {
    issues.push('CLOUDFLARE_API_TOKEN looks like the account token; it must represent Workers AI token only.');
  }

  return {
    enabled: true,
    accountId,
    workersAiToken,
    accountApiToken,
    issues
  };
}

async function fetchJson(url, options = {}, label = 'request') {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const details = errors.map((e) => `${e.code}:${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`${label} failed: ${details}`);
  }
  return json;
}

async function verifyCloudflareWorkersAiToken(accountId, workersAiToken) {
  const model = '@cf/meta/llama-3.1-8b-instruct';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  await fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workersAiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt: 'ping' })
  }, 'Cloudflare Workers AI token check');
}

async function verifyCloudflareAccountToken(accountId, accountApiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
  await fetchJson(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accountApiToken}`,
      'Content-Type': 'application/json'
    }
  }, 'Cloudflare account API token check');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  loadEnvFiles([
    path.join(repoRoot, '.env.all'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, '.crawler'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'telegram/.env'),
    path.join(repoRoot, 'telegram/.crawler')
  ]);

  // Fill Cloudflare account token from local yaml fallback when env is missing.
  const cfYaml = readCloudflareYaml(repoRoot);
  const cfTokens = (cfYaml && cfYaml.api_tokens) || {};
  const accountTokenCandidates = [
    String(process.env.CLOUDFLARE_ACCOUNT_API_TOKEN || '').trim(),
    String(cfTokens.account_api_token || '').trim(),
    String(cfTokens.r2_account_token || '').trim(),
    String(cfTokens.account_token || '').trim(),
    String(cfTokens.r2_token || '').trim(),
    String(cfTokens.env_e2e_token || '').trim(),
    String(cfTokens.additional_token_1 || '').trim(),
    String(cfTokens.additional_token_2 || '').trim()
  ].map((v) => String(v || '').trim()).filter(Boolean);
  if (!String(process.env.CLOUDFLARE_WORKERS_AI_TOKEN || '').trim()) {
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = firstNonEmpty(
      cfTokens.workers_ai_token,
      cfTokens.ai_workers_token,
      cfTokens.providers_ai_token
    );
  }
  if (!String(process.env.CLOUDFLARE_ACCOUNT_API_TOKEN || '').trim()) {
    process.env.CLOUDFLARE_ACCOUNT_API_TOKEN = accountTokenCandidates[0] || '';
  }
  // Legacy role alias: CLOUDFLARE_API_TOKEN is treated as Workers AI token.
  // If local env accidentally points it to account token, repair it from dedicated workers token.
  const legacyApiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const workersAiToken = String(process.env.CLOUDFLARE_WORKERS_AI_TOKEN || '').trim();
  const accountApiToken = String(process.env.CLOUDFLARE_ACCOUNT_API_TOKEN || '').trim();
  if (workersAiToken && (!legacyApiToken || legacyApiToken === accountApiToken)) {
    process.env.CLOUDFLARE_API_TOKEN = workersAiToken;
  }

  const tokenRoles = validateCloudflareTokenRoles(process.env);
  if (tokenRoles.issues.length) {
    throw new Error(`Cloudflare token role validation failed:\n- ${tokenRoles.issues.join('\n- ')}`);
  }
  if (!tokenRoles.enabled) {
    console.log('[predeploy] cloudflare token-role check skipped (no Cloudflare vars set)');
  } else {
    console.log('[predeploy] cloudflare token-role mapping OK');
    const skipAuth = parseBool(process.env.RENDER_SKIP_PROVIDER_AUTH_CHECK);
    if (skipAuth) {
      console.log('[predeploy] cloudflare live auth probes skipped (RENDER_SKIP_PROVIDER_AUTH_CHECK=true)');
    } else {
      await verifyCloudflareWorkersAiToken(tokenRoles.accountId, tokenRoles.workersAiToken);
      console.log('[predeploy] cloudflare workers AI token probe OK');
      const dedupAccountCandidates = [...new Set([
        String(tokenRoles.accountApiToken || '').trim(),
        ...accountTokenCandidates
      ].filter(Boolean))];
      let accountProbeOk = false;
      let accountProbeErr = null;
      for (const candidate of dedupAccountCandidates) {
        try {
          await verifyCloudflareAccountToken(tokenRoles.accountId, candidate);
          process.env.CLOUDFLARE_ACCOUNT_API_TOKEN = candidate;
          accountProbeOk = true;
          break;
        } catch (error) {
          accountProbeErr = error;
        }
      }
      if (!accountProbeOk) throw accountProbeErr || new Error('Cloudflare account API token check failed');
      console.log('[predeploy] cloudflare account API token probe OK');
    }
  }

  await runVendorCredentialPreflight(process.env);

  const skipTests = parseBool(process.env.PREDEPLOY_SKIP_TESTS);
  if (!skipTests) {
    run('npm run test:telegram');
  } else {
    console.log('[predeploy] test suite skipped (PREDEPLOY_SKIP_TESTS=true)');
  }

  const runReal = String(process.env.RUN_RENDER_REAL_GEMINI || '') === '1';
  if (runReal) {
    run('npm run test:telegram:gemini-real');
  }

  console.log('[predeploy] render test checks passed');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[predeploy] failed:', error && error.message ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  validateCloudflareTokenRoles,
  runVendorCredentialPreflight
};
