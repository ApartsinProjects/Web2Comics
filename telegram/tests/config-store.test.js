const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeConfigStore } = require('../src/config-store');
const { FilePersistence, R2Persistence } = require('../src/persistence');

class FakeS3Adapter {
  constructor() {
    this.data = new Map();
  }

  async putObject(bucket, key, body) {
    this.data.set(`${bucket}/${key}`, String(body || ''));
  }

  async getObject(bucket, key) {
    return this.data.get(`${bucket}/${key}`) || '';
  }
}

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

  it('keeps per-user overrides isolated while leaving other users on defaults', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')));
    await store.load();
    await store.setConfigValue('alice', 'generation.panel_count', 6);
    expect(store.getCurrent('alice', 'generation.panel_count')).toBe(6);
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
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
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
    } finally {
      if (prevGemini == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  it('preseeds base env keys for newly created users (including non-admin)', async () => {
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
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_DEFAULT_KEY');
      const statusUser = store.getSecretsStatus('new-user');
      expect(statusUser.GEMINI_API_KEY.hasValue).toBe(true);
      expect(statusUser.GEMINI_API_KEY.source).toBe('runtime');
      store.applySecretsToEnv('admin');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_DEFAULT_KEY');
      const statusAdmin = store.getSecretsStatus('admin');
      expect(statusAdmin.GEMINI_API_KEY.hasValue).toBe(true);
      expect(statusAdmin.GEMINI_API_KEY.source).toBe('runtime');
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
    expect(payload.credentials && typeof payload.credentials === 'object').toBe(true);
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

  it('share copies credentials once and does not overwrite an already shared user key automatically', async () => {
    const prevOpenAi = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
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
    expect(String(process.env.OPENAI_API_KEY || '')).toBe('ADMIN_KEY_V1');
    if (prevOpenAi == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
  });

  it('does not overwrite user-provided keys when admin shares again', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-share-user-priority-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')), {
      adminChatIds: 'admin'
    });
    await store.load();

    await store.setSecret('admin', 'GEMINI_API_KEY', 'ADMIN_SHARED');
    await store.copySecretsFromTo('admin', 'u2');
    store.applySecretsToEnv('u2');
    expect(String(process.env.GEMINI_API_KEY || '')).toBe('ADMIN_SHARED');

    await store.setSecret('u2', 'GEMINI_API_KEY', 'USER_OWN');
    store.applySecretsToEnv('u2');
    expect(String(process.env.GEMINI_API_KEY || '')).toBe('USER_OWN');

    await store.setSecret('admin', 'GEMINI_API_KEY', 'ADMIN_SHARED_V2');
    const copied = await store.copySecretsFromTo('admin', 'u2');
    expect(copied).toBe(0);
    store.applySecretsToEnv('u2');
    expect(String(process.env.GEMINI_API_KEY || '')).toBe('USER_OWN');
    if (prevGemini == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  });

  it('new users get env-backed keys persisted and survive reboot from state', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = 'ENV_ADMIN_GEMINI_BOOT';
    process.env.OPENAI_API_KEY = 'ENV_ADMIN_OPENAI_BOOT';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-share-restart-'));
      const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
      const statePath = path.join(tmp, 'state.json');
      const first = new RuntimeConfigStore(baseConfig, new FilePersistence(statePath), {
        adminChatIds: 'admin'
      });
      await first.load();
      const copied = await first.copySecretsFromTo('admin', 'u2');
      expect(copied).toBe(0);

      const second = new RuntimeConfigStore(baseConfig, new FilePersistence(statePath), {
        adminChatIds: 'admin'
      });
      await second.load();
      second.applySecretsToEnv('u2');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_ADMIN_GEMINI_BOOT');
      expect(String(process.env.OPENAI_API_KEY || '')).toBe('ENV_ADMIN_OPENAI_BOOT');
      const status = second.getSecretsStatus('u2');
      expect(status.GEMINI_API_KEY.source).toBe('runtime');
      expect(status.OPENAI_API_KEY.source).toBe('runtime');
    } finally {
      if (prevGemini == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
      if (prevOpenAi == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAi;
    }
  });

  it('persists preseeded keys to R2 state and reloads them on boot', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'ENV_ADMIN_R2_GEMINI';
    try {
      const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
      const adapter = new FakeS3Adapter();
      const persistence = new R2Persistence({
        bucket: 'cfgs-test',
        stateKey: 'state/runtime-config.json',
        adapter
      });

      const first = new RuntimeConfigStore(baseConfig, persistence, {
        adminChatIds: 'admin'
      });
      await first.load();
      const copied = await first.copySecretsFromTo('admin', '2002');
      expect(copied).toBe(0);

      const rawState = await adapter.getObject('cfgs-test', 'state/runtime-config.json');
      const parsed = JSON.parse(String(rawState || '{}'));
      expect(parsed.users['2002'].secrets.GEMINI_API_KEY).toBe('ENV_ADMIN_R2_GEMINI');

      const second = new RuntimeConfigStore(baseConfig, persistence, {
        adminChatIds: 'admin'
      });
      await second.load();
      second.applySecretsToEnv('2002');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_ADMIN_R2_GEMINI');
      expect(second.getSecretsStatus('2002').GEMINI_API_KEY.source).toBe('runtime');
    } finally {
      if (prevGemini == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  it('persists user config overrides to R2 and reloads them on boot', async () => {
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const adapter = new FakeS3Adapter();
    const persistence = new R2Persistence({
      bucket: 'cfgs-test',
      stateKey: 'state/runtime-config.json',
      adapter
    });

    const first = new RuntimeConfigStore(baseConfig, persistence, {
      adminChatIds: 'admin'
    });
    await first.load();
    await first.setConfigValue('u77', 'generation.panel_count', 6);
    await first.setConfigValue('u77', 'generation.objective', 'fun');
    await first.setConfigValue('u77', 'generation.output_language', 'he');
    await first.setConfigValue('u77', 'generation.style_name', 'Noir');

    const rawState = await adapter.getObject('cfgs-test', 'state/runtime-config.json');
    const parsed = JSON.parse(String(rawState || '{}'));
    expect(parsed.users.u77.overrides.generation.panel_count).toBe(6);
    expect(parsed.users.u77.overrides.generation.objective).toBe('fun');
    expect(parsed.users.u77.overrides.generation.output_language).toBe('he');
    expect(parsed.users.u77.overrides.generation.style_name).toBe('Noir');

    const second = new RuntimeConfigStore(baseConfig, persistence, {
      adminChatIds: 'admin'
    });
    await second.load();
    expect(second.getCurrent('u77', 'generation.panel_count')).toBe(6);
    expect(second.getCurrent('u77', 'generation.objective')).toBe('fun');
    expect(second.getCurrent('u77', 'generation.output_language')).toBe('he');
    expect(second.getCurrent('u77', 'generation.style_name')).toBe('Noir');
  });

  it('includes preseeded env credentials in cfg artifacts for all users', async () => {
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
      expect(guestCfg.credentials.GEMINI_API_KEY).toBe('ENV_ADMIN_GEMINI');
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

  it('accepts common alias key names and stores canonical secret key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-alias-keys-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const statePath = path.join(tmp, 'state.json');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(statePath));
    await store.load();
    await store.setSecret('u1', 'CLOUDFLARE_WORKERS_AI_TOKEN', 'CF_WORKERS_TOKEN_X');
    await store.setSecret('u1', 'LLAMAPARSE_API_KEY', 'LLAMA_ALIAS_TOKEN_Y');
    store.applySecretsToEnv('u1');
    expect(String(process.env.CLOUDFLARE_API_TOKEN || '')).toBe('CF_WORKERS_TOKEN_X');
    expect(String(process.env.LLAMA_CLOUD_API_KEY || '')).toBe('LLAMA_ALIAS_TOKEN_Y');

    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(raw.users.u1.secrets.CLOUDFLARE_API_TOKEN).toBe('CF_WORKERS_TOKEN_X');
    expect(raw.users.u1.secrets.LLAMA_CLOUD_API_KEY).toBe('LLAMA_ALIAS_TOKEN_Y');
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
