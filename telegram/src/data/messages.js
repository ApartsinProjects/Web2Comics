const BOT_DISPLAY_NAME = 'Web2Comic';
const BOT_SHORT_DESCRIPTION = 'AI comic maker from text or URL.';
const BOT_COLD_START_NOTICE = 'I just woke up. First response may take a bit longer.';

const REPO_DOCS_BASE_URL = 'https://github.com/ApartsinProjects/Web2Comics/tree/main/telegram';
const PROMPT_MANUAL_URL = `${REPO_DOCS_BASE_URL}/docs/deployment-runbook.md`;

function buildOnboardingMessage(chatId, options = {}) {
  const isAdmin = Boolean(options.isAdmin);
  const lines = [
    `Welcome to ${BOT_DISPLAY_NAME}.`,
    BOT_SHORT_DESCRIPTION,
    '',
    'Fastest way to start:',
    '1) Run /user',
    '2) Send your ID to Sasha and ask for shared key access',
    '',
    'Or go solo with a free Gemini key:',
    '1) Get key: https://aistudio.google.com/apikey',
    `2) How-to: ${PROMPT_MANUAL_URL}`,
    '3) Set it: /setkey GEMINI_API_KEY <YOUR_KEY>',
    '4) Verify: /keys',
    '',
    'Once connected, useful commands:',
    '/help  /config  /vendor <name>  /panels <count>  /style <preset>'
  ];
  if (isAdmin) {
    lines.push('');
    lines.push('Admin commands:');
    lines.push('/peek  /peek<n>  /log  /log<n>  /users  /ban  /unban  /share <user_id>');
  }
  return lines.join('\n');
}

function buildHelpMessage(chatId, options = {}) {
  const isAdmin = Boolean(options.isAdmin);
  const objectiveShortcutLines = Array.isArray(options.objectiveShortcutLines) ? options.objectiveShortcutLines : [];
  const styleShortcutLines = Array.isArray(options.styleShortcutLines) ? options.styleShortcutLines : [];
  const lines = [
    BOT_DISPLAY_NAME,
    BOT_SHORT_DESCRIPTION,
    '',
    'Send plain text or URL to generate a comic.',
    '',
    'Commands:',
    '/start - show welcome message.',
    '/help - show this command reference.',
    '/welcome - show welcome message again.',
    '/about - creator and project links.',
    '/version - bot version and timestamps.',
    '/user - show your Telegram user id.',
    '/config - show your active configuration.',
    '/explain - explain the compact generation summary line.',
    '/debug <on|off> - toggle image prompt debug messages.',
    '/invent <story> - expand your seed story with AI and generate comic.',
    '/random - generate a fully random story and make a comic.',
    '/panels <count> - set panel count.',
    '/objective [name] - list or set objective.',
    '/objectives - list all objectives with descriptions.',
    ...objectiveShortcutLines,
    '/style <preset-or-your-style> - set visual style.',
    ...styleShortcutLines,
    '/new_style <name> <text> - save a custom named style.',
    '/language <code> - set output language.',
    '/extractor <gemini|firecrawl|jina|chromium> - set URL story extraction vendor.',
    '/mode <default|media_group|single> - set delivery mode.',
    '/consistency <on|off> - toggle reference-style consistency flow.',
    '/detail <low|medium|high> - set output detail level.',
    '/crazyness <0..2> - set story invention temperature.',
    '/concurrency <1..5> - set parallel image generation.',
    '/retries <0..3> - set provider retry attempts.',
    '/vendor <name> - set both text/image provider.',
    '/text_vendor <name> - set text provider only.',
    '/image_vendor <name> - set image provider only.',
    '/models [text|image] [model] - list/set model for current provider.',
    '/test - probe provider/model availability and print report.',
    '/prompts - print active prompt templates and objective overrides.',
    '/set_prompt story <text> - override story prompt.',
    '/set_prompt panel <text> - override panel prompt fragment.',
    '/set_prompt objective <name> <text> - override objective prompt.',
    '/keys - show key status.',
    '/setkey <KEY> <VALUE> - set key in runtime profile.',
    '/unsetkey <KEY> - clear key from runtime profile.',
    '/options <path> - show allowed values for a config path.',
    '/list_options - list config paths with predefined choices.',
    '/reset_config - clear all runtime config overrides.',
    '/restart - reset your profile to defaults.',
    '',
    'Provider key links (Gemini free first):',
    '- Gemini: https://aistudio.google.com/apikey',
    '- OpenAI: https://platform.openai.com/api-keys',
    '- OpenRouter: https://openrouter.ai/settings/keys',
    '- Cloudflare: https://dash.cloudflare.com/profile/api-tokens',
    '- Hugging Face: https://huggingface.co/settings/tokens',
    '',
    `Docs: ${REPO_DOCS_BASE_URL}/docs`
  ];
  if (isAdmin) {
    lines.push('');
    lines.push('Admin commands:');
    lines.push('/peek - list latest generated comics.');
    lines.push('/peek <n> or /peek<n> - show one comic from the latest list.');
    lines.push('/log, /log <n>, /log<n> - list latest interaction logs.');
    lines.push('/users - list known users.');
    lines.push('/ban - list banned users.');
    lines.push('/ban <user_id|username> - ban user.');
    lines.push('/unban <user_id|username> - unban user.');
    lines.push('/share <user_id> - allow a user to use your runtime keys.');
    lines.push('/watermark <on|off> - set global panel watermark.');
    lines.push('/echo <on|off> - test mode input echo.');
  }
  return lines.join('\n');
}

module.exports = {
  BOT_DISPLAY_NAME,
  BOT_SHORT_DESCRIPTION,
  BOT_COLD_START_NOTICE,
  REPO_DOCS_BASE_URL,
  PROMPT_MANUAL_URL,
  buildOnboardingMessage,
  buildHelpMessage
};
