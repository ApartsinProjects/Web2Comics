const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeConfigStore } = require('../src/config-store');
const { FilePersistence } = require('../src/persistence');

class MemoryBlacklistStore {
  constructor(initial = { ids: [], usernames: [] }) {
    this.snapshot = {
      ids: Array.isArray(initial.ids) ? initial.ids.slice() : [],
      usernames: Array.isArray(initial.usernames) ? initial.usernames.slice() : []
    };
  }
  async load() {
    return {
      ids: this.snapshot.ids.slice(),
      usernames: this.snapshot.usernames.slice()
    };
  }
  async save(banlist) {
    this.snapshot = {
      ids: Array.isArray(banlist?.ids) ? banlist.ids.slice() : [],
      usernames: Array.isArray(banlist?.usernames) ? banlist.usernames.slice() : []
    };
    return this.snapshot;
  }
}

class MemoryKnownUsersStore {
  constructor(initial = []) {
    this.rows = Array.isArray(initial) ? initial.map((r) => ({ ...r })) : [];
  }
  async load() {
    return this.rows.map((r) => ({ ...r }));
  }
  async save(users) {
    this.rows = Array.isArray(users) ? users.map((r) => ({ ...r })) : [];
    return this.rows;
  }
}

describe('render config store', () => {
  it('sets overrides and writes effective yaml', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const stateFile = path.join(tmp, 'state.json');
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(stateFile));
    await store.load();
    const updated = await store.setConfigValue('u1', 'generation.panel_count', 6);
    expect(updated).toBe(6);

    const outYaml = path.join(tmp, 'effective.yml');
    const written = store.writeEffectiveConfigFile('u1', outYaml);
    expect(fs.existsSync(written)).toBe(true);
  });

  it('keeps settings isolated between users', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')));
    await store.load();
    await store.setConfigValue('alice', 'generation.panel_count', 8);
    expect(store.getCurrent('alice', 'generation.panel_count')).toBe(8);
    expect(store.getCurrent('bob', 'generation.panel_count')).toBe(8);
  });

  it('stores only last 20 interactions', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')));
    await store.load();
    for (let i = 1; i <= 25; i += 1) {
      await store.recordInteraction('u1', {
        requestText: `req-${i}`,
        result: { ok: true, type: 'command' },
        config: store.getEffectiveConfig('u1')
      });
    }
    const h = store.getHistory();
    expect(h.length).toBe(20);
    expect(h[0].requestText).toBe('req-6');
    expect(h[19].requestText).toBe('req-25');
  });

  it('stores user profile metadata', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const statePath = path.join(tmp, 'state.json');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(statePath));
    await store.load();
    await store.updateUserProfile('1796415913', {
      user: { id: 1796415913, username: 'apart', first_name: 'Apart' },
      chat: { id: 1796415913, type: 'private' }
    });
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(raw.users['1796415913'].profile.user.username).toBe('apart');
    expect(raw.users['1796415913'].profile.chat.type).toBe('private');
  });

  it('copies admin keys to target user on share operation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      adminChatIds: 'admin'
    });
    await store.load();
    await store.setSecret('admin', 'GEMINI_API_KEY', 'ADMIN_KEY');
    const copied = await store.copySecretsFromTo('admin', 'user2');
    expect(copied).toBeGreaterThanOrEqual(1);
    store.applySecretsToEnv('user2');
    expect(String(process.env.GEMINI_API_KEY || '')).toBe('ADMIN_KEY');
  });

  it('keeps base env key only for admin users', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'ENV_DEFAULT_KEY';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
      const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
      const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
        adminChatIds: 'admin'
      });
      await store.load();
      store.applySecretsToEnv('new-user');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('');
      const statusUser = store.getSecretsStatus('new-user');
      expect(statusUser.GEMINI_API_KEY.hasValue).toBe(false);
      expect(statusUser.GEMINI_API_KEY.source).toBe('missing');
      store.applySecretsToEnv('admin');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_DEFAULT_KEY');
      const statusAdmin = store.getSecretsStatus('admin');
      expect(statusAdmin.GEMINI_API_KEY.hasValue).toBe(true);
      expect(statusAdmin.GEMINI_API_KEY.source).toBe('env');
    } finally {
      if (previous == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it('writes per-user config json under cfgs/<username>_<id>/config.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-cfgs-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      cfgRootDir: path.join(tmp, 'cfgs'),
      adminChatIds: '1796415913'
    });
    await store.load();
    await store.updateUserProfile('777', {
      user: { id: 777, username: 'alice' },
      chat: { id: 777, type: 'private' }
    });
    await store.setConfigValue('777', 'generation.panel_count', 6);
    const cfgPath = path.join(tmp, 'cfgs', 'alice_777', 'config.json');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(payload.meta.username).toBe('alice');
    expect(payload.meta.user_id).toBe('777');
    expect(payload.config.generation.panel_count).toBe(6);
    expect(payload.credentials && Object.keys(payload.credentials).length).toBe(0);
  });

  it('creates cfg artifact on first encounter and later uses discovered username in folder name', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-cfgs-first-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      cfgRootDir: path.join(tmp, 'cfgs')
    });
    await store.load();

    // First encounter: no username yet.
    await store.setConfigValue('9001', 'generation.panel_count', 5);
    const fallbackPath = path.join(tmp, 'cfgs', 'user_9001', 'config.json');
    expect(fs.existsSync(fallbackPath)).toBe(true);

    // After profile update, username-specific folder should be present.
    await store.updateUserProfile('9001', {
      user: { id: 9001, username: 'neo' },
      chat: { id: 9001, type: 'private' }
    });
    const namedPath = path.join(tmp, 'cfgs', 'neo_9001', 'config.json');
    expect(fs.existsSync(namedPath)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(namedPath, 'utf8'));
    expect(payload.meta.username).toBe('neo');
    expect(payload.meta.user_id).toBe('9001');
  });

  it('share copies credentials once (later admin key changes do not auto-propagate)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-share-once-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      adminChatIds: 'admin'
    });
    await store.load();

    await store.setSecret('admin', 'OPENAI_API_KEY', 'ADMIN_KEY_V1');
    await store.copySecretsFromTo('admin', 'u2');
    let status = store.getSecretsStatus('u2');
    expect(status.OPENAI_API_KEY.hasValue).toBe(true);
    expect(status.OPENAI_API_KEY.source).toBe('runtime');
    store.applySecretsToEnv('u2');
    expect(String(process.env.OPENAI_API_KEY || '')).toBe('ADMIN_KEY_V1');

    // Admin changes key after sharing; user should keep copied snapshot until shared again.
    await store.setSecret('admin', 'OPENAI_API_KEY', 'ADMIN_KEY_V2');
    store.applySecretsToEnv('u2');
    expect(String(process.env.OPENAI_API_KEY || '')).toBe('ADMIN_KEY_V1');

    await store.copySecretsFromTo('admin', 'u2');
    store.applySecretsToEnv('u2');
    expect(String(process.env.OPENAI_API_KEY || '')).toBe('ADMIN_KEY_V2');
  });

  it('includes admin env credentials in admin cfg artifact only', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'ENV_ADMIN_GEMINI';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-cfgs-admin-'));
      const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
      const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
        cfgRootDir: path.join(tmp, 'cfgs'),
        adminChatIds: '1796415913'
      });
      await store.load();
      await store.updateUserProfile('1796415913', {
        user: { id: 1796415913, username: 'sasha' },
        chat: { id: 1796415913, type: 'private' }
      });
      await store.updateUserProfile('888', {
        user: { id: 888, username: 'guest' },
        chat: { id: 888, type: 'private' }
      });

      const adminCfg = JSON.parse(fs.readFileSync(path.join(tmp, 'cfgs', 'sasha_1796415913', 'config.json'), 'utf8'));
      const guestCfg = JSON.parse(fs.readFileSync(path.join(tmp, 'cfgs', 'guest_888', 'config.json'), 'utf8'));
      expect(adminCfg.credentials.GEMINI_API_KEY).toBe('ENV_ADMIN_GEMINI');
      expect(Boolean(guestCfg.credentials.GEMINI_API_KEY)).toBe(false);
    } finally {
      if (prevGemini == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  it('serializes concurrent saves without dropping state updates', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const statePath = path.join(tmp, 'state.json');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(statePath));
    await store.load();

    await Promise.all([
      store.setConfigValue('u1', 'generation.panel_count', 4),
      store.setConfigValue('u2', 'generation.panel_count', 5),
      store.setSecret('u1', 'GEMINI_API_KEY', 'KEY1'),
      store.setSecret('u2', 'GEMINI_API_KEY', 'KEY2')
    ]);

    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(raw.users.u1.overrides.generation.panel_count).toBe(4);
    expect(raw.users.u2.overrides.generation.panel_count).toBe(5);
    expect(raw.users.u1.secrets.GEMINI_API_KEY).toBe('KEY1');
    expect(raw.users.u2.secrets.GEMINI_API_KEY).toBe('KEY2');
  });

  it('loads/saves banlist via external blacklist store (r2/file abstraction)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-banstore-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const blacklistStore = new MemoryBlacklistStore({
      ids: ['777'],
      usernames: ['blocked_user']
    });
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      blacklistStore
    });
    await store.load();
    expect(store.isBanned('777', '')).toBe(true);
    expect(store.isBanned('100', 'blocked_user')).toBe(true);

    await store.unbanIdentifier('777');
    await store.banIdentifier('888');
    const persisted = await blacklistStore.load();
    expect(persisted.ids.includes('888')).toBe(true);
    expect(persisted.ids.includes('777')).toBe(false);
  });

  it('writes accepted users with metadata to known-users json store', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-known-users-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const knownUsersStore = new MemoryKnownUsersStore();
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      knownUsersStore
    });
    await store.load();
    await store.updateUserProfile('777', {
      user: { id: 777, username: 'alice', first_name: 'Alice' },
      chat: { id: 777, type: 'private', username: 'alice_chat' }
    });
    store.markSeen('777');
    await store.save();

    const rows = await knownUsersStore.load();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('777');
    expect(rows[0].username).toBe('alice');
    expect(Boolean(rows[0].createdAt)).toBe(true);
    expect(Boolean(rows[0].acceptedAt)).toBe(true);
    expect(Boolean(rows[0].updatedAt)).toBe(true);
    expect(Boolean(rows[0].lastSeenAt)).toBe(true);
  });
});
