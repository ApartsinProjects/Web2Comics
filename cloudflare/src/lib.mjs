export const DEFAULT_USER_STATE = {
  seen: false,
  sharedFrom: '',
  secrets: {},
  config: {
    panelCount: 3,
    stylePrompt: 'clean comic panel art, coherent scene progression',
    objective: 'summarize',
    language: 'en',
    vendor: 'gemini',
    textModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.0-flash-exp-image-generation'
  }
};

export function classifyIncoming(text) {
  const t = String(text || '').trim();
  if (!t) return { kind: 'empty' };
  if (t.startsWith('/')) return { kind: 'command' };
  if (/^https?:\/\//i.test(t)) return { kind: 'url' };
  return { kind: 'text' };
}

export function splitCommand(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

export async function kvGetJson(kv, key, fallback = null) {
  if (!kv) return fallback;
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function kvPutJson(kv, key, value, options = {}) {
  if (!kv) return;
  await kv.put(key, JSON.stringify(value), options);
}

export function sanitizeForTelegram(text) {
  return String(text || '').replace(/\u0000/g, '').slice(0, 4000);
}

export function stripHtmlToText(html) {
  const raw = String(html || '');
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function panelCaption(index, caption, beat) {
  const c = String(caption || '').trim();
  const b = String(beat || '').trim();
  if (!b) return `${index}. ${c}`.slice(0, 1000);
  return `${index}. ${c}\n${b}`.slice(0, 1000);
}

export function buildHelp(isAdmin) {
  const lines = [
    'Web2Comics Cloudflare Worker Bot',
    '',
    'Send text or URL to generate comic panels.',
    '',
    'Commands:',
    '/help',
    '/user',
    '/config',
    '/panels <1..6>',
    '/style <text>',
    '/setkey GEMINI_API_KEY <value>',
    '/unsetkey GEMINI_API_KEY',
    '/restart'
  ];
  if (isAdmin) lines.push('/share <user_id> (admin)');
  return lines.join('\n');
}

export function onboardingMessage() {
  return [
    'Welcome to Web2Comics.',
    'Add your Gemini key first:',
    'https://aistudio.google.com/apikey',
    'Command: /setkey GEMINI_API_KEY <YOUR_KEY>',
    'Then send text or URL.'
  ].join('\n');
}

export function parsePanelCount(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n) || n < 1 || n > 6) return null;
  return n;
}

export function resolveTelegramToken(env) {
  return String(env.TELEGRAM_BOT_TOKEN || '').trim();
}

export function resolveWebhookSecret(env) {
  return String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}

export function isAdmin(chatId, env) {
  const ids = String(env.ADMIN_CHAT_IDS || '')
    .split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
  return ids.includes(Number(chatId));
}

export function isAllowed(chatId, env) {
  if (isAdmin(chatId, env)) return true;
  const ids = String(env.ALLOWED_CHAT_IDS || '')
    .split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
  if (!ids.length) return true;
  return ids.includes(Number(chatId));
}

export async function addGlobalHistory(kv, item) {
  const key = 'global:history';
  const history = (await kvGetJson(kv, key, [])) || [];
  history.push(item);
  const trimmed = history.slice(-20);
  await kvPutJson(kv, key, trimmed);
}

export async function getUserState(kv, userId) {
  const key = `user:${userId}`;
  const existing = await kvGetJson(kv, key, null);
  if (existing && typeof existing === 'object') return { ...DEFAULT_USER_STATE, ...existing, config: { ...DEFAULT_USER_STATE.config, ...(existing.config || {}) }, secrets: { ...(existing.secrets || {}) } };
  return structuredClone(DEFAULT_USER_STATE);
}

export async function putUserState(kv, userId, state) {
  await kvPutJson(kv, `user:${userId}`, state);
}

export async function storeCrashLog(env, payload) {
  const bucket = env.BOT_R2;
  if (!bucket) return;
  const ts = new Date().toISOString();
  const key = `logs/crash/${ts.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.json`;
  const body = JSON.stringify({ ...payload, createdAt: ts });
  await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  await bucket.put('logs/crash/latest.json', JSON.stringify({ key, createdAt: ts }), { httpMetadata: { contentType: 'application/json' } });
}

export async function storeRequestLog(env, payload) {
  const bucket = env.BOT_R2;
  if (!bucket) return;
  const ts = new Date().toISOString();
  const key = `logs/requests/${ts.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.json`;
  await bucket.put(key, JSON.stringify({ ...payload, createdAt: ts }), { httpMetadata: { contentType: 'application/json' } });
}

export async function loadImageStatus(env) {
  const capacityBytes = Math.max(1, Number(env.IMAGE_CAPACITY_BYTES || (10 * 1024 * 1024 * 1024)));
  const thresholdRatio = Math.max(0.01, Math.min(1, Number(env.IMAGE_CLEANUP_THRESHOLD_RATIO || 0.5)));
  const thresholdBytes = Math.floor(capacityBytes * thresholdRatio);
  const base = { capacityBytes, thresholdRatio, thresholdBytes, totalBytes: 0, imageCount: 0, lastUpdatedAt: '', lastCleanupAt: '' };
  if (!env.BOT_R2) return base;
  const obj = await env.BOT_R2.get('status/images.json');
  if (!obj) return base;
  try {
    const parsed = await obj.json();
    return { ...base, ...(parsed || {}) };
  } catch {
    return base;
  }
}

export async function deleteAllR2Images(env) {
  if (!env.BOT_R2) return;
  let cursor;
  do {
    const listed = await env.BOT_R2.list({ prefix: 'images/', cursor });
    if (listed.objects.length) {
      await Promise.all(listed.objects.map((obj) => env.BOT_R2.delete(obj.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function trackStoredImage(env, byteLength) {
  if (!env.BOT_R2) return;
  let status = await loadImageStatus(env);
  if (status.totalBytes >= status.thresholdBytes) {
    await deleteAllR2Images(env);
    status = { ...status, totalBytes: 0, imageCount: 0, lastCleanupAt: new Date().toISOString() };
  }
  status.totalBytes += Math.max(0, Number(byteLength || 0));
  status.imageCount += 1;
  status.lastUpdatedAt = new Date().toISOString();
  await env.BOT_R2.put('status/images.json', JSON.stringify(status), { httpMetadata: { contentType: 'application/json' } });
}
