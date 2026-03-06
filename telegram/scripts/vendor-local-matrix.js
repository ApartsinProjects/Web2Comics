#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { loadEnvFiles } = require('../src/env');
const { readCloudflareYaml } = require('./lib');
const { fetchUrlToHtmlSnapshot } = require('../../engine/src/url-fetch');
const { extractFromHtml } = require('../../engine/src/input');

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

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

function classifyFailure(note) {
  const n = String(note || '').toLowerCase();
  if (!n) return 'unknown';
  if (n.includes('http 403') || n.includes('paywall') || n.includes('forbidden')) return 'access_restricted';
  if (n.includes('http 429') || n.includes('rate limit') || n.includes('quota')) return 'rate_or_quota';
  if (n.includes('timeout') || n.includes('aborted')) return 'timeout';
  if (n.includes('http 400')) return 'request_rejected';
  if (n.includes('empty')) return 'empty_content';
  return 'provider_or_network';
}

async function fetchTextWithTimeout(url, init, timeoutMs, label) {
  const ms = Math.max(1000, Number(timeoutMs || 45000));
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

async function runUrlExtractorChecks(options = {}) {
  const sites = Array.isArray(options.sites) && options.sites.length
    ? options.sites
    : ['https://www.bbc.com/news', 'https://www.cnn.com', 'https://www.ynet.co.il'];
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 45000));
  const outDir = path.resolve(options.outDir || path.join(process.cwd(), 'telegram/out/vendor-matrix'));
  fs.mkdirSync(outDir, { recursive: true });

  async function checkGemini(url) {
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'GEMINI_API_KEY' };
    const model = 'gemini-3-flash-preview';
    const prompt = `Use URL context tool and extract the main story in plain text.\nURL: ${url}`;
    const { res, text } = await fetchTextWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ url_context: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
        })
      },
      timeoutMs,
      'gemini url extractor'
    );
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    let parsed = {};
    try { parsed = JSON.parse(text || '{}'); } catch (_) {}
    const parts = parsed?.candidates?.[0]?.content?.parts || [];
    const extracted = parts.map((p) => String(p?.text || '')).filter(Boolean).join('\n').trim();
    return { status: extracted ? 'OK' : 'FAIL', chars: extracted.length, note: extracted ? '' : 'empty' };
  }

  async function checkFirecrawl(url) {
    const key = String(process.env.FIRECRAWL_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'FIRECRAWL_API_KEY' };
    const { res, text } = await fetchTextWithTimeout('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true })
    }, timeoutMs, 'firecrawl extractor');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    let parsed = {};
    try { parsed = JSON.parse(text || '{}'); } catch (_) {}
    const extracted = String(parsed?.data?.markdown || parsed?.data?.content || parsed?.data?.text || '').trim();
    return { status: extracted ? 'OK' : 'FAIL', chars: extracted.length, note: extracted ? '' : 'empty' };
  }

  async function checkJina(url) {
    const key = String(process.env.JINA_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'JINA_API_KEY' };
    const { res, text } = await fetchTextWithTimeout(`https://r.jina.ai/${url}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'text/plain', 'X-No-Cache': 'true' }
    }, timeoutMs, 'jina extractor');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    const extracted = String(text || '').trim();
    return { status: extracted ? 'OK' : 'FAIL', chars: extracted.length, note: extracted ? '' : 'empty' };
  }

  async function checkDriftbot(url) {
    const key = String(process.env.DRIFTBOT_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'DRIFTBOT_API_KEY' };
    const endpoint = `https://api.diffbot.com/v3/article?token=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}&discussion=false`;
    const { res, text } = await fetchTextWithTimeout(endpoint, { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs, 'driftbot extractor');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    let parsed = {};
    try { parsed = JSON.parse(text || '{}'); } catch (_) {}
    const obj = (Array.isArray(parsed?.objects) ? parsed.objects[0] : parsed?.objects) || {};
    const extracted = String(obj?.text || obj?.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { status: extracted ? 'OK' : 'FAIL', chars: extracted.length, note: extracted ? '' : 'empty' };
  }

  async function checkChromium(url) {
    const filePath = path.join(outDir, `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
    const snap = await fetchUrlToHtmlSnapshot(url, filePath, { timeoutMs, waitUntil: 'domcontentloaded' });
    const html = fs.readFileSync(snap.snapshotPath, 'utf8');
    const extracted = extractFromHtml(html, {});
    const text = String(extracted?.text || '').trim();
    return { status: text ? 'OK' : 'FAIL', chars: text.length, note: text ? '' : 'empty' };
  }

  const providers = {
    gemini: checkGemini,
    firecrawl: checkFirecrawl,
    jina: checkJina,
    driftbot: checkDriftbot,
    chromium: checkChromium
  };

  const rows = [];
  for (const site of sites) {
    for (const [name, fn] of Object.entries(providers)) {
      try {
        const result = await fn(site);
        rows.push({ kind: 'url_extraction', provider: name, input: site, ...result });
      } catch (error) {
        rows.push({ kind: 'url_extraction', provider: name, input: site, status: 'FAIL', chars: 0, note: String(error?.message || error).slice(0, 220) });
      }
    }
  }
  return rows;
}

async function runShortQueryChecks(options = {}) {
  const queries = Array.isArray(options.queries) && options.queries.length
    ? options.queries
    : ['Tokyo 2100', 'Napoleon in space', 'Atlantis detective story'];
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 45000));

  async function checkWikipedia(query) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&utf8=1&origin=*`;
    const { res, text } = await fetchTextWithTimeout(url, { method: 'GET' }, timeoutMs, 'wikipedia enrichment');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    let parsed = {};
    try { parsed = JSON.parse(text || '{}'); } catch (_) {}
    const rows = Array.isArray(parsed?.query?.search) ? parsed.query.search : [];
    const payload = rows.map((r) => String(r?.title || '').trim()).filter(Boolean).join(', ');
    return { status: payload ? 'OK' : 'FAIL', chars: payload.length, note: payload ? '' : 'empty' };
  }

  async function checkGemini(query) {
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'GEMINI_API_KEY' };
    const model = 'gemini-2.5-flash';
    const { res, text } = await fetchTextWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Give 3 short factual bullets for: ${query}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 }
        })
      },
      timeoutMs,
      'gemini enrichment'
    );
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    return { status: String(text || '').trim() ? 'OK' : 'FAIL', chars: String(text || '').length, note: '' };
  }

  async function checkFirecrawl(query) {
    const key = String(process.env.FIRECRAWL_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'FIRECRAWL_API_KEY' };
    const { res, text } = await fetchTextWithTimeout('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 3 })
    }, timeoutMs, 'firecrawl enrichment');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    return { status: String(text || '').trim() ? 'OK' : 'FAIL', chars: String(text || '').length, note: '' };
  }

  async function checkJina(query) {
    const key = String(process.env.JINA_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'JINA_API_KEY' };
    const { res, text } = await fetchTextWithTimeout(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'text/plain' }
    }, timeoutMs, 'jina enrichment');
    if (!res.ok) return { status: 'FAIL', chars: 0, note: `HTTP ${res.status}` };
    return { status: String(text || '').trim() ? 'OK' : 'FAIL', chars: String(text || '').length, note: '' };
  }

  async function checkDriftbot(query) {
    const key = String(process.env.DRIFTBOT_API_KEY || '').trim();
    if (!key) return { status: 'MISSING_KEY', chars: 0, note: 'DRIFTBOT_API_KEY' };
    const cleaned = String(query || '').replace(/"/g, '').trim();
    const primary = cleaned.split(/\s+/).filter(Boolean)[0] || cleaned;
    const attempts = [
      `strict:name:"${primary}"`,
      `name:"${primary}"`,
      `allDescriptions:"${cleaned}"`
    ];
    const errors = [];
    for (const dql of attempts) {
      const endpoint = `https://kg.diffbot.com/kg/v3/dql?token=${encodeURIComponent(key)}&query=${encodeURIComponent(dql)}&size=3`;
      const { res, text } = await fetchTextWithTimeout(endpoint, { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs, 'driftbot enrichment');
      if (!res.ok) {
        errors.push(`${res.status} for ${dql}`);
        continue;
      }
      let parsed = {};
      try { parsed = JSON.parse(text || '{}'); } catch (_) {}
      const rows = Array.isArray(parsed?.data) ? parsed.data : [];
      const payload = rows
        .map((r) => {
          const entity = r?.entity || r || {};
          const allDescriptions = Array.isArray(entity?.allDescriptions) ? entity.allDescriptions : [];
          return String(entity?.summary || entity?.description || allDescriptions[0] || entity?.name || r?.name || '').trim();
        })
        .filter(Boolean)
        .join('\n');
      if (payload) return { status: 'OK', chars: payload.length, note: '' };
      errors.push(`empty for ${dql}`);
    }
    return { status: 'FAIL', chars: 0, note: errors.join(' | ').slice(0, 220) };
  }

  const providers = {
    wikipedia: checkWikipedia,
    gemini: checkGemini,
    firecrawl: checkFirecrawl,
    jina: checkJina,
    driftbot: checkDriftbot
  };

  const rows = [];
  for (const query of queries) {
    for (const [name, fn] of Object.entries(providers)) {
      try {
        const result = await fn(query);
        rows.push({ kind: 'short_query_enrichment', provider: name, input: query, ...result });
      } catch (error) {
        rows.push({ kind: 'short_query_enrichment', provider: name, input: query, status: 'FAIL', chars: 0, note: String(error?.message || error).slice(0, 220) });
      }
    }
  }
  return rows;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const args = parseArgs(process.argv.slice(2));
  loadEnvFiles([
    path.join(repoRoot, '.env.all'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env.e2e.local'),
    path.join(repoRoot, '.crawler'),
    path.join(repoRoot, 'comicbot/.env'),
    path.join(repoRoot, 'telegram/.env'),
    path.join(repoRoot, 'telegram/.crawler')
  ]);
  const cfYaml = readCloudflareYaml(repoRoot);
  const cfTokens = (cfYaml && cfYaml.api_tokens) || {};
  if (!String(process.env.CLOUDFLARE_ACCOUNT_API_TOKEN || '').trim()) {
    process.env.CLOUDFLARE_ACCOUNT_API_TOKEN = firstNonEmpty(
      cfTokens.account_api_token,
      cfTokens.r2_account_token,
      cfTokens.account_token,
      cfTokens.r2_token,
      cfTokens.env_e2e_token,
      cfTokens.additional_token_1,
      cfTokens.additional_token_2
    );
  }

  const sites = String(args.sites || '').split(',').map((v) => String(v || '').trim()).filter(Boolean);
  const queries = String(args.queries || '').split(',').map((v) => String(v || '').trim()).filter(Boolean);
  const timeoutMs = Math.max(5000, Number(args['timeout-ms'] || 45000));

  const urlRows = await runUrlExtractorChecks({ sites, timeoutMs, outDir: path.join(repoRoot, 'telegram/out/vendor-matrix') });
  const queryRows = await runShortQueryChecks({ queries, timeoutMs });
  const rows = [...urlRows, ...queryRows];
  const byStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const hardFailures = [];
  const softFailures = [];
  const rowFails = rows.filter((r) => r.status === 'FAIL');

  const urlBySite = new Map();
  const queryBySeed = new Map();
  rows.forEach((r) => {
    if (r.kind === 'url_extraction') {
      if (!urlBySite.has(r.input)) urlBySite.set(r.input, []);
      urlBySite.get(r.input).push(r);
    } else if (r.kind === 'short_query_enrichment') {
      if (!queryBySeed.has(r.input)) queryBySeed.set(r.input, []);
      queryBySeed.get(r.input).push(r);
    }
  });
  for (const [site, siteRows] of urlBySite.entries()) {
    if (!siteRows.some((r) => r.status === 'OK')) {
      hardFailures.push(`URL extraction: no providers succeeded for ${site}`);
    }
  }
  for (const [seed, seedRows] of queryBySeed.entries()) {
    if (!seedRows.some((r) => r.status === 'OK')) {
      hardFailures.push(`Short-query enrichment: no providers succeeded for "${seed}"`);
    }
  }
  rowFails.forEach((r) => {
    const category = classifyFailure(r.note || '');
    softFailures.push(`${r.kind}/${r.provider}/${r.input}: ${r.note || 'failed'} [${category}]`);
  });

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    summary: byStatus,
    hardFailures,
    softFailures,
    rows
  }, null, 2));

  if (hardFailures.length) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[vendor-local-matrix] failed:', error && error.message ? error.message : String(error));
  process.exit(1);
});
