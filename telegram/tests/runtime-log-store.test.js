const { R2BufferedRuntimeLogStore } = require('../src/runtime-log-store');

class MockAdapter {
  constructor() {
    this.puts = [];
  }

  async putObject(bucket, key, body) {
    this.puts.push({ bucket, key, body: String(body || '') });
  }

  async verifyAccess() {
    return true;
  }
}

describe('runtime log store', () => {
  it('buffers and flushes to R2 in batches', async () => {
    const adapter = new MockAdapter();
    const store = new R2BufferedRuntimeLogStore({
      bucket: 'unit-test-bucket',
      prefix: 'logs/runtime',
      adapter,
      flushIntervalMs: 60000,
      maxBatchEntries: 3,
      maxBatchBytes: 1024 * 1024,
      maxQueueEntries: 100
    });

    store.append({ timestamp: new Date().toISOString(), level: 'info', event: 'a', message: 'one' });
    store.append({ timestamp: new Date().toISOString(), level: 'info', event: 'b', message: 'two' });
    expect(adapter.puts.length).toBe(0);

    store.append({ timestamp: new Date().toISOString(), level: 'warn', event: 'c', message: 'three' });
    await new Promise((r) => setTimeout(r, 30));
    expect(adapter.puts.length).toBe(1);
    expect(adapter.puts[0].key.startsWith('logs/runtime/')).toBe(true);
    expect(adapter.puts[0].body.includes('"event":"a"')).toBe(true);
    expect(adapter.puts[0].body.includes('"event":"b"')).toBe(true);
    expect(adapter.puts[0].body.includes('"event":"c"')).toBe(true);

    store.append({ timestamp: new Date().toISOString(), level: 'error', event: 'd', message: 'four' });
    await store.stop();
    expect(adapter.puts.length).toBe(2);
    expect(adapter.puts[1].body.includes('"event":"d"')).toBe(true);
  });
});

