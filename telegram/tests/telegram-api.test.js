const fs = require('fs');
const os = require('os');
const path = require('path');
const { TelegramApi } = require('../src/telegram-api');

describe('telegram api payload safety', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends messages with protect_content disabled', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } })
      };
    });

    const api = new TelegramApi('TEST_TOKEN', 'http://127.0.0.1/fake');
    await api.sendMessage(777, 'hello world');

    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0].init.body || '{}'));
    expect(body.chat_id).toBe(777);
    expect(body.text).toBe('hello world');
    expect(body.protect_content).toBe(false);
  });

  it('sends photos with protect_content disabled', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, result: { message_id: 2 } })
      };
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-photo-'));
    const imagePath = path.join(tmp, 'img.png');
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));

    const api = new TelegramApi('TEST_TOKEN', 'http://127.0.0.1/fake');
    await api.sendPhoto(777, imagePath, 'cap');

    expect(calls.length).toBe(1);
    const form = calls[0].init.body;
    expect(form.get('chat_id')).toBe('777');
    expect(form.get('caption')).toBe('cap');
    expect(form.get('protect_content')).toBe('false');
  });

  it('sends media groups with per-item captions and protect_content disabled', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, result: [{ message_id: 11 }, { message_id: 12 }] })
      };
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-media-group-'));
    const imageA = path.join(tmp, 'a.png');
    const imageB = path.join(tmp, 'b.png');
    fs.writeFileSync(imageA, Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(imageB, Buffer.from([137, 80, 78, 71]));

    const api = new TelegramApi('TEST_TOKEN', 'http://127.0.0.1/fake');
    await api.sendMediaGroup(777, [
      { imagePath: imageA, caption: '1(2) one' },
      { imagePath: imageB, caption: '2(2) two' }
    ]);

    expect(calls.length).toBe(1);
    const form = calls[0].init.body;
    expect(form.get('chat_id')).toBe('777');
    expect(form.get('protect_content')).toBe('false');
    const media = JSON.parse(String(form.get('media') || '[]'));
    expect(Array.isArray(media)).toBe(true);
    expect(media.length).toBe(2);
    expect(media[0].type).toBe('photo');
    expect(media[0].caption).toBe('1(2) one');
    expect(media[1].caption).toBe('2(2) two');
  });

  it('calls getFile and downloads bytes from Telegram file endpoint', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/getFile')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ ok: true, result: { file_path: 'documents/x.pdf' } })
        };
      }
      if (String(url).includes('/file/botTEST_TOKEN/documents/x.pdf')) {
        return {
          ok: true,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
        };
      }
      return {
        ok: false,
        text: async () => 'unexpected'
      };
    });

    const api = new TelegramApi('TEST_TOKEN', 'https://api.telegram.org/botTEST_TOKEN');
    const file = await api.getFile('abc');
    expect(file.file_path).toBe('documents/x.pdf');
    const bytes = await api.downloadFile(file.file_path);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(calls.some((c) => c.url.endsWith('/getFile'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/file/botTEST_TOKEN/documents/x.pdf'))).toBe(true);
  });

  it('splits oversized text into multiple sendMessage calls', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, result: { message_id: calls.length } })
      };
    });

    const api = new TelegramApi('TEST_TOKEN', 'http://127.0.0.1/fake');
    const longText = 'A'.repeat(9500);
    await api.sendMessage(777, longText);

    expect(calls.length).toBeGreaterThan(1);
    const chunks = calls.map((c) => JSON.parse(String(c.init.body || '{}')).text);
    expect(chunks.every((t) => String(t).length <= 4096)).toBe(true);
    expect(chunks.join('')).toBe(longText);
  });
});
