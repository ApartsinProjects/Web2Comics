import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker.mjs';

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

function makeEnv() {
  return {
    TELEGRAM_BOT_TOKEN: 'T',
    TELEGRAM_WEBHOOK_SECRET: 'S',
    DEFAULT_PANELS: '3',
    ALLOWED_CHAT_IDS: '777',
    ADMIN_CHAT_IDS: '777',
    STATE_KV: new MemoryKV(),
    BOT_R2: new MemoryR2(),
    GEMINI_API_KEY: 'G'
  };
}

describe('worker webhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns healthz', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://x/healthz'), env, { waitUntil() {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('queues webhook and handles /help', async () => {
    const env = makeEnv();
    const waits = [];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('api.telegram.org')) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/telegram/webhook/S', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'S'
      },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: 777 }, text: '/help' } })
    });

    const res = await worker.fetch(req, env, { waitUntil(p) { waits.push(p); } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queued).toBe(true);
    await Promise.all(waits);
    expect(fetchMock).toHaveBeenCalled();
    const sent = fetchMock.mock.calls.some(([u]) => String(u).includes('/sendMessage'));
    expect(sent).toBe(true);
  });

  it('deduplicates update id', async () => {
    const env = makeEnv();
    const waits = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const payload = JSON.stringify({ update_id: 55, message: { chat: { id: 777 }, text: '/user' } });
    const mkReq = () => new Request('https://x/telegram/webhook/S', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'S'
      },
      body: payload
    });

    const a = await worker.fetch(mkReq(), env, { waitUntil(p) { waits.push(p); } });
    expect((await a.json()).queued).toBe(true);
    const b = await worker.fetch(mkReq(), env, { waitUntil(p) { waits.push(p); } });
    expect((await b.json()).duplicate).toBe(true);
  });
});
