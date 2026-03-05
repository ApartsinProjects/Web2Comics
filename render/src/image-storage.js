const fs = require('fs');
const path = require('path');

const HARD_MAX_CAPACITY_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB hard cap
const DEFAULT_CAPACITY_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB default
const DEFAULT_THRESHOLD_RATIO = 0.5;

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

class ImageStorageManager {
  constructor(options = {}) {
    this.statusFilePath = path.resolve(String(options.statusFilePath || 'render/out/image-storage-status.json'));
    this.capacityBytes = Math.max(1, Math.min(HARD_MAX_CAPACITY_BYTES, safeNumber(options.capacityBytes, DEFAULT_CAPACITY_BYTES)));
    const ratio = safeNumber(options.cleanupThresholdRatio, DEFAULT_THRESHOLD_RATIO);
    this.cleanupThresholdRatio = Math.max(0.01, Math.min(1, ratio));
    this.thresholdBytes = Math.floor(this.capacityBytes * this.cleanupThresholdRatio);
    this.writeChain = Promise.resolve();
  }

  loadStatus() {
    if (!fs.existsSync(this.statusFilePath)) {
      return this.createEmptyStatus();
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.statusFilePath, 'utf8'));
      const images = Array.isArray(raw.images) ? raw.images : [];
      const totalBytes = images.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes || 0)), 0);
      return {
        ...this.createEmptyStatus(),
        ...raw,
        images,
        totalBytes
      };
    } catch (_) {
      return this.createEmptyStatus();
    }
  }

  createEmptyStatus() {
    return {
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      totalBytes: 0,
      imageCount: 0,
      images: [],
      lastUpdatedAt: '',
      lastCleanupAt: ''
    };
  }

  saveStatus(status) {
    const out = {
      ...status,
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      imageCount: Array.isArray(status.images) ? status.images.length : 0,
      lastUpdatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(this.statusFilePath), { recursive: true });
    const tmp = `${this.statusFilePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, this.statusFilePath);
    return out;
  }

  cleanupHistorical(status, keepPaths) {
    const keep = keepPaths || new Set();
    const remaining = [];
    let totalBytes = 0;

    for (const item of status.images) {
      const p = String(item.path || '');
      if (!p) continue;
      if (keep.has(p)) {
        remaining.push(item);
        totalBytes += Math.max(0, Number(item.sizeBytes || 0));
        continue;
      }
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {
        // Ignore cleanup failures, accounting still resets for old entries.
      }
    }

    return {
      ...status,
      images: remaining,
      totalBytes,
      lastCleanupAt: new Date().toISOString()
    };
  }

  async doRecordImages(imagePaths) {
    const paths = (Array.isArray(imagePaths) ? imagePaths : [])
      .map((p) => path.resolve(String(p || '').trim()))
      .filter(Boolean);
    if (!paths.length) return this.loadStatus();

    let status = this.loadStatus();

    if (status.totalBytes >= this.thresholdBytes) {
      status = this.cleanupHistorical(status, new Set());
    }

    const now = new Date().toISOString();
    const newEntries = [];
    for (const p of paths) {
      let sizeBytes = 0;
      try {
        sizeBytes = fs.existsSync(p) ? fs.statSync(p).size : 0;
      } catch (_) {
        sizeBytes = 0;
      }
      newEntries.push({
        path: p,
        sizeBytes: Math.max(0, Number(sizeBytes || 0)),
        createdAt: now
      });
    }

    status.images = status.images.concat(newEntries);
    status.totalBytes += newEntries.reduce((sum, item) => sum + item.sizeBytes, 0);

    if (status.totalBytes >= this.thresholdBytes) {
      status = this.cleanupHistorical(status, new Set(paths));
    }

    return this.saveStatus(status);
  }

  async recordImages(imagePaths) {
    const run = this.writeChain.then(() => this.doRecordImages(imagePaths));
    this.writeChain = run.catch(() => {});
    return run;
  }
}

class R2ImageStorageAdapter {
  constructor(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const accessKeyId = String(options.accessKeyId || '').trim();
    const secretAccessKey = String(options.secretAccessKey || '').trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 image storage credentials (endpoint/accessKeyId/secretAccessKey).');
    }
    let S3Client;
    let PutObjectCommand;
    let GetObjectCommand;
    let ListObjectsV2Command;
    let DeleteObjectCommand;
    try {
      ({ S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
    } catch (_) {
      throw new Error("Missing '@aws-sdk/client-s3'. Run npm install.");
    }
    this.PutObjectCommand = PutObjectCommand;
    this.GetObjectCommand = GetObjectCommand;
    this.ListObjectsV2Command = ListObjectsV2Command;
    this.DeleteObjectCommand = DeleteObjectCommand;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  async putJson(bucket, key, obj) {
    await this.client.send(new this.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(JSON.stringify(obj || {}), 'utf8'),
      ContentType: 'application/json'
    }));
  }

  async getJson(bucket, key) {
    const out = await this.client.send(new this.GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    if (!out || !out.Body || typeof out.Body.transformToString !== 'function') return null;
    const raw = await out.Body.transformToString();
    return raw ? JSON.parse(raw) : null;
  }

  async putBinary(bucket, key, bytes, contentType) {
    await this.client.send(new this.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: String(contentType || 'application/octet-stream')
    }));
  }

  async getBinary(bucket, key) {
    const out = await this.client.send(new this.GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    if (!out || !out.Body || typeof out.Body.transformToByteArray !== 'function') return Buffer.alloc(0);
    const arr = await out.Body.transformToByteArray();
    return Buffer.from(arr);
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

class R2ImageStorageManager {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    if (!this.bucket) throw new Error('Missing R2 bucket for image storage.');
    this.prefix = String(options.prefix || 'images').trim().replace(/\/+$/, '');
    this.statusKey = String(options.statusKey || 'status/image-storage-status.json').trim();
    this.capacityBytes = Math.max(1, Math.min(HARD_MAX_CAPACITY_BYTES, safeNumber(options.capacityBytes, DEFAULT_CAPACITY_BYTES)));
    const ratio = safeNumber(options.cleanupThresholdRatio, DEFAULT_THRESHOLD_RATIO);
    this.cleanupThresholdRatio = Math.max(0.01, Math.min(1, ratio));
    this.thresholdBytes = Math.floor(this.capacityBytes * this.cleanupThresholdRatio);
    this.writeChain = Promise.resolve();
    this.adapter = options.adapter || new R2ImageStorageAdapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
  }

  createEmptyStatus() {
    return {
      capacityBytes: this.capacityBytes,
      cleanupThresholdRatio: this.cleanupThresholdRatio,
      thresholdBytes: this.thresholdBytes,
      totalBytes: 0,
      imageCount: 0,
      images: [],
      lastUpdatedAt: '',
      lastCleanupAt: ''
    };
  }

  async loadStatus() {
    try {
      const raw = await this.adapter.getJson(this.bucket, this.statusKey);
      if (!raw || typeof raw !== 'object') return this.createEmptyStatus();
      const images = Array.isArray(raw.images) ? raw.images : [];
      const totalBytes = images.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes || 0)), 0);
      return {
        ...this.createEmptyStatus(),
        ...raw,
        images,
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
      imageCount: Array.isArray(status.images) ? status.images.length : 0,
      lastUpdatedAt: new Date().toISOString()
    };
    await this.adapter.putJson(this.bucket, this.statusKey, out);
    return out;
  }

  async deleteAllImageObjects() {
    const keys = await this.adapter.listKeys(this.bucket, `${this.prefix}/`);
    for (const key of keys) {
      await this.adapter.deleteObject(this.bucket, key);
    }
  }

  async cleanupHistorical(status, keepKeys) {
    const keep = keepKeys || new Set();
    const remaining = [];
    let totalBytes = 0;
    for (const item of status.images) {
      const key = String(item.key || '').trim();
      if (!key) continue;
      if (keep.has(key)) {
        remaining.push(item);
        totalBytes += Math.max(0, Number(item.sizeBytes || 0));
      } else {
        try {
          await this.adapter.deleteObject(this.bucket, key);
        } catch (_) {
          // Ignore delete failures and continue.
        }
      }
    }

    return {
      ...status,
      images: remaining,
      totalBytes,
      lastCleanupAt: new Date().toISOString()
    };
  }

  async doRecordImages(imagePaths) {
    const paths = (Array.isArray(imagePaths) ? imagePaths : [])
      .map((p) => path.resolve(String(p || '').trim()))
      .filter(Boolean);
    if (!paths.length) return this.loadStatus();

    let status = await this.loadStatus();
    if (status.totalBytes >= this.thresholdBytes) {
      await this.deleteAllImageObjects();
      status = {
        ...this.createEmptyStatus(),
        lastCleanupAt: new Date().toISOString()
      };
    }

    const now = new Date().toISOString();
    const newEntries = [];
    for (const p of paths) {
      if (!fs.existsSync(p)) continue;
      const bytes = fs.readFileSync(p);
      const sizeBytes = Math.max(0, Number(bytes.length || 0));
      const key = `${this.prefix}/${now.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}-${path.basename(p)}`;
      await this.adapter.putBinary(this.bucket, key, bytes, 'image/png');
      newEntries.push({
        path: p,
        key,
        sizeBytes,
        createdAt: now
      });
    }

    status.images = status.images.concat(newEntries);
    status.totalBytes += newEntries.reduce((sum, item) => sum + item.sizeBytes, 0);

    if (status.totalBytes >= this.thresholdBytes) {
      const keep = new Set(newEntries.map((e) => e.key));
      status = await this.cleanupHistorical(status, keep);
    }

    return this.saveStatus(status);
  }

  async recordImages(imagePaths) {
    const run = this.writeChain.then(() => this.doRecordImages(imagePaths));
    this.writeChain = run.catch(() => {});
    return run;
  }

  async fetchImageBytesByKey(key) {
    return this.adapter.getBinary(this.bucket, key);
  }
}

function createImageStorageManagerFromEnv(options = {}) {
  const endpoint = String(options.r2Endpoint || process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(options.r2Bucket || process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(options.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(options.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const prefix = String(options.r2Prefix || process.env.R2_IMAGE_PREFIX || 'images').trim();
  const statusKey = String(options.r2StatusKey || process.env.R2_IMAGE_STATUS_KEY || 'status/image-storage-status.json').trim();

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return new R2ImageStorageManager({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      prefix,
      statusKey,
      capacityBytes: options.capacityBytes,
      cleanupThresholdRatio: options.cleanupThresholdRatio
    });
  }

  return new ImageStorageManager({
    statusFilePath: options.statusFilePath,
    capacityBytes: options.capacityBytes,
    cleanupThresholdRatio: options.cleanupThresholdRatio
  });
}

module.exports = {
  ImageStorageManager,
  R2ImageStorageManager,
  R2ImageStorageAdapter,
  createImageStorageManagerFromEnv,
  HARD_MAX_CAPACITY_BYTES,
  DEFAULT_CAPACITY_BYTES,
  DEFAULT_THRESHOLD_RATIO
};
