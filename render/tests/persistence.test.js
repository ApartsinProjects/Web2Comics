const path = require('path');
const { createPersistence, FilePersistence, PostgresPersistence, R2Persistence } = require('../src/persistence');

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

  it('returns r2 persistence when R2 credentials are provided', () => {
    const out = createPersistence({
      r2Endpoint: 'https://example.r2.cloudflarestorage.com',
      r2Bucket: 'bucket1',
      r2AccessKeyId: 'AKIA_TEST',
      r2SecretAccessKey: 'SECRET_TEST',
      r2StateKey: 'state/runtime-config.json'
    });
    expect(out.mode).toBe('r2');
    expect(out.impl).toBeInstanceOf(R2Persistence);
  });

  it('r2 persistence can save and load state', async () => {
    const impl = new R2Persistence({
      bucket: 'bucket1',
      stateKey: 'state/runtime-config.json',
      adapter: new FakeS3Adapter()
    });
    const state = { users: { '777': { seen: true } }, history: [] };
    await impl.save(state);
    const loaded = await impl.load();
    expect(loaded).toEqual(state);
  });
});
