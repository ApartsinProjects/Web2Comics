const fs = require('fs');
const os = require('os');
const path = require('path');
const { ImageStorageManager, R2ImageStorageManager, HARD_MAX_CAPACITY_BYTES } = require('../src/image-storage');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBAp6R9gAAAABJRU5ErkJggg==';

function writeTiny(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
}

class MemoryR2Adapter {
  constructor() {
    this.objects = new Map();
  }

  async putJson(bucket, key, obj) {
    this.objects.set(`${bucket}/${key}`, Buffer.from(JSON.stringify(obj || {}), 'utf8'));
  }

  async getJson(bucket, key) {
    const raw = this.objects.get(`${bucket}/${key}`);
    if (!raw) return null;
    return JSON.parse(raw.toString('utf8'));
  }

  async putBinary(bucket, key, bytes) {
    this.objects.set(`${bucket}/${key}`, Buffer.from(bytes));
  }

  async getBinary(bucket, key) {
    const raw = this.objects.get(`${bucket}/${key}`);
    return raw ? Buffer.from(raw) : Buffer.alloc(0);
  }

  async listKeys(bucket, prefix) {
    return Array.from(this.objects.keys())
      .filter((k) => k.startsWith(`${bucket}/${prefix}`))
      .map((k) => k.slice(`${bucket}/`.length));
  }

  async deleteObject(bucket, key) {
    this.objects.delete(`${bucket}/${key}`);
  }
}

describe('image storage manager', () => {
  it('tracks total bytes and writes status metadata', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-store-'));
    const statusPath = path.join(tmp, 'status.json');
    const img1 = path.join(tmp, 'a.png');
    const img2 = path.join(tmp, 'b.png');
    writeTiny(img1);
    writeTiny(img2);

    const m = new ImageStorageManager({
      statusFilePath: statusPath,
      capacityBytes: 10000,
      cleanupThresholdRatio: 0.5
    });
    const out = await m.recordImages([img1, img2]);

    expect(out.imageCount).toBe(2);
    expect(out.totalBytes).toBeGreaterThan(0);
    expect(fs.existsSync(statusPath)).toBe(true);
  });

  it('cleans historical images when threshold is reached', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-store-'));
    const statusPath = path.join(tmp, 'status.json');
    const m = new ImageStorageManager({
      statusFilePath: statusPath,
      capacityBytes: 200,
      cleanupThresholdRatio: 0.5
    });

    const old1 = path.join(tmp, 'old1.png');
    const old2 = path.join(tmp, 'old2.png');
    writeTiny(old1);
    writeTiny(old2);
    await m.recordImages([old1, old2]);

    const new1 = path.join(tmp, 'new1.png');
    const new2 = path.join(tmp, 'new2.png');
    writeTiny(new1);
    writeTiny(new2);
    const out = await m.recordImages([new1, new2]);

    expect(fs.existsSync(old1)).toBe(false);
    expect(fs.existsSync(old2)).toBe(false);
    expect(fs.existsSync(new1)).toBe(true);
    expect(fs.existsSync(new2)).toBe(true);
    expect(out.imageCount).toBe(2);
  });

  it('uploads images to R2 storage and can fetch them back by key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-store-r2-'));
    const img1 = path.join(tmp, 'panel1.png');
    const img2 = path.join(tmp, 'panel2.png');
    writeTiny(img1);
    writeTiny(img2);

    const adapter = new MemoryR2Adapter();
    const manager = new R2ImageStorageManager({
      bucket: 'test-bucket',
      prefix: 'images',
      statusKey: 'status/image-storage-status.json',
      capacityBytes: 10000,
      cleanupThresholdRatio: 0.5,
      adapter
    });

    const out = await manager.recordImages([img1, img2]);
    expect(out.imageCount).toBe(2);
    expect(out.totalBytes).toBeGreaterThan(0);
    expect(out.images[0].key).toContain('images/');

    const bytes = await manager.fetchImageBytesByKey(out.images[0].key);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('enforces hard max capacity of 5GB', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-store-cap-'));
    const img = path.join(tmp, 'x.png');
    writeTiny(img);
    const m = new ImageStorageManager({
      statusFilePath: path.join(tmp, 'status.json'),
      capacityBytes: 20 * 1024 * 1024 * 1024,
      cleanupThresholdRatio: 0.5
    });
    const out = await m.recordImages([img]);
    expect(out.capacityBytes).toBe(HARD_MAX_CAPACITY_BYTES);
  });
});
