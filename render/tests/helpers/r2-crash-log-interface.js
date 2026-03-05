const { fetchLatestCrashLogFromR2 } = require('../../src/crash-log-store');

function getR2CrashConfigFromEnv() {
  const endpoint = String(process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const prefix = String(process.env.R2_CRASH_LOG_PREFIX || 'crash-logs').trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, prefix };
}

async function fetchLatestCrashLogFromR2Env(overrides = {}) {
  const cfg = getR2CrashConfigFromEnv();
  if (!cfg) return null;
  return fetchLatestCrashLogFromR2({ ...cfg, ...(overrides || {}) });
}

module.exports = {
  getR2CrashConfigFromEnv,
  fetchLatestCrashLogFromR2Env
};
