const { WriteLockClient } = require('../src/r2-write-lock');

describe('r2 write lock client', () => {
  it('acquires lock, runs critical section, then releases', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/acquire')) {
        return {
          ok: true,
          json: async () => ({ ok: true, granted: true, leaseId: 'lease-1', expiresAt: Date.now() + 1000 })
        };
      }
      if (String(url).endsWith('/release')) {
        return {
          ok: true,
          json: async () => ({ ok: true, released: true })
        };
      }
      throw new Error('unexpected url');
    };

    try {
      const lock = new WriteLockClient({
        baseUrl: 'https://lock.example/locks',
        token: 't',
        owner: 'owner-1',
        leaseMs: 5000
      });
      const out = await lock.withLock('state/known-users.json', async () => 'ok');
      expect(out).toBe('ok');
      expect(calls.some((c) => c.url.endsWith('/acquire'))).toBe(true);
      expect(calls.some((c) => c.url.endsWith('/release'))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('retries when lock is busy until granted', async () => {
    let acquireCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).endsWith('/acquire')) {
        acquireCount += 1;
        if (acquireCount < 2) {
          return { ok: false, json: async () => ({ ok: true, granted: false, retryAfterMs: 1 }) };
        }
        return { ok: true, json: async () => ({ ok: true, granted: true, leaseId: 'lease-2', expiresAt: Date.now() + 1000 }) };
      }
      return { ok: true, json: async () => ({ ok: true, released: true }) };
    };
    try {
      const lock = new WriteLockClient({
        baseUrl: 'https://lock.example/locks',
        owner: 'owner-2',
        retryMs: 1,
        maxWaitMs: 100
      });
      const out = await lock.withLock('state/runtime-config.json', async () => 42);
      expect(out).toBe(42);
      expect(acquireCount).toBeGreaterThanOrEqual(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

