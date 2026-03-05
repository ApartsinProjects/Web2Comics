const path = require('path');
const fs = require('fs');
const { loadEnvFiles } = require('./env');

const REPO_ROOT = path.resolve(__dirname, '../..');
const BOT_ROOT = path.resolve(__dirname, '..');

loadEnvFiles([
  path.join(BOT_ROOT, '.env'),
  path.join(REPO_ROOT, '.env.e2e.local'),
  path.join(REPO_ROOT, '.env.local')
]);

function parseAllowedChatIds(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getRuntimeConfig() {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const configPath = path.resolve(process.env.COMICBOT_ENGINE_CONFIG || path.join(BOT_ROOT, 'config/default.bot.yml'));
  if (!fs.existsSync(configPath)) {
    throw new Error(`Engine config not found: ${configPath}`);
  }

  return {
    repoRoot: REPO_ROOT,
    botRoot: BOT_ROOT,
    outDir: path.resolve(process.env.COMICBOT_OUT_DIR || path.join(BOT_ROOT, 'out')),
    botToken: token,
    engineConfigPath: configPath,
    allowedChatIds: parseAllowedChatIds(process.env.COMICBOT_ALLOWED_CHAT_IDS || ''),
    pollTimeoutSec: Math.max(5, Number(process.env.COMICBOT_POLL_TIMEOUT_SEC || 25)),
    pollIntervalMs: Math.max(200, Number(process.env.COMICBOT_POLL_INTERVAL_MS || 1200)),
    fetchTimeoutMs: Math.max(5000, Number(process.env.COMICBOT_FETCH_TIMEOUT_MS || 45000)),
    titlePrefix: String(process.env.COMICBOT_TITLE_PREFIX || 'Telegram Comic').trim(),
    debugArtifacts: String(process.env.COMICBOT_DEBUG_ARTIFACTS || '').toLowerCase() === 'true'
  };
}

module.exports = {
  getRuntimeConfig
};
