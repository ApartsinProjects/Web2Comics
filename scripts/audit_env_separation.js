#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readYamlSafe(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function run(cmd) {
  try {
    return String(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch (_) {
    return '';
  }
}

function parseSecretList(raw) {
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean).map((line) => line.split(/\s+/)[0]);
}

function pickExistingFile(repoRoot, names) {
  for (const name of names) {
    const p = path.join(repoRoot, name);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function maskTokenFingerprint(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 10);
}

async function getWebhookInfo(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getWebhookInfo`);
    const json = await res.json();
    if (!res.ok || !json || !json.ok) return null;
    return json.result || null;
  } catch (_) {
    return null;
  }
}

function compare(label, a, b) {
  const av = String(a || '').trim();
  const bv = String(b || '').trim();
  if (!av || !bv) return `${label}: unknown (missing value)`;
  return `${label}: ${av === bv ? 'COLLISION' : 'separate'}`;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const workflowPath = path.join(repoRoot, '.github/workflows/bot-deploy.yml');
  const workflow = readYamlSafe(workflowPath) || {};
  const wd = (workflow.on && workflow.on.workflow_dispatch && workflow.on.workflow_dispatch.inputs) || {};
  const testDeploymentDefault = wd.test_deployment && wd.test_deployment.default;

  const stagingSecrets = parseSecretList(run('gh secret list --env staging --repo ApartsinProjects/Web2Comics'));
  const productionSecrets = parseSecretList(run('gh secret list --env production --repo ApartsinProjects/Web2Comics'));

  const stMetaPath = pickExistingFile(repoRoot, [
    'telegram/out/deploy-render-metadata.staging.json',
    'telegram/out/deploy-render-metadata.stage.json',
    'telegram/out/deploy-render-metadata-stage.json'
  ]);
  const prMetaPath = pickExistingFile(repoRoot, [
    'telegram/out/deploy-render-metadata.production.json',
    'telegram/out/deploy-render-metadata.json'
  ]);
  const stMeta = stMetaPath ? (readJsonSafe(stMetaPath) || {}) : {};
  const prMeta = prMetaPath ? (readJsonSafe(prMetaPath) || {}) : {};

  const stagingToken = String(process.env.STAGING_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_STAGING || '').trim();
  const productionToken = String(process.env.PRODUCTION_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_PRODUCTION || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const stWebhook = await getWebhookInfo(stagingToken);
  const prWebhook = await getWebhookInfo(productionToken);

  const stNotify = String(process.env.STAGING_NOTIFY_CHAT_ID || stMeta.notifyChatId || '').trim();
  const stTest = String(process.env.STAGING_TEST_CHAT_ID || stMeta.telegramTestChatId || '').trim();
  const prNotify = String(process.env.PRODUCTION_NOTIFY_CHAT_ID || prMeta.notifyChatId || '').trim();
  const prTest = String(process.env.PRODUCTION_TEST_CHAT_ID || prMeta.telegramTestChatId || '').trim();

  console.log('=== Web2Comics Env Separation Audit ===');
  console.log(`Workflow file: ${workflowPath}`);
  console.log(`Workflow input default test_deployment: ${String(testDeploymentDefault)}`);
  console.log(`Expected canonical staging service: web2comics-telegram-render-bot-stage`);
  console.log(`Expected canonical production service: web2comics-telegram-render-bot`);
  console.log('');

  console.log('Secrets presence:');
  console.log(`- staging has RENDER_SERVICE_NAME: ${stagingSecrets.includes('RENDER_SERVICE_NAME')}`);
  console.log(`- production has RENDER_SERVICE_NAME: ${productionSecrets.includes('RENDER_SERVICE_NAME')}`);
  console.log(`- staging has TELEGRAM_BOT_TOKEN: ${stagingSecrets.includes('TELEGRAM_BOT_TOKEN')}`);
  console.log(`- production has TELEGRAM_BOT_TOKEN: ${productionSecrets.includes('TELEGRAM_BOT_TOKEN')}`);
  console.log('');

  console.log('Metadata snapshot:');
  console.log(`- staging metadata file: ${stMetaPath || '(none)'}`);
  console.log(`  serviceName=${String(stMeta.serviceName || '') || '-'}`);
  console.log(`  publicUrl=${String(stMeta.publicUrl || '') || '-'}`);
  console.log(`  webhookUrl=${String(stMeta.webhookUrl || '') || '-'}`);
  console.log(`- production metadata file: ${prMetaPath || '(none)'}`);
  console.log(`  serviceName=${String(prMeta.serviceName || '') || '-'}`);
  console.log(`  publicUrl=${String(prMeta.publicUrl || '') || '-'}`);
  console.log(`  webhookUrl=${String(prMeta.webhookUrl || '') || '-'}`);
  console.log('');

  console.log('Live Telegram webhook:');
  console.log(`- staging token fingerprint: ${maskTokenFingerprint(stagingToken) || '(missing token in env)'}`);
  console.log(`  url=${String(stWebhook && stWebhook.url || '') || '(unavailable)'}`);
  console.log(`- production token fingerprint: ${maskTokenFingerprint(productionToken) || '(missing token in env)'}`);
  console.log(`  url=${String(prWebhook && prWebhook.url || '') || '(unavailable)'}`);
  console.log('');

  console.log('Separation checks:');
  console.log(`- ${compare('serviceName', stMeta.serviceName, prMeta.serviceName)}`);
  console.log(`- ${compare('publicUrl', stMeta.publicUrl || (stWebhook && stWebhook.url), prMeta.publicUrl || (prWebhook && prWebhook.url))}`);
  console.log(`- ${compare('notifyChatId', stNotify, prNotify)}`);
  console.log(`- ${compare('testChatId', stTest, prTest)}`);
  const tfA = maskTokenFingerprint(stagingToken);
  const tfB = maskTokenFingerprint(productionToken);
  if (tfA && tfB) {
    console.log(`- token fingerprint: ${tfA === tfB ? 'COLLISION' : 'separate'}`);
  } else {
    console.log('- token fingerprint: unknown (missing staging/prod token in local env)');
  }
}

main().catch((error) => {
  console.error(`[audit_env_separation] failed: ${String(error && error.message ? error.message : error)}`);
  process.exit(1);
});

