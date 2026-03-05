# Web2Comic Bot Developer Guide

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Extension docs home (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/>
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

## Architecture
- Entry point: `telegram/src/webhook-bot.js`
- Generator bridge: `telegram/src/generate.js`
- Shared engine: `engine/src/*`
- Bot data modules: `telegram/src/data/*` (messages, providers, styles/objectives, options, thresholds)
- Engine prompt templates: `engine/src/data/prompt-templates.js`
- Runtime state/config: `telegram/src/config-store.js`
- Persistence adapters: `telegram/src/persistence.js` + request/crash log stores

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
4. Optional consistency flow (if enabled and supported): generate one summary reference image
5. Generate panel images (each prompt includes `Background` + `Image description`; `Story title` line removed; references summary style when available)
6. Stream panel sends to Telegram as each panel becomes ready
7. Send final completion summary

Important behavior:
- Panel captions in chat use `X(Y)` prefix
- Image prompt explicitly forbids rendering text inside artwork (rule repeated in English/Hebrew/Russian)
- Watermark is configurable (`generation.panel_watermark`, default `true`)
- Consistency mode is configurable (`generation.consistency`, default `true`)
- Telegram sends use `protect_content=false` to keep forwarding enabled

## Command System
Primary command handling is in `handleCommand`.

Notable UX behavior:
- `/objective` without args lists all objectives
- `/crazyness <0..2>` controls story invention temperature
- `/options` without args explains valid paths/options; apply via dedicated commands (`/objective`, `/panels`, `/mode`, `/vendor`, `/models`, etc.)
- `/keys` shows runtime key status
- URL flow sends `Detected link, parsing page: <url>` with the exact parsed URL

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
- R2 state object: user runtime config/secrets/profile + history
- R2: images, request logs, crash logs, status markers
- Capacity/retention cleanup is enforced by runtime/storage managers

## Testing
Primary suites:
- `npm run test:telegram:local`
- `npm run test:telegram`
- `npm run test:telegram:r2-real`
- `npm run test:telegram:full-stack`
- `npx vitest run -c telegram/vitest.config.js telegram/tests/webhook-url-real.e2e.test.js` (opt-in with `RUN_WEBHOOK_URL_REAL=true`)

Secret checks before deploy/tests:
- `npm run secrets:validate:deploy:ci`
- `npm run secrets:validate:tests:ci`

## Deployment
Use:

```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

See:
- `telegram/docs/deployment-runbook.md`
- `telegram/docs/testing.md`

