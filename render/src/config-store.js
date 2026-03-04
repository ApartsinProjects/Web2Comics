const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadConfig, deepMerge } = require('../../engine/src/config');
const { SECRET_KEYS } = require('./options');

function getByPath(obj, pathKey) {
  const keys = String(pathKey || '').split('.').filter(Boolean);
  let cur = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setByPath(obj, pathKey, value) {
  const keys = String(pathKey || '').split('.').filter(Boolean);
  if (!keys.length) throw new Error('Invalid path key');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

class RuntimeConfigStore {
  constructor(baseConfigPath, persistence) {
    this.baseConfigPath = path.resolve(baseConfigPath);
    this.persistence = persistence;
    this.baseConfig = loadConfig(this.baseConfigPath).config;
    this.state = { users: {}, history: [] };
    this.baseSecrets = {};
    SECRET_KEYS.forEach((key) => {
      const value = String(process.env[key] || '').trim();
      if (value) this.baseSecrets[key] = value;
    });
  }

  async load() {
    let raw = null;
    try {
      raw = this.persistence ? await this.persistence.load() : null;
    } catch (_) {
      raw = null;
    }
    try {
      if (raw && typeof raw.users === 'object') {
        this.state.users = raw.users;
        this.state.history = Array.isArray(raw.history) ? raw.history : [];
      } else if (raw && (raw.overrides || raw.secrets)) {
        // Backward compatibility with old single-user shape.
        this.state.users = {
          global: {
            overrides: raw && typeof raw.overrides === 'object' ? raw.overrides : {},
            secrets: raw && typeof raw.secrets === 'object' ? raw.secrets : {},
            seen: true
          }
        };
        this.state.history = [];
      } else {
        this.state.users = {};
        this.state.history = [];
      }
    } catch (_) {
      this.state = { users: {}, history: [] };
    }
  }

  async save() {
    if (!this.persistence) return;
    await this.persistence.save(this.state);
  }

  normalizeUserKey(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return 'global';
    return key;
  }

  ensureUser(chatId) {
    const key = this.normalizeUserKey(chatId);
    if (!this.state.users[key]) {
      this.state.users[key] = { overrides: {}, secrets: {}, seen: false, profile: {}, lastSeenAt: '', sharedFrom: '' };
    }
    return this.state.users[key];
  }

  markSeen(chatId) {
    const user = this.ensureUser(chatId);
    const wasSeen = Boolean(user.seen);
    user.seen = true;
    user.lastSeenAt = new Date().toISOString();
    return !wasSeen;
  }

  async updateUserProfile(chatId, profile) {
    const user = this.ensureUser(chatId);
    user.profile = {
      ...(user.profile || {}),
      ...(profile || {})
    };
    user.lastSeenAt = new Date().toISOString();
    await this.save();
    return user.profile;
  }

  getEffectiveConfig(chatId) {
    const user = this.ensureUser(chatId);
    return deepMerge(this.baseConfig, user.overrides || {});
  }

  getCurrent(chatId, pathKey) {
    return getByPath(this.getEffectiveConfig(chatId), pathKey);
  }

  async setConfigValue(chatId, pathKey, value) {
    const user = this.ensureUser(chatId);
    setByPath(user.overrides, pathKey, value);
    await this.save();
    return this.getCurrent(chatId, pathKey);
  }

  async clearOverrides(chatId) {
    const user = this.ensureUser(chatId);
    user.overrides = {};
    await this.save();
  }

  getSecretsStatus(chatId) {
    const user = this.ensureUser(chatId);
    const shared = user.sharedFrom ? this.ensureUser(user.sharedFrom) : null;
    const out = {};
    SECRET_KEYS.forEach((key) => {
      const stateVal = String((user.secrets || {})[key] || '').trim();
      const sharedVal = String((shared && shared.secrets && shared.secrets[key]) || '').trim();
      const envVal = String((this.baseSecrets || {})[key] || '').trim();
      const resolved = stateVal || sharedVal || envVal;
      out[key] = {
        hasValue: Boolean(resolved),
        source: stateVal
          ? 'runtime'
          : (sharedVal ? `shared:${user.sharedFrom}` : (envVal ? 'env' : 'missing'))
      };
    });
    return out;
  }

  async setSecret(chatId, key, value) {
    const k = String(key || '').trim();
    if (!SECRET_KEYS.includes(k)) throw new Error(`Unsupported key: ${k}`);
    const user = this.ensureUser(chatId);
    user.secrets[k] = String(value || '').trim();
    await this.save();
  }

  async unsetSecret(chatId, key) {
    const k = String(key || '').trim();
    const user = this.ensureUser(chatId);
    delete user.secrets[k];
    await this.save();
  }

  applySecretsToEnv(chatId) {
    const user = this.ensureUser(chatId);
    const shared = user.sharedFrom ? this.ensureUser(user.sharedFrom) : null;
    const applied = [];
    SECRET_KEYS.forEach((k) => {
      const own = String((user.secrets || {})[k] || '').trim();
      const sharedVal = String((shared && shared.secrets && shared.secrets[k]) || '').trim();
      const baseVal = String((this.baseSecrets || {})[k] || '').trim();
      const resolved = own || sharedVal || baseVal;
      if (!resolved) {
        delete process.env[k];
        return;
      }
      process.env[k] = resolved;
      if (own || sharedVal) applied.push(k);
    });
    return applied;
  }

  writeEffectiveConfigFile(chatId, outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, yaml.dump(this.getEffectiveConfig(chatId), { lineWidth: 140 }), 'utf8');
    return resolved;
  }

  formatConfigSummary(chatId) {
    const cfg = this.getEffectiveConfig(chatId);
    const lines = [
      'Current config snapshot:',
      `- generation.panel_count: ${cfg.generation.panel_count}`,
      `- generation.objective: ${cfg.generation.objective}`,
      `- generation.output_language: ${cfg.generation.output_language}`,
      `- generation.detail_level: ${cfg.generation.detail_level}`,
      `- providers.text.provider: ${cfg.providers.text.provider}`,
      `- providers.text.model: ${cfg.providers.text.model}`,
      `- providers.image.provider: ${cfg.providers.image.provider}`,
      `- providers.image.model: ${cfg.providers.image.model}`,
      `- runtime.image_concurrency: ${cfg.runtime.image_concurrency}`,
      `- runtime.retries: ${cfg.runtime.retries}`,
      `- output.width: ${cfg.output.width}`,
      `- output.panel_height: ${cfg.output.panel_height}`,
      '',
      'Commands:',
      '/options <path>  - list choices for a setting',
      '/choose <path> <number> - choose option by index',
      '/set <path> <value> - set any value directly',
      '/keys - show provider key status',
      '/setkey <KEY> <VALUE> - set provider key in runtime state',
      '/unsetkey <KEY> - remove runtime key override',
      '/reset_config - clear runtime overrides'
    ];
    return lines.join('\n');
  }

  async recordInteraction(chatId, payload) {
    const entry = {
      timestamp: new Date().toISOString(),
      chatId: Number(chatId),
      ...(payload || {})
    };
    if (!Array.isArray(this.state.history)) this.state.history = [];
    this.state.history.push(entry);
    if (this.state.history.length > 20) {
      this.state.history = this.state.history.slice(this.state.history.length - 20);
    }
    await this.save();
    return entry;
  }

  getHistory() {
    return Array.isArray(this.state.history) ? this.state.history.slice() : [];
  }

  async resetUser(chatId) {
    const key = this.normalizeUserKey(chatId);
    delete this.state.users[key];
    await this.save();
  }

  async setSharedFrom(chatId, sourceChatId) {
    const user = this.ensureUser(chatId);
    user.sharedFrom = this.normalizeUserKey(sourceChatId);
    await this.save();
    return user.sharedFrom;
  }
}

module.exports = {
  RuntimeConfigStore,
  getByPath,
  setByPath
};
