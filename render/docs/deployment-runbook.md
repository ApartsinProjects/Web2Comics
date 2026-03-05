# Render/Cloudflare Bot Deployment Runbook

## 1) One-command automatic deployment

Use the new wrapper script:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

Targets:
- `--target render` (default)
- `--target cloudflare`
- `--target both`

Useful flags:
- `--with-render-smoke` run full-stack render smoke after deploy
- `--with-cloudflare-smoke` run cloudflare smoke after deploy
- `--skip-prechecks` skip `test:render:predeploy`
- `--skip-local-tests` skip `test:render:local`
- `--env-only` force secrets from environment only (recommended for CI/GitHub Actions)
- `--allow-partial-keys` optional override if you intentionally deploy without a full provider-key set

This wrapper calls the existing deployment automation:
- Render: `render/scripts/deploy-render-webhook.js`
- Cloudflare Worker: `cloudflare/scripts/deploy-worker.js`

## 2) GitHub Secrets (primary method)

Use repository/environment secrets as the source of truth.  
Do not keep long-lived keys in tracked files.

### Required GitHub secrets (minimum for Render deploy)
- `RENDER_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- provider keys (strict sync default):
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `HUGGINGFACE_INFERENCE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`

### Recommended GitHub secrets
- `TELEGRAM_NOTIFY_CHAT_ID`
- `TELEGRAM_TEST_CHAT_ID`
- `TELEGRAM_ADMIN_CHAT_IDS`
- `COMICBOT_ALLOWED_CHAT_IDS`
- `RENDER_OWNER_ID`
- `DATABASE_URL` (if using pre-provisioned Postgres)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `R2_S3_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `RENDER_PUBLIC_BASE_URL` (for remote full-stack tests)
- `TELEGRAM_TEST_CHAT_ID` (for smoke tests and deployment test routing)

### GitHub workflows
- Deploy: `.github/workflows/bot-deploy.yml`
- Test: `.github/workflows/bot-tests.yml`

Both workflows run with `BOT_SECRETS_ENV_ONLY=true`.

## 3) Required keys and where to get them

### Mandatory for Render deployment
- Render API key
  - Where to get: Render dashboard -> Account/Workspace API keys
  - Used as: `RENDER_API_KEY`
- Telegram bot token
  - Where to get: BotFather (`/newbot`)
  - Used as: `TELEGRAM_BOT_TOKEN`
- At least one provider key (Gemini recommended)
  - Gemini: https://aistudio.google.com/apikey -> `GEMINI_API_KEY`
  - OpenAI: https://platform.openai.com/api-keys -> `OPENAI_API_KEY`
  - OpenRouter: https://openrouter.ai/settings/keys -> `OPENROUTER_API_KEY`
  - Hugging Face: https://huggingface.co/settings/tokens -> `HUGGINGFACE_INFERENCE_API_TOKEN`

### Needed for R2-backed storage (recommended)
- Cloudflare account token (R2 API access)
  - Cloudflare dashboard -> API tokens
  - Used as: `CLOUDFLARE_API_TOKEN`
- Cloudflare account id
  - Used as: `CLOUDFLARE_ACCOUNT_ID`
- R2 S3 credentials
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_S3_ENDPOINT` (format: `https://<account_id>.r2.cloudflarestorage.com`)
  - `R2_BUCKET`

## 4) Where keys are stored (tests vs deployment)

### Primary (recommended)
- GitHub Secrets -> injected as environment variables in workflows and deploy runs.

### Optional local fallback (dev only)
- `.env.e2e.local`, `.telegram.yaml`, `.cloudflare.yaml`, `.aws.yaml` are still supported for local developer convenience.
- In CI/security mode use `BOT_SECRETS_ENV_ONLY=true` to disable YAML fallback.

### Deployment-time storage on target platforms
- Render deployment script writes service env vars directly to Render:
  - telegram, provider keys, postgres, R2 vars, admin/allowed ids
- Cloudflare deploy script writes worker secrets via `wrangler secret put`

### Runtime storage
- User config/secrets/state: Postgres (`RENDER_BOT_PG_URL`/`DATABASE_URL`)
- Request/crash/image artifacts: R2 prefixes (`logs/requests`, `crash-logs`, `images`)

## 5) Telegram admin ID provisioning

Admin ID controls admin commands like `/peek` and `/share`.

How to get Telegram user id:
- Easiest: message the bot and run `/user`
- Alternative: use `@userinfobot` in Telegram

Where it is configured:
- Deploy args: `--admin-chat-ids "123456789,..."` and `--allowed-chat-ids "..."`
- Env vars / GitHub Secrets:
  - `TELEGRAM_ADMIN_CHAT_IDS`
  - `COMICBOT_ALLOWED_CHAT_IDS`

## 6) Deployment flows

### Render only (recommended primary)
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

### Render + post-deploy smoke
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only --with-render-smoke
```

### Cloudflare worker only
```bash
npm run bot:deploy:auto -- --target cloudflare --env-only --with-cloudflare-smoke
```

### Both targets
```bash
npm run bot:deploy:auto -- --target both --branch engine --env-only --with-render-smoke --with-cloudflare-smoke
```

## 7) Test matrix by interface/API

### Local bot API (webhook + fake Telegram API)
```bash
npm run test:render:local
```

### Full local render suite
```bash
npm run test:render
```

### Live provider tests (Gemini)
```bash
set RUN_RENDER_REAL_GEMINI=1
npm run test:render:gemini-real
```

### Render remote service + Telegram + R2 full-stack API path
```bash
set RUN_FULL_STACK_E2E=true
npm run test:render:full-stack
```

### Cloudflare worker tests
```bash
npm run test:cloudflare
npm run test:cloudflare:smoke
```

### R2 real integration tests
```bash
set RUN_R2_E2E=true
npm run test:render:r2-real
```

## 8) Notes on automatic provisioning

Render deploy automation already does:
- create/reuse Render web service
- create/reuse Render Postgres
- create/reuse R2 bucket (if token/account available)
- validate R2 S3 write/read/delete probe
- sync env vars
- trigger deploy and wait for `live`
- register Telegram webhook with `drop_pending_updates=true`
