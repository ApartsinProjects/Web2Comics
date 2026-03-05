const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeKnownUsers,
  FileKnownUsersStore,
  R2KnownUsersStore
} = require('../src/known-users-store');

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

describe('known users store', () => {
  it('normalizes list by id and trims values', () => {
    const out = normalizeKnownUsers([
      { id: ' 777 ', username: 'alice ' },
      { id: '777', username: 'alice2' },
      { id: '', username: 'x' }
    ]);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('777');
    expect(out[0].username).toBe('alice2');
  });

  it('file store returns empty list initially and persists rows', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-known-users-file-'));
    const filePath = path.join(tmp, 'known-users.json');
    const store = new FileKnownUsersStore({ filePath });
    expect(await store.load()).toEqual([]);
    await store.save([{ id: '1', username: 'neo', createdAt: '2026-01-01T00:00:00.000Z' }]);
    const rows = await store.load();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('1');
    expect(rows[0].username).toBe('neo');
  });

  it('r2 store returns empty list initially and persists rows', async () => {
    const adapter = new FakeS3Adapter();
    const store = new R2KnownUsersStore({
      bucket: 'test-bucket',
      key: 'state/known-users.json',
      adapter
    });
    expect(await store.load()).toEqual([]);
    await store.save([{ id: '2', username: 'trinity' }]);
    const rows = await store.load();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('2');
    expect(rows[0].username).toBe('trinity');
  });
});

