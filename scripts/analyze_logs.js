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

function safeDate(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function walkJsonFiles(rootDir) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (name.endsWith('.json') && name !== 'status.json' && name !== 'summary.json' && name !== 'latest.json') {
        out.push(p);
      }
    }
  }
  walk(rootDir);
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function short(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function deriveRootCauseFromRequestError(errorText) {
  const e = String(errorText || '');
  if (/chat_not_allowed/i.test(e)) return 'Bot access policy denied the chat (allowlist / allowed chat IDs).';
  if (/unrecognized_command/i.test(e)) return 'Command parser did not recognize the slash command.';
  if (/Gemini image failed \(429\)/i.test(e) || /rate-limits/i.test(e) || /quota/i.test(e)) {
    return 'Provider quota/rate-limit exhausted for Gemini image generation.';
  }
  if (/inline image bytes/i.test(e)) return 'Gemini image response did not contain inline image bytes (provider response format inconsistency).';
  if (/Authentication error/i.test(e)) return 'Provider authentication failed (invalid/expired token or wrong token role).';
  return 'See error message; no stronger signature matched.';
}

function formatFileRef(filePath, cwd) {
  return path.relative(cwd, filePath).replace(/\//g, path.sep);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const baseDir = path.resolve(args.dir || path.join(cwd, 'telegram/out/fetched-logs'));
  const requestsDir = path.join(baseDir, 'requests');
  const crashDir = path.join(baseDir, 'crash');

  const requestFiles = walkJsonFiles(requestsDir);
  const crashFiles = walkJsonFiles(crashDir);

  const requestRows = requestFiles
    .map((filePath) => ({ filePath, data: readJson(filePath) }))
    .filter((r) => r.data)
    .sort((a, b) => safeDate(b.data.timestamp || b.data.createdAt) - safeDate(a.data.timestamp || a.data.createdAt));
  const crashRows = crashFiles
    .map((filePath) => ({ filePath, data: readJson(filePath) }))
    .filter((r) => r.data)
    .sort((a, b) => safeDate(b.data.timestamp || b.data.createdAt) - safeDate(a.data.timestamp || a.data.createdAt));

  const failedRequests = requestRows.filter((r) => r.data && r.data.result && r.data.result.ok === false);
  const latestCrash = crashRows[0] || null;
  const latestFailedRequest = failedRequests[0] || null;

  const result = {
    analyzedAt: new Date().toISOString(),
    baseDir,
    counts: {
      requests: requestRows.length,
      failedRequests: failedRequests.length,
      crashLogs: crashRows.length
    },
    lastFailure: null
  };

  if (latestCrash) {
    const d = latestCrash.data;
    const message = String(d?.error?.message || d?.message || '');
    result.lastFailure = {
      source: 'crash-log',
      timestamp: d.timestamp || d.createdAt || '',
      event: d.event || 'unknown',
      error: short(message),
      rootCause: deriveRootCauseFromRequestError(message),
      file: formatFileRef(latestCrash.filePath, cwd)
    };
  } else if (latestFailedRequest) {
    const d = latestFailedRequest.data;
    const e = String(d?.result?.error || '');
    result.lastFailure = {
      source: 'request-log',
      timestamp: d.timestamp || d.createdAt || '',
      type: d?.result?.type || '',
      chatId: Number(d?.chatId || 0),
      error: short(e),
      rootCause: deriveRootCauseFromRequestError(e),
      file: formatFileRef(latestFailedRequest.filePath, cwd),
      note: 'No crash-log entries were found; using latest failed request instead.'
    };
  }

  if (String(args.json || '').toLowerCase() === 'true') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Log analysis summary');
  console.log(`- base: ${result.baseDir}`);
  console.log(`- requests: ${result.counts.requests}`);
  console.log(`- failed requests: ${result.counts.failedRequests}`);
  console.log(`- crash logs: ${result.counts.crashLogs}`);
  if (!result.lastFailure) {
    console.log('- last failure: none');
    return;
  }
  console.log('- last failure:');
  console.log(`  source: ${result.lastFailure.source}`);
  console.log(`  timestamp: ${result.lastFailure.timestamp}`);
  if (result.lastFailure.event) console.log(`  event: ${result.lastFailure.event}`);
  if (result.lastFailure.type) console.log(`  type: ${result.lastFailure.type}`);
  if (result.lastFailure.chatId) console.log(`  chatId: ${result.lastFailure.chatId}`);
  console.log(`  error: ${result.lastFailure.error}`);
  console.log(`  root cause: ${result.lastFailure.rootCause}`);
  if (result.lastFailure.note) console.log(`  note: ${result.lastFailure.note}`);
  console.log(`  file: ${result.lastFailure.file}`);
}

main();

