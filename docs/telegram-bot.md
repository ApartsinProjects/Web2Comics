# Web2Comic Telegram Bot

The Telegram bot is the server-side companion to the Web2Comics extension.

## Cross References

Extension docs:
- Extension README (GitHub): <https://github.com/ApartsinProjects/Web2Comics/blob/main/README.md>

Bot docs:
- Bot README (GitHub): <https://github.com/ApartsinProjects/Web2Comics/blob/main/telegram/README.md>
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>
- Bot README (GitHub Pages): [`../telegram/README.md`](../telegram/README.md)
- Bot docs folder (GitHub): <https://github.com/ApartsinProjects/Web2Comics/tree/main/telegram/docs>

## Quick Links
- Bot deployment runbook: [`../telegram/docs/deployment-runbook.md`](../telegram/docs/deployment-runbook.md)
- Bot testing guide: [`../telegram/docs/testing.md`](../telegram/docs/testing.md)
- Bot user manual: [`../telegram/docs/user-manual.md`](../telegram/docs/user-manual.md)
- Bot developer guide: [`../telegram/docs/developer-guide.md`](../telegram/docs/developer-guide.md)

## Features
- Accepts plain text and URL messages
- Generates comic panels and streams them as Telegram images
- Panel caption prefix format `X(Y)`
- Per-user settings and secrets
- Persistent storage via Postgres + Cloudflare R2

## Scope
- This bridge page documents public user-facing behavior only.
- Admin-only bot commands are intentionally excluded from published docs.

## Public Command Catalog (No Admin Commands)
- Onboarding/info:
  - `/start`, `/welcome`, `/help`, `/about`, `/version`, `/user`, `/config`, `/explain`, `/debug <on|off>`
- Generation/replay:
  - text/URL message, `/invent <story>`, `/random`, `/peek`, `/peek<n>`
- Providers/models:
  - `/vendor`, `/text_vendor`, `/image_vendor`, `/models`, `/test`
- Controls:
  - `/panels`, `/objective`, `/objectives`, objective shortcuts
  - `/style`, style shortcuts, `/new_style`
  - `/language`, `/mode`, `/consistency`, `/detail`, `/crazyness`, `/concurrency`, `/retries`
- Prompt/options:
  - `/prompts`, `/set_prompt`, `/list_options`, `/options`
- Credentials/state:
  - `/keys`, `/setkey`, `/unsetkey`, `/reset_config`, `/restart`

## Deploy
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

## Test
```bash
npm run test:telegram:local
npm run test:telegram
```
