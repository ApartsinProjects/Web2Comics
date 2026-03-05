# Web2Comic Bot Testing Guide

## Scope
This document covers local, integration, and remote validation for the Render webhook bot.

## 1) Fast Local Suite
Run core local checks:

```bash
npm run test:render:local
```

Run full render test suite:

```bash
npm run test:render
```

## 2) Focused Suites
- Interaction command matrix and admin flows:

```bash
npx vitest run -c render/vitest.config.js render/tests/interaction-suite.test.js
```

- Webhook REST behavior:

```bash
npx vitest run -c render/vitest.config.js render/tests/webhook-rest.test.js
```

- Generator behavior:

```bash
npx vitest run -c render/vitest.config.js render/tests/generate.test.js
```

## 3) Real Provider Tests
Gemini live tests:

```bash
set RUN_RENDER_REAL_GEMINI=1
npm run test:render:gemini-real
```

## 4) R2 Integration Tests
Requires valid `R2_*` env vars.

```bash
set RUN_R2_E2E=true
npm run test:render:r2-real
```

## 4.1) Post-Deploy Sanity E2E
Run the lightweight deploy sanity probe manually:

```bash
npm run render:deploy:sanity
```

This is executed automatically by `npm run bot:deploy:auto` unless `--skip-sanity` is set.

## 5) Full Remote Interface Test
Requires deployed bot URL and Telegram test routing values.

```bash
set RUN_FULL_STACK_E2E=true
npm run test:render:full-stack
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
- Prompt controls (`/options`, `/choose`, `/set`)
- Objective listing with `/objective` (no args)
- Admin commands (`/peek`, `/users`, `/ban`, `/unban`)
- Secret redaction in user-visible messages

## 7) CI
Workflow:
- `.github/workflows/bot-tests.yml`

Before tests run, CI enforces secret checks:

```bash
npm run secrets:validate:tests:ci
```
