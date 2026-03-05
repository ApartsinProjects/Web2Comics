# Web2Comic Telegram Bot

Telegram bot backend for Web2Comics.  
The bot accepts text or URL messages, generates comic panels, and sends ordered panel images back to chat.

Extension README: [../README.md](../README.md)  
GitHub Pages bot docs: <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

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
- Per-panel watermark: small semi-transparent `made with Web2Comics` (bottom-right)
- Panel image prompts include story title + short summary + panel visual brief
- Outbound Telegram messages/photos are sent with forwarding allowed (`protect_content=false`)
- `/objective` without args lists all objectives
- `/options` and `/choose` provide guided usage when called without args
- Admin moderation and ops commands (`/users`, `/ban`, `/unban`, `/peek`, `/log`, `/share`)

## Key Commands
User:
- `/help`
- `/about`
- `/user`
- `/config`
- `/vendor`, `/text_vendor`, `/image_vendor`
- `/panels`, `/objective`, `/language`, `/style`, `/crazyness`
- `/options`, `/choose`, `/set`
- `/keys` or `/credentials`
- `/setkey`, `/unsetkey`
- `/invent`

Admin:
- `/peek`, `/peek<n>`
- `/log`, `/log<n>`
- `/users`
- `/ban`, `/unban`
- `/share <user_id>`

## Documentation
- Deployment hub: [docs/deployment.md](docs/deployment.md)
- Deployment runbook: [docs/deployment-runbook.md](docs/deployment-runbook.md)
- Testing: [docs/testing.md](docs/testing.md)
- Operations: [docs/operations.md](docs/operations.md)
- Storage (R2): [docs/storage-r2.md](docs/storage-r2.md)
- User manual: [docs/user-manual.md](docs/user-manual.md)
- Developer guide: [docs/developer-guide.md](docs/developer-guide.md)

## Local Development
```bash
npm install
npm run render:start
```

## Testing
```bash
npm run test:render:local
npm run test:render
```

Optional:
```bash
npm run test:render:r2-real
npm run test:render:full-stack
```

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
