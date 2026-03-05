# Web2Comic Bot Deployment Runbook

## Scope
This runbook covers deployment of the Telegram webhook bot in `render/src/webhook-bot.js` with persistent storage in Cloudflare R2.

## 1) Prerequisites
- Node 20+
- Repo checked out and dependencies installed (`npm ci`)
- Telegram bot token from BotFather
- Render API key + owner id
- Cloudflare R2 bucket and S3 credentials
- At least one text/image provider key (Gemini recommended)

## 2) Required Secrets
Set these in GitHub Secrets (recommended) or local env for manual deployment.

- Core:
  - `RENDER_API_KEY`
  - `RENDER_OWNER_ID`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
- Telegram routing/admin:
  - `TELEGRAM_NOTIFY_CHAT_ID`
  - `TELEGRAM_TEST_CHAT_ID`
  - `TELEGRAM_ADMIN_CHAT_IDS`
  - `COMICBOT_ALLOWED_CHAT_IDS`
- Providers:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `HUGGINGFACE_INFERENCE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
- Storage/database:
  - `R2_S3_ENDPOINT`
  - `R2_BUCKET`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`

## 3) Secret Validation
Validate mapping and required env values before deploy:

```bash
npm run secrets:validate:deploy
npm run secrets:validate:deploy:ci
```

CI workflows also enforce these checks:
- `.github/workflows/bot-deploy.yml`
- `.github/workflows/bot-tests.yml`

## 4) Deploy Commands
Primary path:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

Useful variants:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only --with-render-smoke
npm run bot:deploy:auto -- --target cloudflare --env-only --with-cloudflare-smoke
npm run bot:deploy:auto -- --target both --branch engine --env-only --with-render-smoke --with-cloudflare-smoke
```

By default, `bot:deploy:auto` now runs a post-deploy sanity E2E check for Render (`render/scripts/postdeploy-sanity.js`).
Skip it only when needed:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only --skip-sanity
```

## 5) What Automation Performs
- Creates/reuses Render service
- Creates/reuses R2 bucket (if API token/account provided)
- Verifies R2 read/write/delete
- Syncs service environment variables
- Deploys service and waits for live status
- Registers Telegram webhook with `drop_pending_updates=true`

## 6) Post-Deploy Checks
- `GET /healthz` returns 200
- Send `/help` and `/about` in Telegram
- Send short text and verify:
  - prompt expansion notice for very short prompts
  - `/crazyness` value affects story invention intensity
  - panel delivery starts as soon as panels are generated
  - captions use `X(Y)` prefix format
  - panel image watermark appears bottom-right (`made with Web2Comics`)
  - messages/photos are forwardable (not content-protected)
- Send URL and verify URL rendering flow works
- Sanity script (automatic in deploy wrapper):
  - health endpoint check
  - webhook generation trigger
  - R2 request-log marker detection
  - R2 image growth (live provider path)
  - Telegram `sendMessage` API probe

## 7) Admin Provisioning
Admin id controls hidden commands.

- Get user id: send `/user` to bot
- Set admin list with `TELEGRAM_ADMIN_CHAT_IDS`
- Admin commands include:
  - `/peek`, `/peek<n>`
  - `/log`, `/log<n>`
  - `/users`
  - `/ban`, `/ban <user_id|username>`
  - `/unban <user_id|username>`
  - `/share <user_id>`

## 8) Rollback/Hotfix
- Re-run deploy with previous branch/commit
- Keep webhook secret stable unless rotation is required
- If rotated, redeploy and re-register webhook immediately
