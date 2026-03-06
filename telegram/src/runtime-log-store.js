const fs = require('fs');
const path = require('path');
const { S3Adapter } = require('./crash-log-store');
const { normalizeCloudflareR2Endpoint } = require('./r2-endpoint');

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(value, min, max, fallback) {
  const n = safeNumber(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function serializeLine(entry) {
  return `${JSON.stringify(entry)}\n`;
}

function buildR2Key(prefix, tsIso) {
  const ts = String(tsIso || nowIso());
  const [datePart, timePartRaw] = ts.split('T');
  const [year, month, day] = String(datePart || '').split('-');
  const timePart = String(timePartRaw || '').replace('Z', '');
  const hour = timePart.slice(0, 2) || '00';
  const safeTs = ts.replace(/[:.]/g, '-');
  return `${prefix}/${year || '0000'}/${month || '00'}/${day || '00'}/${hour}/${safeTs}-${randomId()}.ndjson`;
}

class FileBufferedRuntimeLogStore {
  constructor(options = {}) {
    this.logsDir = path.resolve(String(options.logsDir || 'telegram/data/runtime-logs'));
    this.flushIntervalMs = clamp(options.flushIntervalMs, 250, 60000, 4000);
    this.maxBatchEntries = clamp(options.maxBatchEntries, 1, 5000, 100);
    this.maxBatchBytes = clamp(options.maxBatchBytes, 512, 2 * 1024 * 1024, 128 * 1024);
    this.maxQueueEntries = clamp(options.maxQueueEntries, 100, 50000, 5000);
    this.queue = [];
    this.queueBytes = 0;
    this.flushTimer = null;
    this.flushing = null;
    this.dropped = 0;
  }

  start() {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  stopTimer() {
    if (!this.flushTimer) return;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  append(entry) {
    const payload = entry && typeof entry === 'object' ? entry : { message: String(entry || '') };
    const line = serializeLine(payload);
    const bytes = Buffer.byteLength(line, 'utf8');
    if (this.queue.length >= this.maxQueueEntries) {
      const oldest = this.queue.shift();
      this.queueBytes -= Number(oldest?.bytes || 0);
      this.dropped += 1;
    }
    this.queue.push({ line, bytes });
    this.queueBytes += bytes;
    if (this.queue.length >= this.maxBatchEntries || this.queueBytes >= this.maxBatchBytes) {
      this.flush().catch(() => {});
    }
  }

  takeBatch() {
    if (!this.queue.length) return [];
    const out = [];
    let bytes = 0;
    while (this.queue.length) {
      const next = this.queue[0];
      if (out.length >= this.maxBatchEntries) break;
      if (out.length && (bytes + next.bytes) > this.maxBatchBytes) break;
      out.push(this.queue.shift());
      bytes += next.bytes;
      this.queueBytes -= next.bytes;
    }
    return out;
  }

  async writeBatch(batch) {
    if (!Array.isArray(batch) || !batch.length) return null;
    fs.mkdirSync(this.logsDir, { recursive: true });
    const ts = nowIso();
    const fileName = `${ts.replace(/[:.]/g, '-')}-${randomId()}.ndjson`;
    const filePath = path.join(this.logsDir, fileName);
    let body = '';
    if (this.dropped > 0) {
      body += serializeLine({ timestamp: ts, level: 'warn', event: 'runtime_log_dropped', dropped: this.dropped });
      this.dropped = 0;
    }
    body += batch.map((b) => b.line).join('');
    await fs.promises.writeFile(filePath, body, 'utf8');
    return { key: filePath, count: batch.length };
  }

  async flush() {
    if (this.flushing) return this.flushing;
    const batch = this.takeBatch();
    if (!batch.length) return null;
    this.flushing = (async () => {
      try {
        return await this.writeBatch(batch);
      } finally {
        this.flushing = null;
        if (this.queue.length >= this.maxBatchEntries || this.queueBytes >= this.maxBatchBytes) {
          this.flush().catch(() => {});
        }
      }
    })();
    return this.flushing;
  }

  async stop() {
    this.stopTimer();
    while (this.queue.length) {
      await this.flush();
      if (this.flushing) await this.flushing;
    }
  }
}

class R2BufferedRuntimeLogStore extends FileBufferedRuntimeLogStore {
  constructor(options = {}) {
    super(options);
    this.bucket = String(options.bucket || '').trim();
    this.prefix = String(options.prefix || 'logs/runtime').trim().replace(/\/+$/, '');
    this.adapter = options.adapter || new S3Adapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
    if (!this.bucket) throw new Error('Missing R2 bucket.');
  }

  async writeBatch(batch) {
    if (!Array.isArray(batch) || !batch.length) return null;
    const ts = nowIso();
    const key = buildR2Key(this.prefix, ts);
    let body = '';
    if (this.dropped > 0) {
      body += serializeLine({ timestamp: ts, level: 'warn', event: 'runtime_log_dropped', dropped: this.dropped });
      this.dropped = 0;
    }
    body += batch.map((b) => b.line).join('');
    await this.adapter.putObject(this.bucket, key, body);
    return { key, count: batch.length };
  }

  async healthCheck() {
    try {
      await this.adapter.verifyAccess(this.bucket, this.prefix);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error),
        code: String(error && (error.Code || error.code || error.name) ? (error.Code || error.code || error.name) : '')
      };
    }
  }
}

function createRuntimeLogStoreFromEnv() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const endpoint = normalizeCloudflareR2Endpoint(String(process.env.R2_S3_ENDPOINT || '').trim(), accountId);
  if (endpoint) process.env.R2_S3_ENDPOINT = endpoint;
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const prefix = String(process.env.R2_RUNTIME_LOG_PREFIX || 'logs/runtime').trim();
  const flushIntervalMs = clamp(process.env.R2_RUNTIME_LOG_FLUSH_INTERVAL_MS, 250, 60000, 4000);
  const maxBatchEntries = clamp(process.env.R2_RUNTIME_LOG_MAX_BATCH_ENTRIES, 1, 5000, 100);
  const maxBatchBytes = clamp(process.env.R2_RUNTIME_LOG_MAX_BATCH_BYTES, 512, 2 * 1024 * 1024, 128 * 1024);
  const maxQueueEntries = clamp(process.env.R2_RUNTIME_LOG_MAX_QUEUE_ENTRIES, 100, 50000, 5000);

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return {
      mode: 'r2',
      impl: new R2BufferedRuntimeLogStore({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        prefix,
        flushIntervalMs,
        maxBatchEntries,
        maxBatchBytes,
        maxQueueEntries
      })
    };
  }

  return {
    mode: 'file',
    impl: new FileBufferedRuntimeLogStore({
      logsDir: process.env.RENDER_BOT_RUNTIME_LOG_DIR || 'telegram/data/runtime-logs',
      flushIntervalMs,
      maxBatchEntries,
      maxBatchBytes,
      maxQueueEntries
    })
  };
}

module.exports = {
  FileBufferedRuntimeLogStore,
  R2BufferedRuntimeLogStore,
  createRuntimeLogStoreFromEnv
};

