const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeBanlist,
  FileBlacklistStore,
  R2BlacklistStore
} = require('../src/blacklist-store');

class FakeS3Adapter {
  constructor() {
    this.map = new Map();
  }
  async putObject(bucket, key, body) {
    this.map.set(`${bucket}:${key}`, String(body || ''));
  }
  async getObject(bucket, key) {
    return this.map.get(`${bucket}:${key}`) || '';
  }
}

describe('blacklist store', () => {
  it('normalizes ids/usernames and defaults to empty arrays', () => {
    expect(normalizeBanlist(null)).toEqual({ ids: [], usernames: [] });
    expect(normalizeBanlist({
      ids: [' 777 ', '', null],
      usernames: [' User ', '', 'Another']
    })).toEqual({
      ids: ['777'],
      usernames: ['user', 'another']
    });
  });

  it('file store returns empty blacklist initially and persists updates', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-blacklist-file-'));
    const filePath = path.join(tmp, 'blacklist.json');
    const store = new FileBlacklistStore({ filePath });
    expect(await store.load()).toEqual({ ids: [], usernames: [] });
    await store.save({ ids: ['888'], usernames: ['BadUser'] });
    expect(await store.load()).toEqual({ ids: ['888'], usernames: ['baduser'] });
  });

  it('r2 store returns empty blacklist initially and persists updates', async () => {
    const adapter = new FakeS3Adapter();
    const store = new R2BlacklistStore({
      bucket: 'test-bucket',
      key: 'state/blacklist.json',
      adapter
    });
    expect(await store.load()).toEqual({ ids: [], usernames: [] });
    await store.save({ ids: ['999'], usernames: ['Spammer'] });
    expect(await store.load()).toEqual({ ids: ['999'], usernames: ['spammer'] });
  });
});

