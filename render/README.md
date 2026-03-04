# Render Hobby Telegram Bot

This folder contains a Render-ready webhook bot deployment.

## What this version adds
- Webhook server for Render Web Service (`render/src/webhook-bot.js`)
- Runtime configuration commands via Telegram chat:
  - `/config`
  - `/presets`
  - `/vendor <name>`
  - `/text_vendor <name>`
  - `/image_vendor <name>`
  - `/language <code>`
  - `/panels <count>`
  - `/objective <name>`
  - `/style <preset>`
  - `/detail <low|medium|high>`
  - `/concurrency <1..5>`
  - `/retries <0..3>`
  - `/list_options`
  - `/options <path>`
  - `/choose <path> <number>`
  - `/set <path> <value>`
  - `/keys`
  - `/setkey <KEY> <VALUE>`
  - `/unsetkey <KEY>`
  - `/reset_config`
- Configurable provider keys in runtime state (or env vars)
- URL and text input support

## Deploy on Render (Hobby / Free web service)
1. Push this repo to GitHub.
2. In Render, create **Web Service** from the repo.
3. Use blueprint `render/render.yaml` or manually set:
   - Build: `npm install`
   - Start: `node render/src/webhook-bot.js`
4. Set env vars:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET` (random long string)
   - `DATABASE_URL` (Render Postgres connection string) or `RENDER_BOT_PG_URL`
   - optional: `RENDER_BOT_PG_TABLE` (default `render_bot_state`)
   - optional: `RENDER_BOT_PG_STATE_KEY` (default `runtime_config`)
   - provider key(s), e.g. `GEMINI_API_KEY`
   - `RENDER_PUBLIC_BASE_URL` = your Render service URL (e.g. `https://your-service.onrender.com`)
5. After deploy, set webhook:
   ```bash
   npm run render:set-webhook -- --url https://your-service.onrender.com
   ```
6. In Telegram, send `/start` to your bot.

## Minimal-participation automated deploy
Use the one-command deploy script:

```bash
npm run render:deploy:auto -- --render-api-key <RENDER_API_KEY>
```

What it automates:
- resolves owner/workspace ID (or uses `--owner-id`)
- creates or reuses a Render Postgres database (unless `--database-url` is provided)
- fetches Postgres internal connection string automatically
- creates the Render web service if missing
- updates env vars (token, webhook secret, provider keys, bot config paths)
- triggers deploy
- fetches service URL
- registers Telegram webhook

Inputs it can read automatically:
- `TELEGRAM_BOT_TOKEN` from `.telegram.yaml` or env
- provider keys from env (`GEMINI_API_KEY`, etc.)

Optional flags:
- `--service-name web2comics-telegram-render-bot`
- `--repo-url https://github.com/ApartsinProjects/Web2Comics`
- `--branch main`
- `--owner-id <workspace-id>`
- `--plan free`
- `--region oregon`
- `--allowed-chat-ids 12345,67890`
- `--database-url postgres://...`
- `--postgres-name web2comics-telegram-render-bot-db`
- `--postgres-plan free`
- `--postgres-version 16`
- `--postgres-region oregon`
- `--postgres-id <existing-postgres-id>`
- `--pg-table render_bot_state`
- `--pg-state-key runtime_config`

If service URL is not ready yet, run webhook setup later:

```bash
npm run render:set-webhook -- --url https://your-service.onrender.com
```

## Command model for non-technical configuration
The bot can be configured from chat.

Example flow:
1. `/presets` - show friendly configurable options.
2. `/vendor gemini` - set text+image provider + default models.
3. `/style manga` - set visual style prompt preset.
4. `/objective summarize` - set objective.
5. `/panels 4` - set panel count.
6. `/keys` - show provider key statuses.
7. `/setkey GEMINI_API_KEY <value>` - set key at runtime.

## Persistence behavior
- If `DATABASE_URL` or `RENDER_BOT_PG_URL` is set, runtime config is persisted in Postgres.
- If no Postgres URL is provided, fallback is local file `RENDER_BOT_STATE_FILE` (ephemeral on free services).

## Notes about Render free hobby web services
- Free services can spin down after inactivity.
- First request after idle can be slower.
- Local filesystem is ephemeral; avoid relying on file-only state for long-term persistence.

## Local test commands
```bash
npm run test:render
node --check render/src/webhook-bot.js
```

## Scripts
- `npm run render:start` - run webhook bot locally
- `npm run render:set-webhook -- --url <base-url>` - register Telegram webhook
- `npm run test:render` - run render-specific tests
