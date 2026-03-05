const fs = require('fs');
const path = require('path');
const { S3Adapter } = require('./crash-log-store');
const { createWriteLockClientFromEnv } = require('./r2-write-lock');

function normalizeBanlist(input) {
  const src = input && typeof input === 'object' ? input : {};
  const ids = Array.isArray(src.ids) ? src.ids.map((v) => String(v || '').trim()).filter(Boolean) : [];
  const usernames = Array.isArray(src.usernames)
    ? src.usernames.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return { ids, usernames };
}

class FileBlacklistStore {
  constructor(options = {}) {
    this.filePath = path.resolve(String(options.filePath || 'telegram/data/blacklist.json'));
  }

  async load() {
    if (!fs.existsSync(this.filePath)) return { ids: [], usernames: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return normalizeBanlist(raw);
    } catch (_) {
      return { ids: [], usernames: [] };
    }
  }

  async save(banlist) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = normalizeBanlist(banlist);
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    return normalized;
  }
}

class R2BlacklistStore {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    this.key = String(options.key || 'state/blacklist.json').trim();
    this.lockClient = options.lockClient || null;
    if (!this.bucket) throw new Error('Missing R2 bucket for blacklist store.');
    this.adapter = options.adapter || new S3Adapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
  }

  async load() {
    try {
      const raw = await this.adapter.getObject(this.bucket, this.key);
      if (!raw) return { ids: [], usernames: [] };
      return normalizeBanlist(JSON.parse(raw));
    } catch (_) {
      return { ids: [], usernames: [] };
    }
  }

  async save(banlist) {
    const normalized = normalizeBanlist(banlist);
    const write = async () => this.adapter.putObject(this.bucket, this.key, JSON.stringify(normalized));
    if (this.lockClient && typeof this.lockClient.withLock === 'function') {
      await this.lockClient.withLock(`r2:${this.bucket}:${this.key}`, write);
    } else {
      await write();
    }
    return normalized;
  }
}

function createBlacklistStoreFromEnv() {
  const endpoint = String(process.env.R2_S3_ENDPOINT || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const key = String(process.env.R2_BLACKLIST_KEY || 'state/blacklist.json').trim();
  const lockClient = createWriteLockClientFromEnv();

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return {
      mode: 'r2',
      impl: new R2BlacklistStore({
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
    impl: new FileBlacklistStore({
      filePath: process.env.RENDER_BOT_BLACKLIST_FILE || 'telegram/data/blacklist.json'
    })
  };
}

module.exports = {
  normalizeBanlist,
  FileBlacklistStore,
  R2BlacklistStore,
  createBlacklistStoreFromEnv
};
