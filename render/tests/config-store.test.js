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
    expect(store.getCurrent('bob', 'generation.panel_count')).toBe(3);
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
});
