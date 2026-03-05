# ComicBot User Guide

## What it does
ComicBot listens to Telegram messages:
- If message is a URL (`http://` or `https://`): it fetches the page with Playwright, saves HTML snapshot, then runs comic generation.
- If message is plain text: it saves text to file and runs comic generation.

It sends a single comic PNG back to Telegram.

## Folder layout
- `comicbot/src/` : bot code
- `comicbot/config/default.bot.yml` : default engine config used by the bot
- `comicbot/.env.example` : environment template
- `comicbot/out/` : generated inputs/snapshots/comics/debug artifacts

## 1) Telegram provisioning (BotFather)
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Choose bot display name and username (must end with `bot`, e.g. `mycomicflowbot`).
4. BotFather returns a token like:
   `1234567890:AA...`
5. Put that token into `comicbot/.env` as:
   `TELEGRAM_BOT_TOKEN=...`

Optional hardening:
- Set allowlist with `COMICBOT_ALLOWED_CHAT_IDS=12345,67890`.
- To find your chat ID, start bot without allowlist, send `/config`, and inspect logs or temporarily add message echo.

## 2) Provider key provisioning
ComicBot reuses engine providers. At least one text provider key and one image provider key must match `comicbot/config/default.bot.yml`.

Default config uses Gemini for both text and image.

### Gemini (default)
1. Create/locate key in Google AI Studio.
2. Put in `comicbot/.env`:
   `GEMINI_API_KEY=...`

### OpenAI (optional)
- Set `OPENAI_API_KEY=...`
- Update `comicbot/config/default.bot.yml` provider section to `openai` models.

### OpenRouter (optional)
- Set `OPENROUTER_API_KEY=...`
- Update provider section to `openrouter`.

### Cloudflare Workers AI (optional)
- Set `CLOUDFLARE_ACCOUNT_ID=...`
- Set `CLOUDFLARE_API_TOKEN=...`
- Update provider section to `cloudflare`.

### Hugging Face (optional)
- Set `HUGGINGFACE_INFERENCE_API_TOKEN=...`
- Update provider section to `huggingface`.

## 3) Default configuration
Default file: `comicbot/config/default.bot.yml`

Important defaults:
- `panel_count: 3`
- `objective: summarize`
- low detail for speed
- 3-image concurrency
- output layout tuned for Telegram-friendly image sharing

You can tune:
- speed: lower `panel_count`, lower `max_chars`
- quality: higher `detail_level`, richer `style_prompt`
- cost/latency: choose different providers/models

## 4) Bot connection and run
1. From repo root:
   ```bash
   npm install
   ```
2. Copy env template:
   - Windows PowerShell:
     ```powershell
     Copy-Item comicbot/.env.example comicbot/.env
     ```
3. Edit `comicbot/.env` and set token + provider keys.
4. Start bot:
   ```bash
   npm run comicbot:start
   ```
5. In Telegram, open your bot chat and send `/start`.
6. Send either text story or URL.

## 5) Commands
- `/start` or `/help` : usage
- `/config` : runtime summary (config path, output dir, allowlist)

## 6) Environment variables
Required:
- `TELEGRAM_BOT_TOKEN`

Strongly recommended:
- `GEMINI_API_KEY` (for default config)

Optional:
- `COMICBOT_ALLOWED_CHAT_IDS`
- `COMICBOT_ENGINE_CONFIG`
- `COMICBOT_OUT_DIR`
- `COMICBOT_POLL_TIMEOUT_SEC`
- `COMICBOT_POLL_INTERVAL_MS`
- `COMICBOT_FETCH_TIMEOUT_MS`
- `COMICBOT_TITLE_PREFIX`
- `COMICBOT_DEBUG_ARTIFACTS=true|false`

## 7) Running your own custom bot quickly
1. Create a new bot in BotFather.
2. Set token in `comicbot/.env`.
3. Add your provider key (`GEMINI_API_KEY` for default).
4. Optionally duplicate and edit config:
   - copy `comicbot/config/default.bot.yml` to `comicbot/config/my.bot.yml`
   - set `COMICBOT_ENGINE_CONFIG=comicbot/config/my.bot.yml`
5. Start with `npm run comicbot:start`.

## 8) Troubleshooting
- `Missing required env var: TELEGRAM_BOT_TOKEN`
  - Add token in `comicbot/.env`.
- `Generation failed: ... quota ...`
  - Provider key has no quota/billing; switch provider/model or top up.
- URL fetch timeout
  - Increase `COMICBOT_FETCH_TIMEOUT_MS`.
- Bot responds in all chats
  - Set `COMICBOT_ALLOWED_CHAT_IDS`.
- No response after sending message
  - Check console logs; ensure long polling is running and token is valid.
