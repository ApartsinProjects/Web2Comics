const path = require('path');
const { loadEnvFiles } = require('./env');

const repoRoot = path.resolve(__dirname, '../..');
loadEnvFiles([
  path.join(repoRoot, '.env.e2e.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, 'comicbot/.env'),
  path.join(repoRoot, 'telegram/.env')
]);

function parseArgs(argv) {
  const out = { url: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url' || a === '-u') out.url = argv[++i] || '';
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const publicBase = String(args.url || process.env.RENDER_PUBLIC_BASE_URL || '').trim();

  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  if (!secret) throw new Error('Missing TELEGRAM_WEBHOOK_SECRET');
  if (!publicBase) throw new Error('Provide --url or RENDER_PUBLIC_BASE_URL');

  const webhookUrl = `${publicBase.replace(/\/+$/, '')}/telegram/webhook/${secret}`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true
    })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(json)}`);
  }

  console.log('Webhook set successfully:');
  console.log(webhookUrl);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
