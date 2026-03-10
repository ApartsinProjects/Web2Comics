const fs = require('fs');
const TELEGRAM_MAX_TEXT_CHARS = 4096;
const TELEGRAM_SAFE_TEXT_CHARS = 3900;

function splitMessageText(input, maxChars = TELEGRAM_SAFE_TEXT_CHARS) {
  const raw = String(input || '');
  if (!raw) return [''];
  if (raw.length <= maxChars) return [raw];

  const chunks = [];
  let start = 0;
  while (start < raw.length) {
    let end = Math.min(raw.length, start + maxChars);
    if (end < raw.length) {
      const slice = raw.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
      if (lastBreak >= 0 && lastBreak >= Math.floor(maxChars * 0.6)) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push(raw.slice(start, end));
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

class TelegramApi {
  constructor(botToken, baseUrl) {
    if (!botToken) throw new Error('Missing Telegram bot token');
    this.botToken = String(botToken);
    this.baseUrl = String(baseUrl || `https://api.telegram.org/bot${this.botToken}`).replace(/\/+$/, '');
    this.fileBaseUrl = this.baseUrl.includes(`/bot${this.botToken}`)
      ? this.baseUrl.replace(`/bot${this.botToken}`, `/file/bot${this.botToken}`)
      : `https://api.telegram.org/file/bot${this.botToken}`;
  }

  async call(method, payload, asFormData) {
    const url = `${this.baseUrl}/${method}`;
    const init = {
      method: 'POST',
      headers: {},
      body: null
    };

    if (asFormData) {
      init.body = payload;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload || {});
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok || !json || json.ok !== true) {
      const msg = (json && json.description) || text.slice(0, 400) || `HTTP ${res.status}`;
      throw new Error(`Telegram API ${method} failed: ${msg}`);
    }
    return json.result;
  }

  async sendMessage(chatId, text, extra) {
    const message = String(text || '');
    const chunks = message.length > TELEGRAM_MAX_TEXT_CHARS
      ? splitMessageText(message, TELEGRAM_SAFE_TEXT_CHARS)
      : [message];
    let lastResult = null;
    for (const chunk of chunks) {
      lastResult = await this.call('sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
        ...(extra || {}),
        protect_content: false
      });
    }
    return lastResult;
  }

  async sendChatAction(chatId, action) {
    return this.call('sendChatAction', {
      chat_id: chatId,
      action: String(action || 'typing')
    });
  }

  async sendPhoto(chatId, imagePath, caption) {
    const fileBuffer = fs.readFileSync(imagePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', String(caption || ''));
    form.append('protect_content', 'false');
    form.append('photo', new Blob([fileBuffer], { type: 'image/png' }), 'comic.png');
    return this.call('sendPhoto', form, true);
  }

  async sendMediaGroup(chatId, items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('protect_content', 'false');

    const media = list.map((item, idx) => {
      const attachName = `photo${idx}`;
      const out = {
        type: 'photo',
        media: `attach://${attachName}`
      };
      const caption = String(item?.caption || '').trim();
      if (caption) out.caption = caption.slice(0, 1024);
      return out;
    });
    form.append('media', JSON.stringify(media));

    list.forEach((item, idx) => {
      const fileBuffer = fs.readFileSync(String(item?.imagePath || ''));
      form.append(`photo${idx}`, new Blob([fileBuffer], { type: 'image/png' }), `panel-${idx + 1}.png`);
    });

    return this.call('sendMediaGroup', form, true);
  }

  async getFile(fileId) {
    return this.call('getFile', {
      file_id: String(fileId || '').trim()
    });
  }

  async downloadFile(filePath) {
    const clean = String(filePath || '').replace(/^\/+/, '');
    if (!clean) throw new Error('downloadFile requires file_path');
    const url = `${this.fileBaseUrl}/${clean}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Telegram file download failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

module.exports = {
  TelegramApi
};
