const { R2CrashLogStore } = require('../src/crash-log-store');
const { fetchLatestCrashLogFromR2Env, getR2CrashConfigFromEnv } = require('./helpers/r2-crash-log-interface');

const runRealR2 = String(process.env.RUN_R2_E2E || '').toLowerCase() === 'true';

describe('r2 crash log real e2e', () => {
  const cfg = getR2CrashConfigFromEnv();
  const shouldRun = runRealR2 && !!cfg;

  (shouldRun ? it : it.skip)('writes crash log to R2 and fetches latest directly', async () => {
    const marker = `r2-e2e-${Date.now()}`;
    const prefix = `${cfg.prefix}/tests-${Date.now()}`;
    const store = new R2CrashLogStore({
      endpoint: cfg.endpoint,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      prefix
    });

    await store.appendCrash({
      event: 'r2-e2e',
      error: { message: marker },
      context: { suite: 'telegram/tests/r2-crash-log.e2e.test.js' }
    });

    const latest = await fetchLatestCrashLogFromR2Env({
      endpoint: cfg.endpoint,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      prefix
    });

    expect(latest).toBeTruthy();
    expect(latest.event).toBe('r2-e2e');
    expect(String(latest.error && latest.error.message || '')).toContain(marker);
  }, 60000);
});

