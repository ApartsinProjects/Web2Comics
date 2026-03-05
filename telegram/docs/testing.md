# Web2Comic Bot Testing Guide

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

Scope note:
- Test flows here target public user behavior and deployment reliability.
- Admin-only bot commands are intentionally excluded from published docs.

## Public Commands To Cover In Tests
- Onboarding/info: `/start`, `/welcome`, `/help`, `/about`, `/version`, `/user`, `/config`, `/explain`, `/debug`
- Generation: text input, URL input, `/invent <story>`, `/random`, `/peek`, `/peek<n>`
- Providers/models: `/vendor`, `/text_vendor`, `/image_vendor`, `/models`, `/test`
- Controls: `/panels`, `/objective`, `/objectives`, objective shortcuts, `/style`, style shortcuts, `/new_style`, `/language`, `/mode`, `/consistency`, `/detail`, `/crazyness`, `/concurrency`, `/retries`
- Prompt/options: `/prompts`, `/set_prompt`, `/list_options`, `/options`
- Credentials/state: `/keys`, `/setkey`, `/unsetkey`, `/reset_config`, `/restart`

## Scope
This document covers local, integration, and remote validation for the Render webhook bot.

## 1) Fast Local Suite
Run core local checks:

```bash
npm run test:telegram:local
```

Run full render test suite:

```bash
npm run test:telegram
```

## 2) Focused Suites
- Interaction command matrix:

```bash
npx vitest run -c telegram/vitest.config.js telegram/tests/interaction-suite.test.js
```

- Webhook REST behavior:

```bash
npx vitest run -c telegram/vitest.config.js telegram/tests/webhook-rest.test.js
```

- Generator behavior:

```bash
npx vitest run -c telegram/vitest.config.js telegram/tests/generate.test.js
```

- Telegram payload behavior (forwardable messages/photos):

```bash
npx vitest run -c telegram/vitest.config.js telegram/tests/telegram-api.test.js
```

## 3) Real Provider Tests
Gemini live tests:

```bash
set RUN_RENDER_REAL_GEMINI=1
npm run test:telegram:gemini-real
```

Real local URL ingestion e2e (opt-in):

```bash
set RUN_RENDER_REAL_GEMINI=1
set RUN_WEBHOOK_URL_REAL=true
npx vitest run -c telegram/vitest.config.js telegram/tests/webhook-url-real.e2e.test.js
```

## 4) R2 Integration Tests
Requires valid `R2_*` env vars.

```bash
set RUN_R2_E2E=true
npm run test:telegram:r2-real
```

## 4.1) Post-Deploy Sanity E2E
Run the lightweight deploy sanity probe manually:

```bash
npm run telegram:deploy:sanity
```

This is executed automatically by `npm run bot:deploy:auto` unless `--skip-sanity` is set.

## 5) Full Remote Interface Test
Requires deployed bot URL and Telegram test routing values.

```bash
set RUN_FULL_STACK_E2E=true
npm run test:telegram:full-stack
```

Validated interfaces include:
- service health endpoint
- webhook ingestion path and secret handling
- Telegram outbound API calls
- R2 request logs and generated image objects
- crash log observability

## 6) Required Behavior to Verify
- Per-user queueing and no dropped updates
- Text input and URL input flows
- Streaming panel delivery (panels sent as ready)
- Caption prefix format `X(Y)` on each panel
- Story-summary context present in image prompts (engine prompt builder test)
- Panel image prompt field names are `Background` and `Image description` (no `Story title` line)
- URL flow prints exact parsed URL before extraction
- Panel watermark toggle works (`generation.panel_watermark`, default on)
- Consistency toggle works (`/consistency on|off`) and unsupported models fall back safely
- Prompt controls (`/options`, dedicated setting commands)
- `/crazyness` command updates story invention temperature
- Objective listing with `/objective` (no args)
- Secret redaction in user-visible messages

## 7) CI
Workflow:
- `.github/workflows/bot-tests.yml`

Before tests run, CI enforces secret checks:

```bash
npm run secrets:validate:tests:ci
```
