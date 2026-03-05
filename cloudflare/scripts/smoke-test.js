#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readTelegramToken() {
  if (String(process.env.BOT_SECRETS_ENV_ONLY || '').trim().toLowerCase() === 'true') return '';
  const file = path.resolve(process.cwd(), '.telegram.yaml');
  if (!fs.existsSync(file)) return '';
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/bot_token:\s*"([^"]+)"/i);
  return m ? m[1].trim() : '';
}

async function main() {
  const base = String(process.env.CLOUDFLARE_WORKER_URL || '').trim();
  if (!base) throw new Error('Missing CLOUDFLARE_WORKER_URL');
  const health = await fetch(`${base.replace(/\/$/, '')}/healthz`);
  const hb = await health.json().catch(() => ({}));
  if (!health.ok || !hb.ok) throw new Error(`Health check failed: ${health.status}`);
  console.log('[cf-test] healthz ok');

  const token = String(process.env.TELEGRAM_BOT_TOKEN || readTelegramToken()).trim();
  const chatId = String(process.env.TELEGRAM_TEST_CHAT_ID || '').trim();
  if (!token || !chatId) {
    console.log('[cf-test] skipping telegram smoke (missing TELEGRAM_BOT_TOKEN or TELEGRAM_TEST_CHAT_ID)');
    return;
  }

  const txt = `CF worker smoke ${new Date().toISOString()}`;
  const send = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chatId), text: txt })
  });
  const sb = await send.json().catch(() => ({}));
  if (!send.ok || !sb.ok) throw new Error(`Telegram smoke failed: ${JSON.stringify(sb)}`);
  console.log('[cf-test] telegram sendMessage ok');
}

main().catch((e) => {
  console.error('[cf-test] failed:', e && e.message ? e.message : String(e));
  process.exit(1);
});
