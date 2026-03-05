# Web2Comic Telegram Bot

Telegram bot backend for Web2Comics.  
The bot accepts text or URL messages, generates comic panels, and sends ordered panel images back to chat.

Extension README (Markdown): [../README.md](../README.md)  
Extension docs home (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/>  
Extension docs index (Markdown): [../docs/README.md](../docs/README.md)  
GitHub Pages bot docs: <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>
Bot docs bridge page (Markdown): [../docs/telegram-bot.md](../docs/telegram-bot.md)

## What It Does
- Receives Telegram webhook updates
- Detects text vs URL inputs
- Builds storyboard and panel images with configured providers
- Streams panels to users as they are generated
- Uses per-user runtime settings and credentials
- Persists runtime state in Cloudflare R2
- Persists artifacts/logs/images in Cloudflare R2

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

## Key Commands
User:
- `/help`
- `/about`
- `/version`
- `/user`
- `/config`
- `/vendor`, `/text_vendor`, `/image_vendor`
- `/panels`, `/objective`, `/language`, `/style`, `/crazyness`
- `/consistency`
- `/models`
- `/options`, `/list_options`
- `/keys` or `/credentials`
- `/setkey`, `/unsetkey`
- `/new_style`
- `/set_prompt`
- `/invent`

## Documentation
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
npm run bot:deploy:auto -- --target render --branch engine --env-only
```

Includes:
- secret validation
- predeploy checks + local tests
- Render deploy automation
- post-deploy sanity E2E check (health + webhook + Telegram + R2 evidence)
