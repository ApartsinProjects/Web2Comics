# Bot Testing

Full testing matrix (local/render/cloudflare/telegram):
- [deployment-runbook.md](deployment-runbook.md)

CI workflow:
- `.github/workflows/bot-tests.yml` (uses GitHub Secrets env)

## Standard local suite
```bash
npm run test:render
```

## Real R2 integration tests
```bash
npm run test:render:r2-real
```
Requires valid `R2_*` env vars.

## Full interface suite
```bash
set RUN_FULL_STACK_E2E=true
npm run test:render:full-stack
```
This validates:
- deployed REST `/healthz`
- remote webhook ingestion (`/telegram/webhook/<secret>`)
- R2 request log growth (`logs/requests/`) and marker detection
- R2 image object growth after generation
- Telegram API channel send (`sendMessage`)
- crash-log prefix remains observable

## Focused local checks
```bash
npm run test:render -- render/tests/webhook-rest.test.js
npm run test:render -- render/tests/image-storage.test.js
npm run test:render -- render/tests/crash-log-store.test.js
```
