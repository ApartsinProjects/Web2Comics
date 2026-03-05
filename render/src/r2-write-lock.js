function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class WriteLockClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || '').trim().replace(/\/+$/, '');
    this.token = String(options.token || '').trim();
    this.leaseMs = Math.max(1000, safeNumber(options.leaseMs, 15000));
    this.retryMs = Math.max(50, safeNumber(options.retryMs, 250));
    this.maxWaitMs = Math.max(500, safeNumber(options.maxWaitMs, 30000));
    this.owner = String(options.owner || `render-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  }

  enabled() {
    return Boolean(this.baseUrl);
  }

  async acquire(key) {
    if (!this.enabled()) return { granted: true, leaseId: '', expiresAt: 0, disabled: true };
    const started = Date.now();
    const resourceKey = String(key || '').trim();
    if (!resourceKey) throw new Error('Missing lock key');

    while ((Date.now() - started) <= this.maxWaitMs) {
      const res = await fetch(`${this.baseUrl}/acquire`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { 'x-lock-token': this.token } : {})
        },
        body: JSON.stringify({
          key: resourceKey,
          owner: this.owner,
          leaseMs: this.leaseMs
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body && body.granted) {
        return {
          granted: true,
          leaseId: String(body.leaseId || ''),
          expiresAt: Number(body.expiresAt || 0)
        };
      }
      const retryAfter = Math.max(this.retryMs, safeNumber(body?.retryAfterMs, this.retryMs));
      await sleep(retryAfter);
    }
    throw new Error(`Lock acquire timeout for key: ${resourceKey}`);
  }

  async release(key, leaseId = '') {
    if (!this.enabled()) return { released: true, disabled: true };
    const resourceKey = String(key || '').trim();
    if (!resourceKey) return { released: false };
    const res = await fetch(`${this.baseUrl}/release`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { 'x-lock-token': this.token } : {})
      },
      body: JSON.stringify({
        key: resourceKey,
        owner: this.owner,
        leaseId: String(leaseId || '')
      })
    });
    const body = await res.json().catch(() => ({}));
    return { released: Boolean(res.ok && body && body.released) };
  }

  async withLock(key, fn) {
    if (typeof fn !== 'function') throw new Error('withLock requires function');
    const lease = await this.acquire(key);
    try {
      return await fn();
    } finally {
      if (!lease || lease.disabled) return;
      try {
        await this.release(key, lease.leaseId);
      } catch (_) {}
    }
  }
}

function createWriteLockClientFromEnv() {
  const baseUrl = String(process.env.RENDER_BOT_LOCK_SERVICE_URL || '').trim();
  if (!baseUrl) return null;
  return new WriteLockClient({
    baseUrl,
    token: process.env.RENDER_BOT_LOCK_SERVICE_TOKEN || '',
    leaseMs: process.env.RENDER_BOT_LOCK_LEASE_MS || 15000,
    retryMs: process.env.RENDER_BOT_LOCK_RETRY_MS || 250,
    maxWaitMs: process.env.RENDER_BOT_LOCK_MAX_WAIT_MS || 30000
  });
}

module.exports = {
  WriteLockClient,
  createWriteLockClientFromEnv
};

