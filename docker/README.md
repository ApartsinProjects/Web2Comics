# Docker Deployment (Render)

This folder provides an alternative Docker-based deployment path for the Telegram webhook service.

## Artifacts

- `docker/Dockerfile` - production image with Playwright + Chromium support.
- `docker/render.yaml` - Render blueprint configured for Docker runtime.
- `docker/deploy-render-docker.js` - API deployment script for Render Docker runtime.

## Local build/run

```bash
npm run docker:build:bot
npm run docker:run:bot
```

## Secrets in Docker (recommended)

Use secret files instead of plain env values. The bot supports:

- `<KEY>_FILE` env vars (for example `TELEGRAM_BOT_TOKEN_FILE=/run/secrets/telegram_bot_token`)
- fallback lookup in `/run/secrets/<key>` and `/run/secrets/<key-lowercase>`

Example sensitive keys:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `HUGGINGFACE_INFERENCE_API_TOKEN`
- `CLOUDFLARE_WORKERS_AI_TOKEN`
- `CLOUDFLARE_ACCOUNT_API_TOKEN`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Example `docker run` with secret files mounted:

```bash
docker run --rm -p 10000:10000 \
  -v $PWD/docker/secrets:/run/secrets:ro \
  -e TELEGRAM_BOT_TOKEN_FILE=/run/secrets/telegram_bot_token \
  -e TELEGRAM_WEBHOOK_SECRET_FILE=/run/secrets/telegram_webhook_secret \
  -e R2_ACCESS_KEY_ID_FILE=/run/secrets/r2_access_key_id \
  -e R2_SECRET_ACCESS_KEY_FILE=/run/secrets/r2_secret_access_key \
  web2comics-telegram-bot:local
```

## Deploy to Render (Docker runtime)

```bash
npm run telegram:deploy:docker -- --render-api-key <RENDER_API_KEY>
```

Optional:

```bash
npm run telegram:deploy:docker -- \
  --render-api-key <RENDER_API_KEY> \
  --service-name web2comics-telegram-render-bot \
  --branch engine \
  --repo-url https://github.com/ApartsinProjects/Web2Comics
```

The deploy script configures:

- Render runtime: `docker`
- Dockerfile path: `docker/Dockerfile`
- Docker command: `node telegram/src/webhook-bot.js`
- Required bot/runtime env vars (Telegram, R2, provider keys if present)
- Telegram webhook registration (`setWebhook`) after deploy

For Render, store secrets in Render Environment settings (secret values) and do not commit key files.
