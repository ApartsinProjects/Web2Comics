import {
  addGlobalHistory,
  buildHelp,
  classifyIncoming,
  getUserState,
  isAdmin,
  isAllowed,
  onboardingMessage,
  panelCaption,
  parsePanelCount,
  putUserState,
  resolveTelegramToken,
  resolveWebhookSecret,
  sanitizeForTelegram,
  splitCommand,
  storeCrashLog,
  storeRequestLog,
  stripHtmlToText,
  trackStoredImage
} from './lib.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function tgFetch(env, method, payload, isMultipart = false) {
  const token = resolveTelegramToken(env);
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const init = isMultipart
    ? { method: 'POST', body: payload }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) };
  const res = await fetch(url, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(`${method} failed: ${out.description || res.statusText}`);
  return out.result;
}

async function sendMessage(env, chatId, text, extra = {}) {
  return tgFetch(env, 'sendMessage', { chat_id: chatId, text: sanitizeForTelegram(text), ...extra });
}

async function sendChatAction(env, chatId, action = 'typing') {
  try {
    await tgFetch(env, 'sendChatAction', { chat_id: chatId, action });
  } catch (_) {}
}

async function sendPhotoBytes(env, chatId, bytes, caption) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', sanitizeForTelegram(caption || ''));
  fd.append('photo', new Blob([bytes], { type: 'image/png' }), 'panel.png');
  return tgFetch(env, 'sendPhoto', fd, true);
}

function textFromGeminiResponse(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => typeof p?.text === 'string');
  return String(textPart?.text || '').trim();
}

function imageFromGeminiResponse(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p?.inlineData?.data);
  if (!img) return null;
  const b64 = String(img.inlineData.data || '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function geminiGenerateText(apiKey, model, prompt, temperature = 0.6) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: { temperature },
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini text failed: ${json?.error?.message || res.statusText}`);
  const out = textFromGeminiResponse(json);
  if (!out) throw new Error('Gemini text returned empty output');
  return out;
}

async function geminiGenerateImage(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini image failed: ${json?.error?.message || res.statusText}`);
  const bytes = imageFromGeminiResponse(json);
  if (!bytes) throw new Error('Gemini image response did not include image bytes');
  return bytes;
}

function parseStoryboardPanels(text, fallbackCount) {
  const clean = String(text || '').trim();
  try {
    const jsonStart = clean.indexOf('[');
    const jsonEnd = clean.lastIndexOf(']');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.slice(0, 6).map((p, idx) => ({
          index: idx + 1,
          caption: String(p.caption || `Panel ${idx + 1}`),
          beat: String(p.beat || ''),
          imagePrompt: String(p.imagePrompt || p.prompt || p.caption || `Comic panel ${idx + 1}`)
        }));
      }
    }
  } catch (_) {}

  const lines = clean.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, fallbackCount);
  if (lines.length) {
    return lines.map((line, idx) => ({
      index: idx + 1,
      caption: line.slice(0, 120),
      beat: '',
      imagePrompt: line
    }));
  }

  return Array.from({ length: fallbackCount }, (_, idx) => ({
    index: idx + 1,
    caption: `Panel ${idx + 1}`,
    beat: '',
    imagePrompt: `Comic panel ${idx + 1}`
  }));
}

async function extractInputText(content) {
  const t = String(content || '').trim();
  if (/^https?:\/\//i.test(t)) {
    const res = await fetch(t, { method: 'GET' });
    if (!res.ok) throw new Error(`URL fetch failed (${res.status})`);
    const html = await res.text();
    const text = stripHtmlToText(html).slice(0, 12000);
    if (!text) throw new Error('Fetched URL has no usable text');
    return { kind: 'url', text, source: t };
  }
  return { kind: 'text', text: t, source: 'text' };
}

async function handleCommand(env, chatId, state, text) {
  const parts = splitCommand(text);
  const cmd = String(parts[0] || '').toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    await sendMessage(env, chatId, buildHelp(isAdmin(chatId, env)));
    return true;
  }
  if (cmd === '/user') {
    await sendMessage(env, chatId, `Your user id: ${chatId}`);
    return true;
  }
  if (cmd === '/config') {
    await sendMessage(env, chatId, `Config:\n- panels: ${state.config.panelCount}\n- style: ${state.config.stylePrompt}\n- vendor: ${state.config.vendor}`);
    return true;
  }
  if (cmd === '/panels') {
    const n = parsePanelCount(parts[1]);
    if (!n) {
      await sendMessage(env, chatId, 'Usage: /panels <1..6>');
      return true;
    }
    state.config.panelCount = n;
    await sendMessage(env, chatId, `Updated panels: ${n}`);
    return true;
  }
  if (cmd === '/style') {
    const style = parts.slice(1).join(' ').trim();
    if (!style) {
      await sendMessage(env, chatId, 'Usage: /style <text>');
      return true;
    }
    state.config.stylePrompt = style.slice(0, 240);
    await sendMessage(env, chatId, 'Updated style prompt.');
    return true;
  }
  if (cmd === '/vendor') {
    const v = String(parts[1] || '').toLowerCase();
    if (v !== 'gemini') {
      await sendMessage(env, chatId, 'Cloudflare Worker mode currently supports: gemini');
      return true;
    }
    state.config.vendor = 'gemini';
    await sendMessage(env, chatId, 'Vendor set to gemini.');
    return true;
  }
  if (cmd === '/setkey') {
    const key = String(parts[1] || '').trim();
    const value = parts.slice(2).join(' ').trim();
    if (key !== 'GEMINI_API_KEY' || !value) {
      await sendMessage(env, chatId, 'Usage: /setkey GEMINI_API_KEY <value>');
      return true;
    }
    state.secrets.GEMINI_API_KEY = value;
    await sendMessage(env, chatId, 'Stored GEMINI_API_KEY in user runtime state.');
    return true;
  }
  if (cmd === '/unsetkey') {
    const key = String(parts[1] || '').trim();
    if (key !== 'GEMINI_API_KEY') {
      await sendMessage(env, chatId, 'Usage: /unsetkey GEMINI_API_KEY');
      return true;
    }
    delete state.secrets.GEMINI_API_KEY;
    await sendMessage(env, chatId, 'Removed GEMINI_API_KEY override.');
    return true;
  }
  if (cmd === '/restart') {
    state.seen = false;
    state.sharedFrom = '';
    state.secrets = {};
    state.config.panelCount = Number(env.DEFAULT_PANELS || 3);
    state.config.stylePrompt = 'clean comic panel art, coherent scene progression';
    state.config.vendor = 'gemini';
    await sendMessage(env, chatId, 'State reset to defaults.');
    await sendMessage(env, chatId, onboardingMessage());
    return true;
  }
  if (cmd === '/share') {
    if (!isAdmin(chatId, env)) {
      await sendMessage(env, chatId, 'Access denied.');
      return true;
    }
    const target = Number.parseInt(String(parts[1] || ''), 10);
    if (!Number.isFinite(target) || target <= 0) {
      await sendMessage(env, chatId, 'Usage: /share <user_id>');
      return true;
    }
    const targetState = await getUserState(env.STATE_KV, String(target));
    targetState.sharedFrom = String(chatId);
    await putUserState(env.STATE_KV, String(target), targetState);
    await sendMessage(env, chatId, `Shared your keys with user ${target}.`);
    return true;
  }

  return false;
}

function resolveGeminiKey(env, state) {
  if (state?.secrets?.GEMINI_API_KEY) return String(state.secrets.GEMINI_API_KEY);
  if (state?.sharedFrom) return '';
  return String(env.GEMINI_API_KEY || '').trim();
}

async function processMessage(env, message) {
  const chatId = Number(message?.chat?.id || 0);
  const text = String(message?.text || message?.caption || '').trim();
  if (!chatId) return;

  if (!isAllowed(chatId, env)) {
    await sendMessage(env, chatId, 'Access denied for this bot instance.');
    return;
  }

  const userId = String(chatId);
  const state = await getUserState(env.STATE_KV, userId);

  if (!state.seen) {
    state.seen = true;
    await sendMessage(env, chatId, onboardingMessage());
  }

  const input = classifyIncoming(text);
  if (input.kind === 'empty') {
    await sendMessage(env, chatId, 'Unsupported message format. Send plain text or URL.');
    await putUserState(env.STATE_KV, userId, state);
    return;
  }

  const commandHandled = input.kind === 'command' ? await handleCommand(env, chatId, state, text) : false;
  await putUserState(env.STATE_KV, userId, state);
  if (commandHandled) return;

  const sharedState = state.sharedFrom ? await getUserState(env.STATE_KV, state.sharedFrom) : null;
  const geminiKey = resolveGeminiKey(env, state) || String(sharedState?.secrets?.GEMINI_API_KEY || '').trim();
  if (!geminiKey) {
    await sendMessage(env, chatId, 'Missing GEMINI_API_KEY. Use /setkey GEMINI_API_KEY <value>.');
    return;
  }

  await sendChatAction(env, chatId, 'upload_photo');
  await sendMessage(env, chatId, 'Generating your comic panels...');

  const extracted = await extractInputText(text);
  const prompt = [
    'Create a concise comic storyboard as JSON array.',
    'Each item: {"caption":"...","beat":"...","imagePrompt":"..."}',
    `Panel count: ${state.config.panelCount}`,
    `Language: ${state.config.language}`,
    `Objective: ${state.config.objective}`,
    `Style: ${state.config.stylePrompt}`,
    'Story source:',
    extracted.text
  ].join('\n');

  const storyboardRaw = await geminiGenerateText(geminiKey, state.config.textModel, prompt, 0.85);
  const panels = parseStoryboardPanels(storyboardRaw, state.config.panelCount).slice(0, state.config.panelCount);

  for (const panel of panels) {
    const imgPrompt = `${state.config.stylePrompt}. ${panel.imagePrompt}`;
    const bytes = await geminiGenerateImage(geminiKey, state.config.imageModel, imgPrompt);
    const key = `images/${chatId}/${Date.now()}-${panel.index}.png`;
    if (env.BOT_R2) {
      await env.BOT_R2.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
      await trackStoredImage(env, bytes.byteLength || bytes.length || 0);
    }
    await sendPhotoBytes(env, chatId, bytes, panelCaption(panel.index, panel.caption, panel.beat));
  }

  await sendMessage(env, chatId, `Done: ${extracted.kind} -> comic panels (${panels.length})`);
  await addGlobalHistory(env.STATE_KV, {
    timestamp: new Date().toISOString(),
    chatId,
    requestText: text.slice(0, 1000),
    config: state.config,
    result: { ok: true, type: 'generation', panelCount: panels.length }
  });
  await storeRequestLog(env, {
    chatId,
    kind: extracted.kind,
    requestText: text.slice(0, 1000),
    panelCount: panels.length
  });
}

async function processUpdate(env, update) {
  if (!update?.message) return;
  await processMessage(env, update.message);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const secret = resolveWebhookSecret(env);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json({ ok: true, service: 'web2comics-cf-worker' });
    }

    if (!secret) {
      await storeCrashLog(env, { event: 'startupFailure', error: { message: 'Missing TELEGRAM_WEBHOOK_SECRET' } });
      return json({ ok: false, error: 'missing webhook secret' }, 500);
    }

    if (request.method === 'POST' && url.pathname === `/telegram/webhook/${secret}`) {
      const headerSecret = String(request.headers.get('x-telegram-bot-api-secret-token') || '');
      if (headerSecret !== secret) return json({ ok: false, error: 'invalid secret token' }, 403);

      let update;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: 'invalid json' }, 400);
      }

      const updateId = Number(update?.update_id);
      if (Number.isFinite(updateId)) {
        const dedupKey = `upd:${updateId}`;
        const seen = await env.STATE_KV.get(dedupKey);
        if (seen) return json({ ok: true, duplicate: true });
        await env.STATE_KV.put(dedupKey, '1', { expirationTtl: 900 });
      }

      ctx.waitUntil((async () => {
        try {
          await processUpdate(env, update);
        } catch (error) {
          await storeCrashLog(env, {
            event: 'updateFailure',
            error: { message: String(error?.message || error), stack: String(error?.stack || '') },
            updateId: update?.update_id || null
          });
          const chatId = Number(update?.message?.chat?.id || 0);
          if (chatId) {
            await sendMessage(env, chatId, `Generation failed: ${String(error?.message || error)}`);
          }
        }
      })());

      return json({ ok: true, queued: true });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
