# Web2Comic Telegram Bot

[![Bot Docs](https://img.shields.io/badge/Bot%20Docs-GitHub%20Pages-0ea5e9?logo=githubpages&logoColor=white)](https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html)
![Runtime](https://img.shields.io/badge/runtime-node%2020-3c873a)
![Deploy](https://img.shields.io/badge/deploy-render-46E3B7?logo=render&logoColor=000000)
![Storage](https://img.shields.io/badge/storage-Cloudflare%20R2-F48120?logo=cloudflare&logoColor=white)
![Tests](https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/%C2%A9%202026-Alexander%20Apartsin-red)

Telegram bot backend for Web2Comics.
The bot accepts text, web links, PDF links/files, image links/files, and voice/audio, then generates comic panels and sends ordered panel images back to chat.

Bot overview doc: [../docs/telegram-bot.md](../docs/telegram-bot.md)
Extension overview doc: [../docs/extension.md](../docs/extension.md)
Extension README: [../README.md](../README.md)
Shared engine overview: [../docs/engine.md](../docs/engine.md)
Engine manual source: [../engine/manual.md](../engine/manual.md)
Bot release notes: [docs/release-notes.md](docs/release-notes.md)
GitHub Pages bot docs: <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

## Documentation Scope
- Bot documentation lists public user-facing commands and flows only.
- Internal/admin-only commands are intentionally excluded from published docs.
- Extension popup, sidepanel, options-page, and browser workflows are documented separately.

## Public Command Catalog (No Admin Commands)
- Onboarding/info:
  - `/start`, `/welcome`, `/help`, `/about`, `/version`, `/user`, `/config`, `/explain`, `/debug <on|off>`
- Story generation:
  - Send plain text, web link, PDF, image, or voice/audio message
  - `/invent <story>`
  - `/random`
- Replay/history:
  - `/peek`, `/peek <n>`, `/peek<n>`
- Providers and models:
  - `/vendors [role]`, `/vendor <role> <name>`, `/vendor <name>`
  - `/models [text|image|url|image_extract|pdf|voice] [model]`
  - `/test`
- Generation controls:
  - `/panels <count>`, `/objective [name]`, `/objectives`
  - `/language <code>`, `/mode <default|media_group|single>`
  - `/consistency <on|off>`, `/detail <low|medium|high>`
  - `/crazyness <0..2>`, `/concurrency <1..5>`, `/retries <0..3>`
- Objective shortcuts:
  - `/summary`, `/fun`, `/learn`, `/news`, `/timeline`, `/facts`, `/compare`, `/5yold`, `/eli5`, `/study`, `/meeting`, `/howto`, `/debate`
- Style controls:
  - `/style <preset-or-your-style>`
  - `/new_style <name> <text>`
  - Style shortcuts: `/classic`, `/noir`, `/manga`, `/superhero`, `/watercolor`, `/newspaper`, `/cinematic`, `/anime`, `/cyberpunk`, `/pixel-art`, `/retro-pop`, `/minimalist`, `/storybook`, `/ink-wash`, `/line-art`, `/clay-3d`
- Prompts/options:
  - `/prompts`
  - `/set_prompt story <text>`
  - `/set_prompt panel <text>`
  - `/set_prompt objective <name> <text>`
  - `/list_options`, `/options <path>`
- Keys/reset:
  - `/keys`, `/setkey <KEY> <VALUE>`, `/unsetkey <KEY>`, `/reset_config`, `/restart`
- Behavior:
  - Unknown `/...` command is rejected as unrecognized (not treated as story text).

## What It Does
- Receives Telegram webhook updates
- Detects text, web link, PDF, image, and voice/audio inputs
- Builds storyboard and panel images with configured providers
- Streams panels to users as they are generated
- Uses per-user runtime settings and credentials
- Persists runtime state in Cloudflare R2
- Persists artifacts/logs/images in Cloudflare R2

## Shared Engine Relationship
- The bot reuses shared prompt-building and composition logic from [`../engine/`](../engine/)
- Engine overview: [`../docs/engine.md`](../docs/engine.md)
- This keeps storyboard behavior closer to the extension while allowing the bot to keep its own transport, storage, and deployment model

## Runtime Highlights
- Fast webhook ACK + per-chat processing queue
- Caption prefix format `X(Y)` for each panel
- Watermark is configurable (default: `on`)
- Panel image prompts include `Background` + `Image description` fields (no `Story title` line)
- Image no-text rule is enforced in English, Hebrew, and Russian
- Optional style consistency flow (`/consistency on`): generate summary reference image first, then use it as style reference for panel generation on supported image models
- Outbound Telegram messages/photos are sent with forwarding allowed (`protect_content=false`)
- `/objective` without args lists all objectives
- For URL inputs, bot prints the exact parsed URL before extraction

## Documentation
- Bot overview: [../docs/telegram-bot.md](../docs/telegram-bot.md)
- Extension overview: [../docs/extension.md](../docs/extension.md)
- Shared engine overview: [../docs/engine.md](../docs/engine.md)
- Engine manual source: [../engine/manual.md](../engine/manual.md)
- Release notes: [docs/release-notes.md](docs/release-notes.md)
- Deployment hub: [docs/deployment.md](docs/deployment.md)
- Deployment runbook: [docs/deployment-runbook.md](docs/deployment-runbook.md)
- Testing: [docs/testing.md](docs/testing.md)
- Operations: [docs/operations.md](docs/operations.md)
- Storage (R2): [docs/storage-r2.md](docs/storage-r2.md)
- Data/config reference: [docs/data-reference.md](docs/data-reference.md)
- User manual: [docs/user-manual.md](docs/user-manual.md)
- Developer guide: [docs/developer-guide.md](docs/developer-guide.md)

## Local Development
```bash
npm install
npm run telegram:start
```

## Testing
```bash
npm run test:telegram:local
npm run test:telegram
```

Optional:
```bash
npm run test:telegram:gemini-real
npm run test:telegram:r2-real
npm run test:telegram:full-stack
npx vitest run -c telegram/vitest.config.js telegram/tests/webhook-url-real.e2e.test.js
```

Optional real URL e2e is opt-in and requires:
- `RUN_WEBHOOK_URL_REAL=true`
- `RUN_RENDER_REAL_GEMINI=1`
- `GEMINI_API_KEY` set

## Deployment
Recommended automatic path:
```bash
npm run bot:deploy:auto -- --target render --env staging --branch stage1 --env-only
```

Release package:
- Current bot release: `v1.0.4`
- Deploy artifact: `Web2Comics-TelegramBot-v1.0.4-deploy.zip`
- Companion extension package docs: [../docs/extension.md](../docs/extension.md)

Includes:
- secret validation
- predeploy checks + local tests
- Render deploy automation
- post-deploy sanity E2E check (health + webhook + Telegram + R2 evidence)
