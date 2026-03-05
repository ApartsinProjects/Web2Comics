# Web2Comic Telegram Bot

The Telegram bot is the server-side companion to the Web2Comics extension.

Main bot README:
- [`render/README.md`](../render/README.md)

Extension README:
- [`README.md`](../README.md)

## Quick Links
- Bot deployment runbook: [`../render/docs/deployment-runbook.md`](../render/docs/deployment-runbook.md)
- Bot testing guide: [`../render/docs/testing.md`](../render/docs/testing.md)
- Bot user manual: [`../render/docs/user-manual.md`](../render/docs/user-manual.md)
- Bot developer guide: [`../render/docs/developer-guide.md`](../render/docs/developer-guide.md)

## Features
- Accepts plain text and URL messages
- Generates comic panels and streams them as Telegram images
- Panel caption prefix format `X(Y)`
- Per-user settings and secrets
- Admin controls: `/users`, `/ban`, `/unban`, `/peek`, `/log`, `/share`
- Persistent storage via Postgres + Cloudflare R2

## Deploy
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

## Test
```bash
npm run test:render:local
npm run test:render
```

