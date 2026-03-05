const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FileCrashLogStore,
  R2CrashLogStore,
  fetchLatestCrashLogFromR2
} = require('../src/crash-log-store');
const { fetchLatestCrashLogFromR2Env, getR2CrashConfigFromEnv } = require('./helpers/r2-crash-log-interface');

class MemoryAdapter {
  constructor() {
    this.objects = new Map();
  }

  async putObject(bucket, key, body) {
    this.objects.set(`${bucket}/${key}`, String(body));
  }

  async getObject(bucket, key) {
    return this.objects.get(`${bucket}/${key}`) || '';
  }

  async deleteObject(bucket, key) {
    this.objects.delete(`${bucket}/${key}`);
  }
}

describe('crash log store', () => {
  it('writes and reads latest crash log in file mode', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'render-crash-store-'));
    try {
      const logsDir = path.join(tmpRoot, 'logs');
      const latestPath = path.join(logsDir, 'latest.json');
      const store = new FileCrashLogStore({ logsDir, latestPath });
      await store.appendCrash({
        event: 'test-crash',
        error: { message: 'boom' }
      });
      const latest = await store.getLatestCrash();
      expect(latest).toBeTruthy();
      expect(latest.event).toBe('test-crash');
      expect(latest.error.message).toBe('boom');
      expect(typeof latest.createdAt).toBe('string');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('writes and reads latest crash log in R2 mode through adapter', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2CrashLogStore({
      bucket: 'test-bucket',
      prefix: 'crash-logs',
      adapter
    });
    await store.appendCrash({
      event: 'uncaughtException',
      error: { message: 'simulated failure' }
    });
    const latest = await store.getLatestCrash();
    expect(latest).toBeTruthy();
    expect(latest.event).toBe('uncaughtException');
    expect(latest.error.message).toContain('simulated');
  });

  it('updates R2 latest pointer to the newest crash object', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2CrashLogStore({
      bucket: 'pointer-bucket',
      prefix: 'crash-logs',
      adapter
    });

    await store.appendCrash({
      event: 'first',
      error: { message: 'first error' }
    });
    await new Promise((r) => setTimeout(r, 5));
    await store.appendCrash({
      event: 'second',
      error: { message: 'second error' }
    });

    const pointerRaw = await adapter.getObject('pointer-bucket', 'crash-logs/latest.json');
    const pointer = JSON.parse(pointerRaw);
    expect(String(pointer.key || '')).toContain('crash-logs/');

    const latestRaw = await adapter.getObject('pointer-bucket', pointer.key);
    const latest = JSON.parse(latestRaw);
    expect(latest.event).toBe('second');
    expect(latest.error.message).toContain('second');
  });

  it('exposes a fetchLatestCrashLogFromR2 interface for test suites', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2CrashLogStore({
      bucket: 'suite-bucket',
      prefix: 'suite-crashes',
      adapter
    });
    await store.appendCrash({
      event: 'startupFailure',
      error: { message: 'missing token' }
    });
    const latest = await fetchLatestCrashLogFromR2({
      bucket: 'suite-bucket',
      prefix: 'suite-crashes',
      adapter
    });
    expect(latest).toBeTruthy();
    expect(latest.event).toBe('startupFailure');
  });

  it('helper interface returns null when R2 env config is missing', async () => {
    const previous = {
      endpoint: process.env.R2_S3_ENDPOINT,
      bucket: process.env.R2_BUCKET,
      key: process.env.R2_ACCESS_KEY_ID,
      secret: process.env.R2_SECRET_ACCESS_KEY
    };
    delete process.env.R2_S3_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    try {
      expect(getR2CrashConfigFromEnv()).toBe(null);
      const latest = await fetchLatestCrashLogFromR2Env();
      expect(latest).toBe(null);
    } finally {
      if (previous.endpoint != null) process.env.R2_S3_ENDPOINT = previous.endpoint;
      if (previous.bucket != null) process.env.R2_BUCKET = previous.bucket;
      if (previous.key != null) process.env.R2_ACCESS_KEY_ID = previous.key;
      if (previous.secret != null) process.env.R2_SECRET_ACCESS_KEY = previous.secret;
    }
  });

  it('cleans historical crash logs when threshold is reached', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2CrashLogStore({
      bucket: 'cleanup-bucket',
      prefix: 'crash-logs',
      adapter,
      capacityBytes: 200,
      cleanupThresholdRatio: 0.5
    });

    await store.appendCrash({ event: 'first', error: { message: 'x'.repeat(120) } });
    await store.appendCrash({ event: 'second', error: { message: 'y'.repeat(120) } });

    const statusRaw = await adapter.getObject('cleanup-bucket', 'crash-logs/status.json');
    const status = JSON.parse(statusRaw);
    expect(status.totalBytes).toBeGreaterThan(0);
    expect(status.totalBytes).toBeLessThanOrEqual(status.thresholdBytes + 200);
    expect(status.logs.length).toBe(1);
    expect(status.logs[0].key).toContain('crash-logs/');
  });

  it('deletes crash logs older than retention days', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2CrashLogStore({
      bucket: 'ret-bucket',
      prefix: 'crash-logs',
      adapter,
      retentionDays: 1
    });
    const oldTs = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString();
    await adapter.putObject('ret-bucket', 'crash-logs/old.json', JSON.stringify({ event: 'old', createdAt: oldTs }));
    await adapter.putObject('ret-bucket', 'crash-logs/status.json', JSON.stringify({
      logs: [{ key: 'crash-logs/old.json', sizeBytes: 10, createdAt: oldTs }],
      totalBytes: 10
    }));

    await store.appendCrash({ event: 'new', error: { message: 'fresh' } });
    const old = await adapter.getObject('ret-bucket', 'crash-logs/old.json');
    expect(String(old || '')).toBe('');
  });
});
