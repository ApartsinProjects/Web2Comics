const fs = require('fs');
const path = require('path');
const { S3Adapter } = require('./crash-log-store');
const { createWriteLockClientFromEnv } = require('./r2-write-lock');

function normalizeKnownUserEntry(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  return {
    id: String(src.id || '').trim(),
    username: String(src.username || '').trim(),
    chatUsername: String(src.chatUsername || '').trim(),
    name: String(src.name || '').trim(),
    createdAt: String(src.createdAt || '').trim(),
    acceptedAt: String(src.acceptedAt || '').trim(),
    lastSeenAt: String(src.lastSeenAt || '').trim(),
    updatedAt: String(src.updatedAt || '').trim(),
    profile: src.profile && typeof src.profile === 'object' ? src.profile : {}
  };
}

function normalizeKnownUsers(input) {
  const rows = Array.isArray(input) ? input : [];
  const byId = new Map();
  rows.forEach((row) => {
    const normalized = normalizeKnownUserEntry(row);
    if (!normalized.id) return;
    byId.set(normalized.id, normalized);
  });
  return Array.from(byId.values());
}

class FileKnownUsersStore {
  constructor(options = {}) {
    this.filePath = path.resolve(String(options.filePath || 'telegram/data/known-users.json'));
  }

  async load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return normalizeKnownUsers(raw);
    } catch (_) {
      return [];
    }
  }

  async save(users) {
    const normalized = normalizeKnownUsers(users);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    return normalized;
  }
}

class R2KnownUsersStore {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    this.key = String(options.key || 'state/known-users.json').trim();
    this.lockClient = options.lockClient || null;
    if (!this.bucket) throw new Error('Missing R2 bucket for known users store.');
    this.adapter = options.adapter || new S3Adapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
  }

  async load() {
    try {
      const raw = await this.adapter.getObject(this.bucket, this.key);
      if (!raw) return [];
      return normalizeKnownUsers(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  async save(users) {
    const normalized = normalizeKnownUsers(users);
    const write = async () => this.adapter.putObject(this.bucket, this.key, JSON.stringify(normalized));
    if (this.lockClient && typeof this.lockClient.withLock === 'function') {
      await this.lockClient.withLock(`r2:${this.bucket}:${this.key}`, write);
    } else {
      await write();
    }
    return normalized;
  }
}

function createKnownUsersStoreFromEnv() {
  const endpoint = String(process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const key = String(process.env.R2_KNOWN_USERS_KEY || 'state/known-users.json').trim();
  const lockClient = createWriteLockClientFromEnv();

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return {
      mode: 'r2',
      impl: new R2KnownUsersStore({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        key,
        lockClient
      })
    };
  }

  return {
    mode: 'file',
    impl: new FileKnownUsersStore({
      filePath: process.env.RENDER_BOT_KNOWN_USERS_FILE || 'telegram/data/known-users.json'
    })
  };
}

module.exports = {
  normalizeKnownUserEntry,
  normalizeKnownUsers,
  FileKnownUsersStore,
  R2KnownUsersStore,
  createKnownUsersStoreFromEnv
};
