const fs = require('fs');
const path = require('path');
const { S3Adapter } = require('./crash-log-store');

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeUserPart(value) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || '';
}

function resolveUserGroup(entry) {
  const username = sanitizeUserPart(entry?.user?.username || '');
  if (username) return `username-${username}`;
  const uid = sanitizeUserPart(entry?.user?.id || entry?.chatId || '');
  return uid ? `id-${uid}` : 'id-unknown';
}

class FileRequestLogStore {
  constructor(options = {}) {
    this.logsDir = path.resolve(String(options.logsDir || 'render/data/request-logs'));
    this.retentionDays = Math.max(1, safeNumber(options.retentionDays, 5));
  }

  cleanupOldFiles() {
    if (!fs.existsSync(this.logsDir)) return;
    const cutoffMs = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    const names = fs.readdirSync(this.logsDir);
    names.forEach((name) => {
      if (!name.endsWith('.json')) return;
      const p = path.join(this.logsDir, name);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs < cutoffMs) fs.unlinkSync(p);
      } catch (_) {
        // Ignore cleanup errors.
      }
    });
  }

  async append(entry) {
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.cleanupOldFiles();
    const key = `${nowIso().replace(/[:.]/g, '-')}-${randomId()}.json`;
    fs.writeFileSync(path.join(this.logsDir, key), JSON.stringify({ ...(entry || {}), createdAt: nowIso() }, null, 2), 'utf8');
    return { key };
  }
}

class R2RequestLogStore {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    this.prefix = String(options.prefix || 'logs/requests').trim().replace(/\/+$/, '');
    this.statusKey = String(options.statusKey || `${this.prefix}/status.json`).trim();
    this.capacityBytes = Math.max(1, safeNumber(options.capacityBytes, 512 * 1024 * 1024));
    this.retentionDays = Math.max(1, safeNumber(options.retentionDays, 5));
    const ratio = safeNumber(options.cleanupThresholdRatio, 0.8);
    this.cleanupThresholdRatio = Math.max(0.01, Math.min(1, ratio));
    this.thresholdBytes = Math.floor(this.capacityBytes * this.cleanupThresholdRatio);
    this.adapter = options.adapter || new S3Adapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
    if (!this.bucket) throw new Error('Missing R2 bucket.');
  }

  createEmptyStatus() {
    return {
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      totalBytes: 0,
      count: 0,
      logs: []
    };
  }

  async loadStatus() {
    try {
      const raw = await this.adapter.getObject(this.bucket, this.statusKey);
      if (!raw) return this.createEmptyStatus();
      const parsed = JSON.parse(raw);
      const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      const totalBytes = logs.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes || 0)), 0);
      return { ...this.createEmptyStatus(), ...parsed, logs, totalBytes };
    } catch (_) {
      return this.createEmptyStatus();
    }
  }

  async saveStatus(status) {
    const out = {
      ...status,
      count: Array.isArray(status.logs) ? status.logs.length : 0,
      lastUpdatedAt: nowIso()
    };
    await this.adapter.putObject(this.bucket, this.statusKey, JSON.stringify(out));
    return out;
  }

  async cleanup(status, keep) {
    const keepKeys = keep || new Set();
    const logs = [];
    let totalBytes = 0;
    for (const row of status.logs || []) {
      const key = String(row.key || '').trim();
      if (!key) continue;
      if (keepKeys.has(key)) {
        logs.push(row);
        totalBytes += Math.max(0, Number(row.sizeBytes || 0));
      } else {
        try {
          await this.adapter.deleteObject(this.bucket, key);
        } catch (_) {}
      }
    }
    return { ...status, logs, totalBytes, lastCleanupAt: nowIso() };
  }

  async cleanupExpired(status) {
    const cutoffMs = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    const keep = new Set();
    for (const row of status.logs || []) {
      const t = Date.parse(String(row.createdAt || ''));
      if (Number.isFinite(t) && t >= cutoffMs) {
        keep.add(String(row.key || '').trim());
      }
    }
    return this.cleanup(status, keep);
  }

  async append(entry) {
    let status = await this.loadStatus();
    status = await this.cleanupExpired(status);
    if (status.totalBytes >= this.thresholdBytes) {
      status = await this.cleanup(status, new Set());
    }

    const ts = nowIso();
    const group = resolveUserGroup(entry || {});
    const key = `${this.prefix}/${group}/${ts.replace(/[:.]/g, '-')}-${randomId()}.json`;
    const raw = JSON.stringify({ ...(entry || {}), createdAt: ts, userGroup: group });
    await this.adapter.putObject(this.bucket, key, raw);
    status.logs = (status.logs || []).concat([{ key, sizeBytes: Buffer.byteLength(raw, 'utf8'), createdAt: ts, userGroup: group }]);
    status.totalBytes += Buffer.byteLength(raw, 'utf8');
    if (status.totalBytes >= this.thresholdBytes) {
      status = await this.cleanup(status, new Set([key]));
    }
    await this.saveStatus(status);
    return { key, userGroup: group };
  }
}

function createRequestLogStoreFromEnv() {
  const endpoint = String(process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const prefix = String(process.env.R2_REQUEST_LOG_PREFIX || 'logs/requests').trim();
  const statusKey = String(process.env.R2_REQUEST_LOG_STATUS_KEY || `${prefix}/status.json`).trim();
  const capacityBytes = Math.max(1, safeNumber(process.env.R2_REQUEST_LOG_CAPACITY_BYTES, 512 * 1024 * 1024));
  const cleanupThresholdRatio = Math.max(0.01, Math.min(1, safeNumber(process.env.R2_REQUEST_LOG_CLEANUP_THRESHOLD_RATIO, 0.8)));
  const retentionDays = Math.max(1, safeNumber(process.env.R2_REQUEST_LOG_RETENTION_DAYS, 5));

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return {
      mode: 'r2',
      impl: new R2RequestLogStore({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        prefix,
        statusKey,
        capacityBytes,
        cleanupThresholdRatio,
        retentionDays
      })
    };
  }

  return {
    mode: 'file',
    impl: new FileRequestLogStore({
      logsDir: process.env.RENDER_BOT_REQUEST_LOG_DIR || 'render/data/request-logs',
      retentionDays
    })
  };
}

module.exports = {
  FileRequestLogStore,
  R2RequestLogStore,
  createRequestLogStoreFromEnv
};
