const fs = require('fs');
const path = require('path');
const { S3Adapter } = require('./crash-log-store');

function sanitizeIdentifier(value, fallback) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) return id;
  return fallback;
}

class FilePersistence {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  async save(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state || {}, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

class PostgresPersistence {
  constructor(connectionString, tableName, stateKey) {
    this.connectionString = String(connectionString || '').trim();
    this.tableName = sanitizeIdentifier(tableName, 'render_bot_state');
    this.stateKey = String(stateKey || 'runtime_config').trim();
    let PoolCtor;
    try {
      ({ Pool: PoolCtor } = require('pg'));
    } catch (error) {
      throw new Error("Postgres persistence requires 'pg' dependency. Run npm install.");
    }
    const useSsl = !/(localhost|127\.0\.0\.1)/i.test(this.connectionString);
    this.pool = new PoolCtor({
      connectionString: this.connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    });
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    const createSql = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        state_key TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await this.pool.query(createSql);
    this.initialized = true;
  }

  async load() {
    await this.init();
    const sql = `SELECT state_json FROM ${this.tableName} WHERE state_key = $1 LIMIT 1`;
    const res = await this.pool.query(sql, [this.stateKey]);
    if (!res.rows.length) return null;
    return res.rows[0].state_json || null;
  }

  async save(state) {
    await this.init();
    const sql = `
      INSERT INTO ${this.tableName} (state_key, state_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (state_key)
      DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW();
    `;
    await this.pool.query(sql, [this.stateKey, JSON.stringify(state || {})]);
  }

  async close() {
    await this.pool.end();
  }
}

class R2Persistence {
  constructor(options = {}) {
    this.bucket = String(options.bucket || '').trim();
    this.stateKey = String(options.stateKey || 'state/runtime-config.json').trim();
    if (!this.bucket) throw new Error('Missing R2 bucket for persistence.');
    this.adapter = options.adapter || new S3Adapter({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    });
  }

  async load() {
    try {
      const raw = await this.adapter.getObject(this.bucket, this.stateKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async save(state) {
    await this.adapter.putObject(this.bucket, this.stateKey, JSON.stringify(state || {}));
  }
}

function createPersistence(options = {}) {
  const mode = String(options.mode || '').trim().toLowerCase();
  const pgUrl = String(options.pgUrl || '').trim();
  const r2Endpoint = String(options.r2Endpoint || '').trim();
  const r2Bucket = String(options.r2Bucket || '').trim();
  const r2AccessKeyId = String(options.r2AccessKeyId || '').trim();
  const r2SecretAccessKey = String(options.r2SecretAccessKey || '').trim();
  const r2StateKey = String(options.r2StateKey || 'state/runtime-config.json').trim();

  const canUseR2 = Boolean(r2Endpoint && r2Bucket && r2AccessKeyId && r2SecretAccessKey);
  if (mode === 'r2' && canUseR2) {
    return {
      mode: 'r2',
      impl: new R2Persistence({
        endpoint: r2Endpoint,
        bucket: r2Bucket,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
        stateKey: r2StateKey
      })
    };
  }

  if (pgUrl) {
    return {
      mode: 'postgres',
      impl: new PostgresPersistence(pgUrl, options.pgTableName, options.pgStateKey)
    };
  }

  if (canUseR2) {
    return {
      mode: 'r2',
      impl: new R2Persistence({
        endpoint: r2Endpoint,
        bucket: r2Bucket,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
        stateKey: r2StateKey
      })
    };
  }

  return {
    mode: 'file',
    impl: new FilePersistence(options.filePath)
  };
}

module.exports = {
  FilePersistence,
  PostgresPersistence,
  R2Persistence,
  createPersistence
};
