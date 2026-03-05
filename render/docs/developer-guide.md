# Web2Comic Bot Developer Guide

## Architecture
- Entry point: `render/src/webhook-bot.js`
- Generator bridge: `render/src/generate.js`
- Shared engine: `engine/src/*`
- Runtime state/config: `render/src/config-store.js`
- Persistence adapters: `render/src/persistence.js` + request/crash log stores

Processing model:
- Webhook handler ACKs immediately
- Update is enqueued per chat id
- One active job per chat queue preserves per-user order

## Input Classification
Input from `message.text` or `message.caption` is classified as:
- command
- url
- text
- empty/unsupported

URL flow snapshots rendered page HTML before generation.

## Generation Pipeline
1. Resolve effective per-user config
2. Apply secrets (runtime/shared/env)
3. Build storyboard with text provider
4. Generate panel images
5. Stream panel sends to Telegram as each panel becomes ready
6. Send final completion summary

Important behavior:
- Panel captions in chat use `X(Y)` prefix
- Image prompt explicitly forbids rendering caption text inside artwork

## Command System
Primary command handling is in `handleCommand`.

Notable UX behavior:
- `/objective` without args lists all objectives
- `/options` and `/choose` without args explain valid paths/options
- `/keys` and `/credentials` are aliases

Admin-only commands:
- `/peek`, `/peek<n>`
- `/log`, `/log<n>`
- `/users`
- `/ban`, `/unban`
- `/share`

## Blacklist Model
Blacklist is persistent in config state:
- ids list
- usernames list (normalized)

Ban checks run before allowlist checks during message processing.

## Security
- Secrets are redacted from user-visible output
- `BOT_SECRETS_ENV_ONLY=true` disables YAML fallback for deployment/CI
- Provider switching checks required keys and blocks missing-key changes

## Storage
- Postgres: user runtime config/secrets/profile + history
- R2: images, request logs, crash logs, status markers
- Capacity/retention cleanup is enforced by runtime/storage managers

## Testing
Primary suites:
- `npm run test:render:local`
- `npm run test:render`
- `npm run test:render:r2-real`
- `npm run test:render:full-stack`

Secret checks before deploy/tests:
- `npm run secrets:validate:deploy:ci`
- `npm run secrets:validate:tests:ci`

## Deployment
Use:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

See:
- `render/docs/deployment-runbook.md`
- `render/docs/testing.md`

