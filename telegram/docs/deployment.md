# Bot Documentation Hub

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

Scope note:
- This document covers deployment/runtime behavior only.
- Admin-only bot commands are intentionally excluded from user documentation.

## Public Commands Covered By This Deployment
- Runtime and onboarding: `/start`, `/welcome`, `/help`, `/version`, `/about`, `/user`, `/config`, `/explain`, `/debug`
- Generation entrypoints: text/URL messages, `/invent <story>`, `/random`
- Provider/model controls: `/vendor`, `/text_vendor`, `/image_vendor`, `/models`, `/test`
- Output controls: `/panels`, `/objective`, `/objectives`, objective shortcuts (`/summary`, `/fun`, `/learn`, `/news`, `/timeline`, `/facts`, `/compare`, `/5yold`, `/eli5`, `/study`, `/meeting`, `/howto`, `/debate`), `/style`, style shortcuts, `/new_style`, `/language`, `/mode`, `/consistency`, `/detail`, `/crazyness`, `/concurrency`, `/retries`
- Prompt/options controls: `/prompts`, `/set_prompt`, `/list_options`, `/options`
- Credentials/state: `/keys`, `/setkey`, `/unsetkey`, `/reset_config`, `/restart`
- History replay: `/peek`, `/peek <n>`, `/peek<n>`

Core bot docs:
- [deployment-runbook.md](deployment-runbook.md)
- [testing.md](testing.md)
- [user-manual.md](user-manual.md)
- [developer-guide.md](developer-guide.md)
- [operations.md](operations.md)
- [storage-r2.md](storage-r2.md)
- [data-reference.md](data-reference.md)

Quick deploy:
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

Notes:
- Deployment preflight enforces strict Cloudflare token roles (`CLOUDFLARE_WORKERS_AI_TOKEN` vs `CLOUDFLARE_ACCOUNT_API_TOKEN`).
- Legacy deploy arg `--cloudflare-api-token` is deprecated/rejected; use explicit `--cloudflare-ai-token` and `--cloudflare-account-api-token`.
