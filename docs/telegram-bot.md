# Web2Comic Telegram Bot

The Telegram bot is the server-side companion to the Web2Comics extension.

## Cross References

Extension docs:
- Extension README (GitHub): <https://github.com/ApartsinProjects/Web2Comics/blob/main/README.md>
- Extension docs index (Markdown): [`./README.md`](./README.md)
- Extension docs home (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/>
- Extension user manual (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/user-manual.html>

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

## Deploy
```bash
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

## Test
```bash
npm run test:telegram:local
npm run test:telegram
```
