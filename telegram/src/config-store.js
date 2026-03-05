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
  constructor(baseConfigPath, persistence, options = {}) {
    this.baseConfigPath = path.resolve(baseConfigPath);
    this.persistence = persistence;
    this.cfgRootDir = path.resolve(String(options.cfgRootDir || path.join(process.cwd(), 'telegram/cfgs')));
    this.adminChatIds = new Set(
      String(options.adminChatIds || '')
        .split(',')
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    );
    this.baseConfig = loadConfig(this.baseConfigPath).config;
    this.blacklistStore = options.blacklistStore || null;
    this.knownUsersStore = options.knownUsersStore || null;
    this.state = { users: {}, knownUsers: {}, history: [], banlist: { ids: [], usernames: [] }, globalOverrides: {}, meta: {} };
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
        this.state.knownUsers = (raw.knownUsers && typeof raw.knownUsers === 'object') ? raw.knownUsers : {};
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
        this.state.knownUsers = {};
        this.state.history = [];
        this.state.banlist = { ids: [], usernames: [] };
        this.state.globalOverrides = {};
        this.state.meta = {};
      } else {
        this.state.users = {};
        this.state.knownUsers = {};
        this.state.history = [];
        this.state.banlist = { ids: [], usernames: [] };
        this.state.globalOverrides = {};
        this.state.meta = {};
      }
    } catch (_) {
      this.state = { users: {}, knownUsers: {}, history: [], banlist: { ids: [], usernames: [] }, globalOverrides: {}, meta: {} };
    }
    try {
      if (this.blacklistStore && typeof this.blacklistStore.load === 'function') {
        const loadedBanlist = await this.blacklistStore.load();
        this.state.banlist = {
          ids: Array.isArray(loadedBanlist?.ids) ? loadedBanlist.ids.map((v) => String(v).trim()).filter(Boolean) : [],
          usernames: Array.isArray(loadedBanlist?.usernames)
            ? loadedBanlist.usernames.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
            : []
        };
      }
    } catch (_) {}
    try {
      if (this.knownUsersStore && typeof this.knownUsersStore.load === 'function') {
        const rows = await this.knownUsersStore.load();
        const out = {};
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          out[id] = {
            id,
            username: String(row.username || '').trim(),
            chatUsername: String(row.chatUsername || '').trim(),
            name: String(row.name || '').trim(),
            createdAt: String(row.createdAt || '').trim(),
            acceptedAt: String(row.acceptedAt || '').trim(),
            lastSeenAt: String(row.lastSeenAt || '').trim(),
            updatedAt: String(row.updatedAt || '').trim(),
            profile: row.profile && typeof row.profile === 'object' ? row.profile : {}
          };
        });
        this.state.knownUsers = out;
      }
    } catch (_) {}
    this.writeAllUserConfigArtifacts();
  }

  async save() {
    const snapshot = JSON.parse(JSON.stringify(this.state || {}));
    this.saveQueue = this.saveQueue.then(async () => {
      if (this.persistence) await this.persistence.save(snapshot);
      if (this.blacklistStore && typeof this.blacklistStore.save === 'function') {
        await this.blacklistStore.save(this.ensureBanlist());
      }
      if (this.knownUsersStore && typeof this.knownUsersStore.save === 'function') {
        const rows = Object.values((this.state && this.state.knownUsers) || {});
        await this.knownUsersStore.save(rows);
      }
      this.writeAllUserConfigArtifacts();
    });
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

  sanitizePathSegment(value, fallback) {
    const raw = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const cleaned = raw.replace(/\s+/g, '_').replace(/[.]+$/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned || String(fallback || 'user');
  }

  isAdminUser(chatId) {
    const key = this.normalizeUserKey(chatId);
    return this.adminChatIds.has(key);
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

  getUserArtifactDir(chatId) {
    const key = this.normalizeUserKey(chatId);
    const summary = this.getUserSummary(chatId);
    const username = this.sanitizePathSegment(summary.username, 'user');
    const folderName = `${username}_${this.sanitizePathSegment(key, 'unknown')}`;
    return path.join(this.cfgRootDir, folderName);
  }

  resolveUserCredentials(chatId) {
    const user = this.ensureUser(chatId);
    const out = {};
    SECRET_KEYS.forEach((k) => {
      const own = String((user.secrets || {})[k] || '').trim();
      if (own) out[k] = own;
    });
    if (this.isAdminUser(chatId)) {
      SECRET_KEYS.forEach((k) => {
        if (out[k]) return;
        const envVal = String((this.baseSecrets || {})[k] || '').trim();
        if (envVal) out[k] = envVal;
      });
    }
    return out;
  }

  writeUserConfigArtifact(chatId) {
    const key = this.normalizeUserKey(chatId);
    const user = this.ensureUser(chatId);
    const summary = this.getUserSummary(chatId);
    const dir = this.getUserArtifactDir(key);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      meta: {
        user_id: key,
        username: summary.username || '',
        display_name: summary.name || '',
        is_admin: this.isAdminUser(key),
        seen: Boolean(user.seen),
        last_seen_at: String(user.lastSeenAt || ''),
        updated_at: new Date().toISOString()
      },
      config: this.getEffectiveConfig(key),
      credentials: this.resolveUserCredentials(key)
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(payload, null, 2), 'utf8');
    return dir;
  }

  writeAllUserConfigArtifacts() {
    try {
      fs.mkdirSync(this.cfgRootDir, { recursive: true });
    } catch (_) {}
    const users = this.state && this.state.users && typeof this.state.users === 'object'
      ? Object.keys(this.state.users)
      : [];
    users.forEach((chatId) => {
      try {
        this.writeUserConfigArtifact(chatId);
      } catch (_) {}
    });
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
    this.touchKnownUser(chatId, { accepted: true });
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
    this.touchKnownUser(chatId, { profile: user.profile, accepted: Boolean(user.seen) });
    await this.save();
    return user.profile;
  }

  ensureKnownUsers() {
    if (!this.state || typeof this.state !== 'object') this.state = {};
    if (!this.state.knownUsers || typeof this.state.knownUsers !== 'object') this.state.knownUsers = {};
    return this.state.knownUsers;
  }

  touchKnownUser(chatId, options = {}) {
    const key = this.normalizeUserKey(chatId);
    const known = this.ensureKnownUsers();
    const now = new Date().toISOString();
    const existing = known[key] && typeof known[key] === 'object'
      ? known[key]
      : {
          id: key,
          username: '',
          chatUsername: '',
          name: '',
          createdAt: now,
          acceptedAt: '',
          lastSeenAt: '',
          updatedAt: '',
          profile: {}
        };
    const summary = this.getUserSummary(chatId);
    existing.id = key;
    existing.username = summary.username || existing.username || '';
    existing.chatUsername = summary.chatUsername || existing.chatUsername || '';
    existing.name = summary.name || existing.name || '';
    existing.lastSeenAt = String((this.state.users[key] && this.state.users[key].lastSeenAt) || existing.lastSeenAt || now);
    existing.updatedAt = now;
    if (!existing.createdAt) existing.createdAt = now;
    if (options && options.accepted && !existing.acceptedAt) existing.acceptedAt = now;
    if (options && options.profile && typeof options.profile === 'object') {
      existing.profile = {
        ...(existing.profile || {}),
        ...options.profile
      };
    }
    known[key] = existing;
    return existing;
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
    const known = (this.state && this.state.knownUsers && typeof this.state.knownUsers === 'object')
      ? this.state.knownUsers
      : {};
    const rows = Object.entries(known).map(([id, record]) => {
      const summary = this.getUserSummary(id);
      return {
        uid: String(id || '').trim() || 'unknown',
        username: String(record?.username || '').trim() || summary.username,
        name: String(record?.name || '').trim() || summary.name,
        chatUsername: String(record?.chatUsername || '').trim() || summary.chatUsername,
        label: summary.label || `id:${String(id || '').trim()}`,
        lastSeen: String(record?.lastSeenAt || '').trim(),
        createdAt: String(record?.createdAt || '').trim(),
        acceptedAt: String(record?.acceptedAt || '').trim()
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
    const out = {};
    SECRET_KEYS.forEach((key) => {
      const stateVal = String((user.secrets || {})[key] || '').trim();
      const envVal = this.isAdminUser(chatId) ? String((this.baseSecrets || {})[key] || '').trim() : '';
      const resolved = stateVal || envVal;
      out[key] = {
        hasValue: Boolean(resolved),
        source: stateVal
          ? 'runtime'
          : (envVal ? 'env' : 'missing')
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
    const applied = [];
    SECRET_KEYS.forEach((k) => {
      const own = String((user.secrets || {})[k] || '').trim();
      const baseVal = this.isAdminUser(chatId) ? String((this.baseSecrets || {})[k] || '').trim() : '';
      const resolved = own || baseVal;
      if (!resolved) {
        delete process.env[k];
        return;
      }
      process.env[k] = resolved;
      if (own || baseVal) applied.push(k);
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

  async copySecretsFromTo(sourceChatId, targetChatId) {
    this.ensureUser(sourceChatId);
    const target = this.ensureUser(targetChatId);
    const sourceResolved = this.resolveUserCredentials(sourceChatId);
    let copied = 0;
    SECRET_KEYS.forEach((k) => {
      const value = String((sourceResolved || {})[k] || '').trim();
      if (!value) return;
      const existing = String((target.secrets || {})[k] || '').trim();
      // Do not overwrite user-provided keys; sharing only backfills missing keys.
      if (existing) return;
      if (target.secrets[k] !== value) copied += 1;
      target.secrets[k] = value;
    });
    target.sharedFrom = '';
    await this.save();
    return copied;
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
