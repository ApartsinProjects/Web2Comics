const fs = require('fs');
const path = require('path');

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
    fs.writeFileSync(this.filePath, JSON.stringify(state || {}, null, 2), 'utf8');
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

function createPersistence(options = {}) {
  const pgUrl = String(options.pgUrl || '').trim();
  if (pgUrl) {
    return {
      mode: 'postgres',
      impl: new PostgresPersistence(pgUrl, options.pgTableName, options.pgStateKey)
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
  createPersistence
};
