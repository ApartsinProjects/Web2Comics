const path = require('path');
const { getRuntimeConfig } = require('./config');
const { TelegramApi } = require('./telegram-api');
const { generateComicForMessage } = require('./comic-runner');

function isAllowedChat(chatId, allowedChatIds) {
  if (!Array.isArray(allowedChatIds) || allowedChatIds.length === 0) return true;
  const id = Number(chatId);
  return allowedChatIds.includes(id);
}

function helpText(runtime) {
  return [
    'Send me either:',
    '- plain text story',
    '- full URL starting with http:// or https://',
    '',
    'I will generate a comic image and send it back.',
    '',
    `Engine config: ${runtime.engineConfigPath}`
  ].join('\n');
}

async function handleMessage(api, runtime, message) {
  const chatId = Number(message?.chat?.id || 0);
  const text = String(message?.text || '').trim();
  if (!chatId) return;

  if (!isAllowedChat(chatId, runtime.allowedChatIds)) {
    await api.sendMessage(chatId, 'Access denied for this bot instance.');
    return;
  }

  if (!text) {
    await api.sendMessage(chatId, 'Please send text or URL. Use /help for usage.');
    return;
  }

  if (text === '/start' || text === '/help') {
    await api.sendMessage(chatId, helpText(runtime));
    return;
  }

  if (text === '/config') {
    await api.sendMessage(
      chatId,
      [
        `Engine config: ${runtime.engineConfigPath}`,
        `Out dir: ${runtime.outDir}`,
        `Debug artifacts: ${runtime.debugArtifacts ? 'on' : 'off'}`,
        `Allowed chat IDs: ${runtime.allowedChatIds.length ? runtime.allowedChatIds.join(', ') : '(all)'}`
      ].join('\n')
    );
    return;
  }

  await api.sendChatAction(chatId, 'upload_photo');
  await api.sendMessage(chatId, 'Generating your comic...');

  try {
    const result = await generateComicForMessage(text, runtime);
    const caption = [
      `Done: ${result.kind === 'url' ? 'URL' : 'text'} -> comic`,
      `Panels: ${result.panelCount}`,
      `Time: ${(Number(result.elapsedMs || 0) / 1000).toFixed(1)}s`
    ].join('\n');
    await api.sendPhoto(chatId, result.outputPath, caption);
  } catch (error) {
    const messageText = error && error.message ? error.message : String(error);
    await api.sendMessage(chatId, `Generation failed: ${messageText}`);
  }
}

async function startPolling() {
  const runtime = getRuntimeConfig();
  const api = new TelegramApi(runtime.botToken);
  let offset = 0;

  console.log('[comicbot] started');
  console.log('[comicbot] config:', runtime.engineConfigPath);

  while (true) {
    try {
      const updates = await api.getUpdates(offset, runtime.pollTimeoutSec);
      for (const update of updates || []) {
        const id = Number(update?.update_id || 0);
        if (id >= offset) offset = id + 1;
        if (!update?.message) continue;
        await handleMessage(api, runtime, update.message);
      }
    } catch (error) {
      console.error('[comicbot] polling error:', error && error.message ? error.message : String(error));
      await new Promise((r) => setTimeout(r, Math.max(1500, runtime.pollIntervalMs)));
    }
  }
}

startPolling().catch((error) => {
  console.error('[comicbot] fatal:', error && error.message ? error.message : String(error));
  process.exit(1);
});
