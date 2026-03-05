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
    this.state = { users: {}, history: [], banlist: { ids: [], usernames: [] } };
    this.baseSecrets = {};
    this.saveQueue = Promise.resolve();
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
        this.state.banlist = (raw && raw.banlist && typeof raw.banlist === 'object')
          ? {
              ids: Array.isArray(raw.banlist.ids) ? raw.banlist.ids.map((v) => String(v).trim()).filter(Boolean) : [],
              usernames: Array.isArray(raw.banlist.usernames) ? raw.banlist.usernames.map((v) => String(v).trim().toLowerCase()).filter(Boolean) : []
            }
          : { ids: [], usernames: [] };
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
        this.state.banlist = { ids: [], usernames: [] };
      } else {
        this.state.users = {};
        this.state.history = [];
        this.state.banlist = { ids: [], usernames: [] };
      }
    } catch (_) {
      this.state = { users: {}, history: [], banlist: { ids: [], usernames: [] } };
    }
  }

  async save() {
    if (!this.persistence) return;
    const snapshot = JSON.parse(JSON.stringify(this.state || {}));
    this.saveQueue = this.saveQueue.then(() => this.persistence.save(snapshot));
    await this.saveQueue;
  }

  normalizeUserKey(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return 'global';
    return key;
  }

  normalizeUsername(username) {
    return String(username || '').trim().replace(/^@+/, '').toLowerCase();
  }

  ensureBanlist() {
    if (!this.state || typeof this.state !== 'object') this.state = {};
    if (!this.state.banlist || typeof this.state.banlist !== 'object') {
      this.state.banlist = { ids: [], usernames: [] };
    }
    if (!Array.isArray(this.state.banlist.ids)) this.state.banlist.ids = [];
    if (!Array.isArray(this.state.banlist.usernames)) this.state.banlist.usernames = [];
    return this.state.banlist;
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

  getBanlist() {
    const b = this.ensureBanlist();
    return {
      ids: b.ids.slice(),
      usernames: b.usernames.slice()
    };
  }

  findUserIdByUsername(username) {
    const target = this.normalizeUsername(username);
    if (!target) return '';
    const users = this.state && this.state.users ? this.state.users : {};
    for (const [id, record] of Object.entries(users)) {
      const fromUser = this.normalizeUsername(record?.profile?.user?.username || '');
      const fromChat = this.normalizeUsername(record?.profile?.chat?.username || '');
      if (target === fromUser || target === fromChat) return String(id);
    }
    return '';
  }

  isBanned(chatId, username) {
    const b = this.ensureBanlist();
    const id = this.normalizeUserKey(chatId);
    const uname = this.normalizeUsername(username);
    return b.ids.includes(id) || (uname ? b.usernames.includes(uname) : false);
  }

  async banIdentifier(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) throw new Error('Usage: /ban <user_id|username>');
    const b = this.ensureBanlist();
    const out = {
      input: raw,
      bannedId: '',
      bannedUsername: '',
      resolvedId: ''
    };
    if (/^\d+$/.test(raw)) {
      const id = this.normalizeUserKey(raw);
      if (!b.ids.includes(id)) b.ids.push(id);
      out.bannedId = id;
      await this.save();
      return out;
    }

    const uname = this.normalizeUsername(raw);
    if (!uname) throw new Error('Usage: /ban <user_id|username>');
    if (!b.usernames.includes(uname)) b.usernames.push(uname);
    out.bannedUsername = uname;
    const resolved = this.findUserIdByUsername(uname);
    if (resolved) {
      out.resolvedId = resolved;
      if (!b.ids.includes(resolved)) b.ids.push(resolved);
      out.bannedId = resolved;
    }
    await this.save();
    return out;
  }

  async unbanIdentifier(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) throw new Error('Usage: /unban <user_id|username>');
    const b = this.ensureBanlist();
    const out = {
      input: raw,
      removedId: '',
      removedUsername: '',
      changed: false
    };

    if (/^\d+$/.test(raw)) {
      const id = this.normalizeUserKey(raw);
      const before = b.ids.length;
      b.ids = b.ids.filter((v) => String(v) !== id);
      out.changed = b.ids.length !== before;
      out.removedId = id;
      await this.save();
      return out;
    }

    const uname = this.normalizeUsername(raw);
    if (!uname) throw new Error('Usage: /unban <user_id|username>');
    const beforeUsernames = b.usernames.length;
    b.usernames = b.usernames.filter((v) => String(v) !== uname);
    if (b.usernames.length !== beforeUsernames) out.changed = true;
    out.removedUsername = uname;

    const resolvedId = this.findUserIdByUsername(uname);
    if (resolvedId) {
      const beforeIds = b.ids.length;
      b.ids = b.ids.filter((v) => String(v) !== resolvedId);
      if (b.ids.length !== beforeIds) out.changed = true;
      out.removedId = resolvedId;
    }

    await this.save();
    return out;
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
