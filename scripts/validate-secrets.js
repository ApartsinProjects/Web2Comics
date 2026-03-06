#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const PROFILES = {
  deploy: {
    workflow: '.github/workflows/bot-deploy.yml',
    required: [
      'RENDER_API_KEY',
      'RENDER_OWNER_ID',
      'RENDER_REGION',
      'RENDER_PLAN',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'TELEGRAM_NOTIFY_CHAT_ID',
      'TELEGRAM_TEST_CHAT_ID',
      'TELEGRAM_ADMIN_CHAT_IDS',
      'COMICBOT_ALLOWED_CHAT_IDS',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'GROQ_API_KEY',
      'HUGGINGFACE_INFERENCE_API_TOKEN',
      'COHERE_API_KEY',
      'FIRECRAWL_API_KEY',
      'JINA_API_KEY',
      'DRIFTBOT_API_KEY',
      'LLAMA_CLOUD_API_KEY',
      'UNSTRUCTURED_API_KEY',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_WORKERS_AI_TOKEN',
      'CLOUDFLARE_ACCOUNT_API_TOKEN',
      'R2_S3_ENDPOINT',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY'
    ]
  },
  tests: {
    workflow: '.github/workflows/bot-tests.yml',
    required: [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'TELEGRAM_NOTIFY_CHAT_ID',
      'TELEGRAM_ADMIN_CHAT_IDS',
      'COMICBOT_ALLOWED_CHAT_IDS',
      'TELEGRAM_TEST_CHAT_ID',
      'RENDER_PUBLIC_BASE_URL',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'GROQ_API_KEY',
      'HUGGINGFACE_INFERENCE_API_TOKEN',
      'COHERE_API_KEY',
      'FIRECRAWL_API_KEY',
      'JINA_API_KEY',
      'DRIFTBOT_API_KEY',
      'LLAMA_CLOUD_API_KEY',
      'UNSTRUCTURED_API_KEY',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_WORKERS_AI_TOKEN',
      'CLOUDFLARE_ACCOUNT_API_TOKEN',
      'CLOUDFLARE_WORKER_URL',
      'R2_S3_ENDPOINT',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY'
    ]
  }
};

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function extractSecretRefs(workflowText) {
  const refs = new Set();
  const re = /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(workflowText)) !== null) refs.add(String(m[1] || '').trim());
  return refs;
}

function missingFromSet(requiredList, valuesSet) {
  return requiredList.filter((name) => !valuesSet.has(name));
}

function getRepoSlug() {
  const envRepo = String(process.env.GITHUB_REPOSITORY || '').trim();
  if (envRepo && envRepo.includes('/')) return envRepo;
  try {
    const remote = String(execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
    const httpsMatch = remote.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
    if (httpsMatch && httpsMatch[1]) return httpsMatch[1];
  } catch (_) {}
  return '';
}

async function listRepoSecrets(repoSlug, token) {
  const names = new Set();
  let page = 1;
  while (page <= 10) {
    const url = `https://api.github.com/repos/${repoSlug}/actions/secrets?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web2comics-secret-validator'
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 280)}`);
    }
    const json = await res.json();
    const secrets = Array.isArray(json?.secrets) ? json.secrets : [];
    secrets.forEach((s) => {
      if (s && s.name) names.add(String(s.name));
    });
    if (secrets.length < 100) break;
    page += 1;
  }
  return names;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profileName = String(args.profile || 'deploy').trim().toLowerCase();
  const profile = PROFILES[profileName];
  if (!profile) {
    const keys = Object.keys(PROFILES).join(', ');
    throw new Error(`Unknown profile '${profileName}'. Allowed: ${keys}`);
  }

  const workflowPath = String(args.workflow || profile.workflow);
  const requireEnv = asBool(args['require-env'], false);
  const checkGithub = asBool(args['check-github'], false);

  const workflowText = readText(workflowPath);
  const workflowSecretRefs = extractSecretRefs(workflowText);
  const missingInWorkflow = missingFromSet(profile.required, workflowSecretRefs);

  const missingInEnv = requireEnv
    ? profile.required.filter((name) => !String(process.env[name] || '').trim())
    : [];

  let githubMissing = [];
  let githubChecked = false;
  let githubSkippedReason = '';
  if (checkGithub) {
    const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
    const repoSlug = getRepoSlug();
    if (!token) {
      githubSkippedReason = 'missing GITHUB_TOKEN/GH_TOKEN';
    } else if (!repoSlug) {
      githubSkippedReason = 'could not resolve repository slug';
    } else {
      githubChecked = true;
      const repoSecrets = await listRepoSecrets(repoSlug, token);
      githubMissing = missingFromSet(profile.required, repoSecrets);
    }
  }

  console.log(`[secrets] profile=${profileName}`);
  console.log(`[secrets] workflow=${workflowPath}`);
  console.log(`[secrets] required=${profile.required.length}`);
  if (!missingInWorkflow.length) {
    console.log('[secrets] workflow references: OK');
  } else {
    console.error(`[secrets] workflow references: missing ${missingInWorkflow.length}`);
    missingInWorkflow.forEach((name) => console.error(`  - ${name}`));
  }

  if (requireEnv) {
    if (!missingInEnv.length) {
      console.log('[secrets] runtime env values: OK');
    } else {
      console.error(`[secrets] runtime env values: missing ${missingInEnv.length}`);
      missingInEnv.forEach((name) => console.error(`  - ${name}`));
    }
  } else {
    console.log('[secrets] runtime env values: skipped');
  }

  if (checkGithub) {
    if (!githubChecked) {
      console.log(`[secrets] GitHub repo secrets: skipped (${githubSkippedReason})`);
    } else if (!githubMissing.length) {
      console.log('[secrets] GitHub repo secrets: OK');
    } else {
      console.error(`[secrets] GitHub repo secrets: missing ${githubMissing.length}`);
      githubMissing.forEach((name) => console.error(`  - ${name}`));
    }
  } else {
    console.log('[secrets] GitHub repo secrets: skipped');
  }

  const hasFailures = missingInWorkflow.length > 0
    || missingInEnv.length > 0
    || (githubChecked && githubMissing.length > 0);
  if (hasFailures) {
    process.exitCode = 2;
    return;
  }
  console.log('[secrets] validation passed');
}

main().catch((error) => {
  console.error(`[secrets] validation failed: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
