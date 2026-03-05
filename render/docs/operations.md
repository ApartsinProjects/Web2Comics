# Bot Operations

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
- Start locally: `npm run render:start`
- Register webhook: `npm run render:set-webhook -- --url <base-url>`
- Auto deploy: `npm run render:deploy:auto`

## Admin command operations
- `/peek` list last generated comics, `/peek<n>` view one.
- `/users` list known users.
- `/ban` list blacklist, `/ban <user_id|username>` add block.
- `/unban <user_id|username>` remove block.
