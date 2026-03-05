const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeConfigStore } = require('../src/config-store');
const { FilePersistence } = require('../src/persistence');

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

  it('applies shared keys when target has no own key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
    const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
    const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')));
    await store.load();
    await store.setSecret('admin', 'GEMINI_API_KEY', 'ADMIN_KEY');
    await store.setSharedFrom('user2', 'admin');
    store.applySecretsToEnv('user2');
    expect(String(process.env.GEMINI_API_KEY || '')).toBe('ADMIN_KEY');
  });

  it('keeps base env key when user has no runtime/shared key', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'ENV_DEFAULT_KEY';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bot-'));
      const baseConfig = path.resolve(__dirname, '../config/default.render.yml');
      const store = new RuntimeConfigStore(baseConfig, new FilePersistence(path.join(tmp, 'state.json')));
      await store.load();
      store.applySecretsToEnv('new-user');
      expect(String(process.env.GEMINI_API_KEY || '')).toBe('ENV_DEFAULT_KEY');

      const status = store.getSecretsStatus('new-user');
      expect(status.GEMINI_API_KEY.hasValue).toBe(true);
      expect(status.GEMINI_API_KEY.source).toBe('env');
    } finally {
      if (previous == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
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
});
