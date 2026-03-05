const fs = require('fs');

class TelegramApi {
  constructor(botToken, baseUrl) {
    if (!botToken) throw new Error('Missing Telegram bot token');
    this.botToken = String(botToken);
    this.baseUrl = String(baseUrl || `https://api.telegram.org/bot${this.botToken}`).replace(/\/+$/, '');
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
    return this.call('sendMessage', {
      chat_id: chatId,
      text: String(text || ''),
      disable_web_page_preview: true,
      ...(extra || {}),
      protect_content: false
    });
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
}

module.exports = {
  TelegramApi
};
