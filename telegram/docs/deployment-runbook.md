# Web2Comic Bot Deployment Runbook

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Extension docs home (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/>
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

## Scope
This runbook covers deployment of the Telegram webhook bot in `telegram/src/webhook-bot.js` with persistent storage in Cloudflare R2.

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
- Telegram routing:
  - `TELEGRAM_NOTIFY_CHAT_ID`
  - `TELEGRAM_TEST_CHAT_ID`
  - `COMICBOT_ALLOWED_CHAT_IDS`
- Providers:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `HUGGINGFACE_INFERENCE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_WORKERS_AI_TOKEN` (Cloudflare Workers AI provider token)
  - `CLOUDFLARE_ACCOUNT_API_TOKEN` (Cloudflare account token for R2 bucket API/provisioning)
  - `CLOUDFLARE_API_TOKEN` (compatibility alias; set to the same value as `CLOUDFLARE_WORKERS_AI_TOKEN`)
  - Do not use legacy `--cloudflare-api-token` deploy argument (deprecated and rejected)
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

Predeploy also enforces strict Cloudflare token roles:
- `CLOUDFLARE_WORKERS_AI_TOKEN` = Workers AI provider token
- `CLOUDFLARE_ACCOUNT_API_TOKEN` = Cloudflare account API token
- If `CLOUDFLARE_API_TOKEN` is set, it must match `CLOUDFLARE_WORKERS_AI_TOKEN`

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

By default, `bot:deploy:auto` now runs a post-deploy sanity E2E check for Render (`telegram/scripts/postdeploy-sanity.js`).
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
  - bot prints exact parsed URL before extraction (`Detected link, parsing page: <url>`)
- Sanity script (automatic in deploy wrapper):
  - health endpoint check
  - webhook generation trigger
  - R2 request-log marker detection
  - R2 image growth (live provider path)
  - Telegram `sendMessage` API probe

## 7) Rollback/Hotfix
- Re-run deploy with previous branch/commit
- Keep webhook secret stable unless rotation is required
- If rotated, redeploy and re-register webhook immediately
