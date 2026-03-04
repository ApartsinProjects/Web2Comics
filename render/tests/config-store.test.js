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
    const updated = await store.setConfigValue('generation.panel_count', 6);
    expect(updated).toBe(6);

    const outYaml = path.join(tmp, 'effective.yml');
    const written = store.writeEffectiveConfigFile(outYaml);
    expect(fs.existsSync(written)).toBe(true);
  });
});
