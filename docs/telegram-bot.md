# Web2Comic Telegram Bot

The Telegram bot is the server-side companion to the Web2Comics extension.

## Product Boundaries
- This document covers the Telegram bot only.
- Extension popup, sidepanel, options-page, and browser-storage behavior live in separate extension documents.
- Shared comic-generation behavior is implemented in the engine and referenced here as a common dependency.

## Cross References
- Extension overview: [`./extension.md`](./extension.md)
- Extension README: [`../README.md`](../README.md)
- Bot README: [`../telegram/README.md`](../telegram/README.md)
- Shared engine overview: [`./engine.md`](./engine.md)
- Bot release notes: [`../telegram/docs/release-notes.md`](../telegram/docs/release-notes.md)

## Quick Links
- Bot deployment runbook: [`../telegram/docs/deployment-runbook.md`](../telegram/docs/deployment-runbook.md)
- Bot testing guide: [`../telegram/docs/testing.md`](../telegram/docs/testing.md)
- Bot user manual: [`../telegram/docs/user-manual.md`](../telegram/docs/user-manual.md)
- Bot developer guide: [`../telegram/docs/developer-guide.md`](../telegram/docs/developer-guide.md)
- Bot release notes: [`../telegram/docs/release-notes.md`](../telegram/docs/release-notes.md)
- Shared engine overview: [`./engine.md`](./engine.md)

## Features
- Accepts plain text, web links, PDF links/files, image links/files, and voice/audio
- Generates comic panels and streams them as Telegram images
- Panel caption prefix format `X(Y)`
- Per-user settings and secrets
- Persistent storage via Cloudflare R2, with local file fallback when R2 is not configured
- Keeps handled provider/extractor retries internal so successful recoveries do not spam the user chat

## Scope
- This bridge page documents public user-facing behavior only.
- Admin-only bot commands are intentionally excluded from published docs.
- Browser-extension-specific UX is intentionally documented outside this page.

## Public Command Catalog (No Admin Commands)
- Onboarding/info:
  - `/start`, `/welcome`, `/help`, `/about`, `/version`, `/user`, `/config`, `/explain`, `/debug <on|off>`
- Generation/replay:
  - text, link, PDF, image, or voice/audio input, `/invent <story>`, `/random`, `/peek`, `/peek<n>`
- Providers/models:
  - `/vendors [role]`, `/vendor <role> <name>`, `/vendor <name>`, `/models [role] [model]`, `/test`
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
npm run bot:deploy:auto -- --target render --env staging --branch stage1 --env-only
```

## Current Release Package
- Current bot release: `v1.0.4`
- Deploy artifact: `Web2Comics-TelegramBot-v1.0.4-deploy.zip`
- Release history: [`../telegram/docs/release-notes.md`](../telegram/docs/release-notes.md)
- Companion extension package: [`./extension.md`](./extension.md)

## Production Hotfix Status
- Production was updated on 2026-03-10 with a chat-noise reduction hotfix.
- Handled provider fallback and extractor fallback messages now stay in internal logs instead of being sent to the user chat.
- Terminal failures still notify the user, but provider-auth style errors are now shown with cleaner user-facing wording.
- The deploy sanity probe now uses a plain-text marker instead of an unknown slash command, so routine deploy checks no longer create `Unrecognized command.` noise.

## Test
```bash
npm run test:telegram:local
npm run test:telegram
```

## Shared Engine Relationship
- The bot uses shared prompt and composition logic from [`../engine/`](../engine/)
- Engine overview: [`./engine.md`](./engine.md)
- Shared engine behavior helps keep storyboard generation aligned between bot and extension products
