const fs = require('fs');
const path = require('path');
const { createWriteLockClientFromEnv } = require('./r2-write-lock');

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

class FileCrashLogStore {
  constructor(options = {}) {
    this.logsDir = path.resolve(String(options.logsDir || 'telegram/data/crash-logs'));
    this.latestPath = path.resolve(String(options.latestPath || path.join(this.logsDir, 'latest.json')));
    this.retentionDays = Math.max(1, safeNumber(options.retentionDays, 5));
  }

  cleanupOldFiles() {
    if (!fs.existsSync(this.logsDir)) return;
    const cutoffMs = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    const names = fs.readdirSync(this.logsDir);
    names.forEach((name) => {
      if (!name.endsWith('.json') || name === path.basename(this.latestPath)) return;
      const p = path.join(this.logsDir, name);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs < cutoffMs) fs.unlinkSync(p);
      } catch (_) {
        // Ignore cleanup errors.
      }
    });
  }

  async appendCrash(entry) {
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.cleanupOldFiles();
    const ts = nowIso().replace(/[:.]/g, '-');
    const filePath = path.join(this.logsDir, `${ts}-${randomId()}.json`);
    const payload = {
      ...(entry || {}),
      createdAt: nowIso()
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    const pointer = { path: filePath, createdAt: payload.createdAt };
    fs.writeFileSync(this.latestPath, JSON.stringify(pointer, null, 2), 'utf8');
    return pointer;
  }

  async getLatestCrash() {
    if (!fs.existsSync(this.latestPath)) return null;
    try {
      const pointer = JSON.parse(fs.readFileSync(this.latestPath, 'utf8'));
      const target = String(pointer.path || '').trim();
      if (!target || !fs.existsSync(target)) return null;
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (_) {
      return null;
    }
  }
}

class S3Adapter {
  constructor(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const accessKeyId = String(options.accessKeyId || '').trim();
    const secretAccessKey = String(options.secretAccessKey || '').trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 S3 credentials (endpoint/accessKeyId/secretAccessKey).');
    }
    let S3Client;
    let PutObjectCommand;
    let GetObjectCommand;
    let ListObjectsV2Command;
    let DeleteObjectCommand;
    try {
      ({ S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
    } catch (error) {
      throw new Error("Missing '@aws-sdk/client-s3'. Run npm install.");
    }
    this.PutObjectCommand = PutObjectCommand;
    this.GetObjectCommand = GetObjectCommand;
    this.ListObjectsV2Command = ListObjectsV2Command;
    this.DeleteObjectCommand = DeleteObjectCommand;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  async putObject(bucket, key, body) {
    await this.client.send(new this.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(body, 'utf8'),
      ContentType: 'application/json'
    }));
  }

  async getObject(bucket, key) {
    const out = await this.client.send(new this.GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    if (!out || !out.Body || typeof out.Body.transformToString !== 'function') return '';
    return out.Body.transformToString();
  }

  async listKeys(bucket, prefix) {
    const keys = [];
    let continuationToken = undefined;
    do {
      const out = await this.client.send(new this.ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      const rows = Array.isArray(out?.Contents) ? out.Contents : [];
      rows.forEach((row) => {
        const key = String(row?.Key || '').trim();
        if (key) keys.push(key);
      });
      continuationToken = out?.IsTruncated ? out?.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteObject(bucket, key) {
    await this.client.send(new this.DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    }));
  }
}

class R2CrashLogStore {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    this.prefix = String(options.prefix || 'crash-logs').trim().replace(/\/+$/, '');
    this.statusKey = String(options.statusKey || `${this.prefix}/status.json`).trim();
    this.lockClient = options.lockClient || null;
    this.capacityBytes = Math.max(1, safeNumber(options.capacityBytes, 1024 * 1024 * 1024));
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

  latestKey() {
    return `${this.prefix}/latest.json`;
  }

  createEmptyStatus() {
    return {
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      totalBytes: 0,
      count: 0,
      logs: [],
      lastUpdatedAt: '',
      lastCleanupAt: ''
    };
  }

  async loadStatus() {
    try {
      const raw = await this.adapter.getObject(this.bucket, this.statusKey);
      if (!raw) return this.createEmptyStatus();
      const parsed = JSON.parse(raw);
      const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      const totalBytes = logs.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes || 0)), 0);
      return {
        ...this.createEmptyStatus(),
        ...(parsed || {}),
        logs,
        totalBytes
      };
    } catch (_) {
      return this.createEmptyStatus();
    }
  }

  async saveStatus(status) {
    const out = {
      ...status,
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      count: Array.isArray(status.logs) ? status.logs.length : 0,
      lastUpdatedAt: nowIso()
    };
    await this.adapter.putObject(this.bucket, this.statusKey, JSON.stringify(out));
    return out;
  }

  async cleanupHistorical(status, keepKeys) {
    const keep = keepKeys || new Set();
    const remaining = [];
    let totalBytes = 0;
    for (const item of status.logs || []) {
      const key = String(item.key || '').trim();
      if (!key) continue;
      if (keep.has(key)) {
        remaining.push(item);
        totalBytes += Math.max(0, Number(item.sizeBytes || 0));
        continue;
      }
      try {
        await this.adapter.deleteObject(this.bucket, key);
      } catch (_) {
        // Best-effort cleanup.
      }
    }
    return {
      ...status,
      logs: remaining,
      totalBytes,
      lastCleanupAt: nowIso()
    };
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
    return this.cleanupHistorical(status, keep);
  }

  async appendCrash(entry) {
    const write = async () => {
      let status = await this.loadStatus();
      status = await this.cleanupExpired(status);
      if (status.totalBytes >= this.thresholdBytes) {
        status = await this.cleanupHistorical(status, new Set());
      }

      const ts = nowIso();
      const key = `${this.prefix}/${ts.replace(/[:.]/g, '-')}-${randomId()}.json`;
      const payload = {
        ...(entry || {}),
        createdAt: ts
      };
      const payloadRaw = JSON.stringify(payload);
      await this.adapter.putObject(this.bucket, key, payloadRaw);
      await this.adapter.putObject(this.bucket, this.latestKey(), JSON.stringify({ key, createdAt: ts }));
      status.logs = (status.logs || []).concat([{
        key,
        sizeBytes: Buffer.byteLength(payloadRaw, 'utf8'),
        createdAt: ts
      }]);
      status.totalBytes = (status.totalBytes || 0) + Buffer.byteLength(payloadRaw, 'utf8');
      if (status.totalBytes >= this.thresholdBytes) {
        status = await this.cleanupHistorical(status, new Set([key]));
      }
      await this.saveStatus(status);
      return { key, createdAt: ts, sizeBytes: Buffer.byteLength(payloadRaw, 'utf8') };
    };
    if (this.lockClient && typeof this.lockClient.withLock === 'function') {
      return this.lockClient.withLock(`r2:${this.bucket}:${this.statusKey}`, write);
    }
    return write();
  }

  async getLatestCrash() {
    try {
      const pointerRaw = await this.adapter.getObject(this.bucket, this.latestKey());
      if (!pointerRaw) return null;
      const pointer = JSON.parse(pointerRaw);
      const key = String(pointer.key || '').trim();
      if (!key) return null;
      const logRaw = await this.adapter.getObject(this.bucket, key);
      if (!logRaw) return null;
      return JSON.parse(logRaw);
    } catch (_) {
      return null;
    }
  }
}

function createCrashLogStoreFromEnv() {
  const endpoint = String(process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const prefix = String(process.env.R2_CRASH_LOG_PREFIX || 'crash-logs').trim();
  const statusKey = String(process.env.R2_CRASH_LOG_STATUS_KEY || `${prefix}/status.json`).trim();
  const capacityBytes = Math.max(1, safeNumber(process.env.R2_CRASH_LOG_CAPACITY_BYTES, 1024 * 1024 * 1024));
  const cleanupThresholdRatio = Math.max(0.01, Math.min(1, safeNumber(process.env.R2_CRASH_LOG_CLEANUP_THRESHOLD_RATIO, 0.8)));
  const retentionDays = Math.max(1, safeNumber(process.env.R2_CRASH_LOG_RETENTION_DAYS, 5));
  const lockClient = createWriteLockClientFromEnv();

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return {
      mode: 'r2',
      impl: new R2CrashLogStore({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        prefix,
        statusKey,
        lockClient,
        capacityBytes,
        cleanupThresholdRatio,
        retentionDays
      })
    };
  }

  return {
    mode: 'file',
    impl: new FileCrashLogStore({
      logsDir: process.env.RENDER_BOT_CRASH_LOG_DIR || 'telegram/data/crash-logs',
      latestPath: process.env.RENDER_BOT_CRASH_LOG_LATEST || 'telegram/data/crash-logs/latest.json',
      retentionDays
    })
  };
}

async function fetchLatestCrashLogFromR2(options = {}) {
  const store = new R2CrashLogStore(options);
  return store.getLatestCrash();
}

module.exports = {
  FileCrashLogStore,
  R2CrashLogStore,
  S3Adapter,
  createCrashLogStoreFromEnv,
  fetchLatestCrashLogFromR2
};
