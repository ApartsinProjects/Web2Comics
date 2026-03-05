import { describe, it, expect } from 'vitest';
import {
  classifyIncoming,
  parsePanelCount,
  stripHtmlToText,
  panelCaption,
  getUserState,
  putUserState,
  trackStoredImage
} from '../src/lib.mjs';

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.get(k) ?? null; }
  async put(k, v) { this.map.set(k, v); }
}

class MemoryR2 {
  constructor() { this.map = new Map(); }
  async put(key, body) { this.map.set(key, body); }
  async get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key);
    return {
      async json() { return JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value)); }
    };
  }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '', cursor } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix));
    const start = Number(cursor || 0);
    const batch = keys.slice(start, start + 1000);
    const next = start + batch.length;
    return {
      objects: batch.map((k) => ({ key: k })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined
    };
  }
}

describe('cloudflare worker lib', () => {
  it('classifies inputs', () => {
    expect(classifyIncoming('/help').kind).toBe('command');
    expect(classifyIncoming('https://example.com').kind).toBe('url');
    expect(classifyIncoming('hello').kind).toBe('text');
    expect(classifyIncoming('').kind).toBe('empty');
  });

  it('parses panel count range', () => {
    expect(parsePanelCount('3')).toBe(3);
    expect(parsePanelCount('0')).toBe(null);
    expect(parsePanelCount('10')).toBe(null);
  });

  it('strips html and builds caption', () => {
    const text = stripHtmlToText('<html><body><h1>A</h1><script>x</script><p>B</p></body></html>');
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(panelCaption(2, 'Cap', 'Beat')).toContain('2. Cap');
  });

  it('stores and loads user state from kv', async () => {
    const kv = new MemoryKV();
    const u1 = await getUserState(kv, '123');
    expect(u1.config.panelCount).toBe(3);
    u1.config.panelCount = 5;
    await putUserState(kv, '123', u1);
    const loaded = await getUserState(kv, '123');
    expect(loaded.config.panelCount).toBe(5);
  });

  it('tracks image sizes and triggers cleanup threshold', async () => {
    const r2 = new MemoryR2();
    await r2.put('images/1/a.png', new Uint8Array([1, 2, 3]));
    await trackStoredImage({ BOT_R2: r2, IMAGE_CAPACITY_BYTES: '100', IMAGE_CLEANUP_THRESHOLD_RATIO: '0.5' }, 60);
    await trackStoredImage({ BOT_R2: r2, IMAGE_CAPACITY_BYTES: '100', IMAGE_CLEANUP_THRESHOLD_RATIO: '0.5' }, 60);
    const statusObj = await r2.get('status/images.json');
    const status = await statusObj.json();
    expect(status.totalBytes).toBeGreaterThan(0);
    expect(status.imageCount).toBeGreaterThan(0);
  });
});
