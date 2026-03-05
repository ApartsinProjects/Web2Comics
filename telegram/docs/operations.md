# Bot Operations

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

Scope note:
- Operations guidance here is public and user-safe.
- Admin-only bot commands are intentionally excluded from published docs.

## Public Commands Relevant To Operations
- Health and onboarding: `/start`, `/welcome`, `/help`, `/version`, `/about`, `/user`, `/config`, `/explain`, `/debug`
- Live generation: text/URL message, `/invent`, `/random`, `/peek`
- Runtime controls: `/vendor`, `/text_vendor`, `/image_vendor`, `/models`, `/test`, `/panels`, `/objective`, objective shortcuts, `/style`, style shortcuts, `/new_style`, `/language`, `/mode`, `/consistency`, `/detail`, `/crazyness`, `/concurrency`, `/retries`
- Prompt/options: `/prompts`, `/set_prompt`, `/list_options`, `/options`
- Credentials/reset: `/keys`, `/setkey`, `/unsetkey`, `/reset_config`, `/restart`

## Health
- Service health endpoint:
  - `GET /healthz`

## Webhook
- Path:
  - `/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`
- Header validation:
  - `x-telegram-bot-api-secret-token`
- Dedup:
  - update IDs are deduplicated with TTL.

## Runtime behavior
- Immediate webhook ACK, processing continues asynchronously.
- Per-chat queue to avoid concurrent conflicts.
- Per-user config + secrets persisted in R2 state object.
- Banned users are blocked before allowlist evaluation.
- Panels are sent to Telegram progressively as they are generated.

## Secrets handling
- Secrets are redacted in user-facing responses.
- Keys can be set at runtime with `/setkey`.
- For CI/deploy hardening use `BOT_SECRETS_ENV_ONLY=true` so scripts use environment secrets only.

## Failure handling
- Fatal events (`uncaughtException`, `unhandledRejection`, startup failure) are persisted to crash storage.
- Generation/storage failures are reported back to chat.

## Useful scripts
- Start locally: `npm run telegram:start`
- Register webhook: `npm run telegram:set-webhook -- --url <base-url>`
- Auto deploy: `npm run telegram:deploy:auto`
