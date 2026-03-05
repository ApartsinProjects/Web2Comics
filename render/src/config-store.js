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

function flattenObject(obj, prefix = '') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  const keys = Object.keys(obj).sort();
  keys.forEach((key) => {
    const value = obj[key];
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      out.push([nextKey, JSON.stringify(value)]);
      return;
    }
    if (value && typeof value === 'object') {
      const nested = flattenObject(value, nextKey);
      if (nested.length) out.push(...nested);
      else out.push([nextKey, '{}']);
      return;
    }
    out.push([nextKey, value]);
  });
  return out;
}

function formatConfigValue(value) {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

class RuntimeConfigStore {
  constructor(baseConfigPath, persistence) {
    this.baseConfigPath = path.resolve(baseConfigPath);
    this.persistence = persistence;
    this.baseConfig = loadConfig(this.baseConfigPath).config;
    this.state = { users: {}, history: [], banlist: { ids: [], usernames: [] }, globalOverrides: {}, meta: {} };
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
        this.state.globalOverrides = raw && raw.globalOverrides && typeof raw.globalOverrides === 'object'
          ? raw.globalOverrides
          : {};
        this.state.meta = raw && raw.meta && typeof raw.meta === 'object'
          ? raw.meta
          : {};
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
        this.state.globalOverrides = {};
        this.state.meta = {};
      } else {
        this.state.users = {};
        this.state.history = [];
        this.state.banlist = { ids: [], usernames: [] };
        this.state.globalOverrides = {};
        this.state.meta = {};
      }
    } catch (_) {
      this.state = { users: {}, history: [], banlist: { ids: [], usernames: [] }, globalOverrides: {}, meta: {} };
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
      this.state.users[key] = {
        overrides: {},
        secrets: {},
        seen: false,
        profile: {},
        identity: { usernames: [], names: [], chatUsernames: [] },
        lastSeenAt: '',
        sharedFrom: ''
      };
    }
    if (!this.state.users[key].identity || typeof this.state.users[key].identity !== 'object') {
      this.state.users[key].identity = { usernames: [], names: [], chatUsernames: [] };
    }
    if (!Array.isArray(this.state.users[key].identity.usernames)) this.state.users[key].identity.usernames = [];
    if (!Array.isArray(this.state.users[key].identity.names)) this.state.users[key].identity.names = [];
    if (!Array.isArray(this.state.users[key].identity.chatUsernames)) this.state.users[key].identity.chatUsernames = [];
    if (!this.state.users[key].profile || typeof this.state.users[key].profile !== 'object') {
      this.state.users[key].profile = {};
    }
    return this.state.users[key];
  }

  appendUniqueIdentity(list, value, normalize = (v) => String(v || '').trim()) {
    const normalized = normalize(value);
    if (!normalized) return;
    if (!Array.isArray(list)) return;
    if (!list.includes(normalized)) list.push(normalized);
  }

  buildDisplayName(profile) {
    const first = String(profile?.user?.first_name || '').trim();
    const last = String(profile?.user?.last_name || '').trim();
    const full = `${first} ${last}`.trim();
    return full;
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
    const username = this.normalizeUsername(user?.profile?.user?.username || '');
    const chatUsername = this.normalizeUsername(user?.profile?.chat?.username || '');
    const displayName = this.buildDisplayName(user.profile);
    this.appendUniqueIdentity(user.identity.usernames, username, (v) => this.normalizeUsername(v));
    this.appendUniqueIdentity(user.identity.chatUsernames, chatUsername, (v) => this.normalizeUsername(v));
    this.appendUniqueIdentity(user.identity.names, displayName, (v) => String(v || '').trim());
    user.lastSeenAt = new Date().toISOString();
    await this.save();
    return user.profile;
  }

  getUserSummary(chatId) {
    const key = this.normalizeUserKey(chatId);
    const user = this.state && this.state.users ? this.state.users[key] : null;
    if (!user) {
      return {
        id: key,
        username: '',
        name: '',
        chatUsername: '',
        label: `id:${key}`
      };
    }
    const username = String(user?.profile?.user?.username || '').trim()
      || String((user?.identity?.usernames || [])[0] || '').trim();
    const chatUsername = String(user?.profile?.chat?.username || '').trim()
      || String((user?.identity?.chatUsernames || [])[0] || '').trim();
    const name = this.buildDisplayName(user.profile)
      || String((user?.identity?.names || [])[0] || '').trim();
    const label = username
      ? `@${username}`
      : (name || (chatUsername ? `@${chatUsername}` : `id:${key}`));
    return { id: key, username, chatUsername, name, label };
  }

  listKnownUsers() {
    const users = (this.state && this.state.users && typeof this.state.users === 'object')
      ? this.state.users
      : {};
    const rows = Object.entries(users).map(([id, record]) => {
      const summary = this.getUserSummary(id);
      return {
        uid: String(id || '').trim() || 'unknown',
        username: summary.username,
        name: summary.name,
        chatUsername: summary.chatUsername,
        label: summary.label,
        lastSeen: String(record?.lastSeenAt || '').trim()
      };
    });
    rows.sort((a, b) => {
      const ta = Date.parse(a.lastSeen || '');
      const tb = Date.parse(b.lastSeen || '');
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return String(a.uid).localeCompare(String(b.uid));
    });
    return rows;
  }

  getEffectiveConfig(chatId) {
    const user = this.ensureUser(chatId);
    const withGlobal = deepMerge(this.baseConfig, this.state.globalOverrides || {});
    return deepMerge(withGlobal, user.overrides || {});
  }

  getGlobalCurrent(pathKey) {
    return getByPath(deepMerge(this.baseConfig, this.state.globalOverrides || {}), pathKey);
  }

  async setGlobalConfigValue(pathKey, value) {
    if (!this.state.globalOverrides || typeof this.state.globalOverrides !== 'object') {
      this.state.globalOverrides = {};
    }
    setByPath(this.state.globalOverrides, pathKey, value);
    await this.save();
    return this.getGlobalCurrent(pathKey);
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
    const flat = flattenObject(cfg);
    const lines = [
      'Current config snapshot (all values):',
      ...flat.map(([k, v]) => `- ${k}: ${formatConfigValue(v)}`),
      '',
      'Commands:',
      '/options <path>  - list choices for a setting',
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

  getMeta(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    const meta = this.state && this.state.meta && typeof this.state.meta === 'object'
      ? this.state.meta
      : {};
    return String(meta[k] || '').trim();
  }

  async ensureMetaValue(key, fallbackValue) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (!this.state.meta || typeof this.state.meta !== 'object') this.state.meta = {};
    const existing = String(this.state.meta[k] || '').trim();
    if (existing) return existing;
    const value = String(fallbackValue || '').trim();
    if (!value) return '';
    this.state.meta[k] = value;
    await this.save();
    return value;
  }

  async setMetaValue(key, value) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (!this.state.meta || typeof this.state.meta !== 'object') this.state.meta = {};
    this.state.meta[k] = value;
    await this.save();
    return this.state.meta[k];
  }
}

module.exports = {
  RuntimeConfigStore,
  getByPath,
  setByPath,
  flattenObject,
  formatConfigValue
};
