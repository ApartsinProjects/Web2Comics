const { R2RequestLogStore } = require('../src/request-log-store');

class MemoryAdapter {
  constructor() {
    this.objects = new Map();
  }

  async putObject(bucket, key, body) {
    this.objects.set(`${bucket}/${key}`, String(body));
  }

  async getObject(bucket, key) {
    return this.objects.get(`${bucket}/${key}`) || '';
  }

  async deleteObject(bucket, key) {
    this.objects.delete(`${bucket}/${key}`);
  }

  listKeys(bucket) {
    const prefix = `${bucket}/`;
    return Array.from(this.objects.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

describe('request log store', () => {
  it('writes request logs and status in R2 mode', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2RequestLogStore({
      bucket: 'b',
      prefix: 'logs/requests',
      statusKey: 'logs/requests/status.json',
      adapter
    });

    await store.append({ requestText: 'hello', result: { ok: true } });
    await store.append({ requestText: 'world', result: { ok: true } });

    const statusRaw = await adapter.getObject('b', 'logs/requests/status.json');
    const status = JSON.parse(statusRaw);
    expect(status.count).toBe(2);
    expect(status.totalBytes).toBeGreaterThan(0);
  });

  it('deletes request logs older than retention days', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2RequestLogStore({
      bucket: 'b2',
      prefix: 'logs/requests',
      statusKey: 'logs/requests/status.json',
      retentionDays: 1,
      adapter
    });
    const oldTs = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString();
    await adapter.putObject('b2', 'logs/requests/old.json', JSON.stringify({ requestText: 'old', createdAt: oldTs }));
    await adapter.putObject('b2', 'logs/requests/status.json', JSON.stringify({
      logs: [{ key: 'logs/requests/old.json', sizeBytes: 10, createdAt: oldTs }],
      totalBytes: 10
    }));

    await store.append({ requestText: 'new' });
    const old = await adapter.getObject('b2', 'logs/requests/old.json');
    expect(String(old || '')).toBe('');
  });

  it('groups by username when known and stores request/config/storyboard metadata', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2RequestLogStore({
      bucket: 'b3',
      prefix: 'logs/requests',
      statusKey: 'logs/requests/status.json',
      adapter
    });

    await store.append({
      chatId: 123,
      user: { id: 123, username: 'Alice.Example' },
      kind: 'text',
      command: '',
      requestText: 'A short story',
      config: { generation: { panel_count: 4 } },
      result: { ok: true, storyboard: { panels: [{ narrative: 'Scene 1' }] } },
      metadata: {
        request: { kind: 'text', command: '', text: 'A short story' },
        configuration: { generation: { panel_count: 4 } },
        storyboard: { panels: [{ narrative: 'Scene 1' }] }
      }
    });

    const keys = adapter.listKeys('b3');
    const reqKey = keys.find((k) => k.startsWith('logs/requests/username-alice.example/') && k.endsWith('.json'));
    expect(reqKey).toBeTruthy();

    const raw = await adapter.getObject('b3', reqKey);
    const obj = JSON.parse(raw);
    expect(obj.userGroup).toBe('username-alice.example');
    expect(obj.metadata.request.text).toBe('A short story');
    expect(obj.metadata.configuration.generation.panel_count).toBe(4);
    expect(obj.metadata.storyboard.panels[0].narrative).toBe('Scene 1');
  });

  it('falls back to id grouping when username is missing', async () => {
    const adapter = new MemoryAdapter();
    const store = new R2RequestLogStore({
      bucket: 'b4',
      prefix: 'logs/requests',
      statusKey: 'logs/requests/status.json',
      adapter
    });

    await store.append({
      chatId: 98765,
      user: { id: 98765, username: '' },
      requestText: 'No username request'
    });

    const keys = adapter.listKeys('b4');
    const reqKey = keys.find((k) => k.startsWith('logs/requests/id-98765/') && k.endsWith('.json'));
    expect(reqKey).toBeTruthy();
  });
});
