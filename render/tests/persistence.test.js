const path = require('path');
const { createPersistence, FilePersistence, PostgresPersistence } = require('../src/persistence');

describe('render persistence factory', () => {
  it('returns file persistence when pg url is missing', () => {
    const out = createPersistence({
      filePath: path.resolve(__dirname, '../data/runtime-state.json')
    });
    expect(out.mode).toBe('file');
    expect(out.impl).toBeInstanceOf(FilePersistence);
  });

  it('returns postgres persistence when pg url is provided', async () => {
    const out = createPersistence({
      pgUrl: 'postgres://user:pass@localhost:5432/db',
      pgTableName: 'render_bot_state',
      pgStateKey: 'runtime_config'
    });
    expect(out.mode).toBe('postgres');
    expect(out.impl).toBeInstanceOf(PostgresPersistence);
    await out.impl.close();
  });
});
