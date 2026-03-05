# Cloudflare Worker Telegram Bot

This folder contains the Cloudflare Workers deployment for Web2Comics Telegram bot.

## Architecture
- Runtime: Cloudflare Worker (`src/worker.mjs`)
- Per-user state + dedup keys: KV (`STATE_KV`)
- Persistent logs + generated images + status: R2 (`BOT_R2`)
- Webhook endpoint: `POST /telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`
- Health endpoint: `GET /healthz`

The worker acknowledges webhook quickly and processes update in `waitUntil`, reducing Telegram retries.

## Commands
- `/help`
- `/user`
- `/config`
- `/panels <1..6>`
- `/style <text>`
- `/setkey GEMINI_API_KEY <value>`
- `/unsetkey GEMINI_API_KEY`
- `/restart`
- `/share <user_id>` (admin only)

## Deploy (automated)
Prerequisites:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- optional `GEMINI_API_KEY`
- optional `CLOUDFLARE_WORKER_URL` (auto-detected from deploy output if omitted)
- recommended: `BOT_SECRETS_ENV_ONLY=true` in CI

Run:

```bash
node cloudflare/scripts/deploy-worker.js
```

What it does:
1. Ensures KV/R2 resources and bindings exist.
2. Ensures Durable Object lock coordinator config exists (`WRITE_LOCKS` + migration).
3. Uploads Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, optional `LOCK_SERVICE_TOKEN`).
4. Deploys worker with Wrangler (applies DO migration automatically).
5. Calls Telegram `setWebhook` with `drop_pending_updates=true`.

### Durable Object lock endpoint
- Acquire: `POST /locks/acquire`
- Release: `POST /locks/release`
- Optional auth: header `x-lock-token` must match Worker secret `LOCK_SERVICE_TOKEN` (if set).

## Smoke test

```bash
node cloudflare/scripts/smoke-test.js
```

Optional Telegram test vars:
- `TELEGRAM_TEST_CHAT_ID` (recommended: your own user id)
- `TELEGRAM_BOT_TOKEN`

## Storage behavior
- Every request/generation is logged in R2 under `logs/requests/`.
- Worker errors are logged in R2 under `logs/crash/` + pointer `logs/crash/latest.json`.
- Generated panel images are stored under `images/<chatId>/`.
- `status/images.json` keeps cumulative size.
- When cumulative size reaches threshold (default 50% of 10GB), all historical `images/` objects are deleted before writing new ones.
