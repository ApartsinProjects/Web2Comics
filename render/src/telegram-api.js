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
      ...(extra || {})
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
    form.append('photo', new Blob([fileBuffer], { type: 'image/png' }), 'comic.png');
    return this.call('sendPhoto', form, true);
  }
}

module.exports = {
  TelegramApi
};
