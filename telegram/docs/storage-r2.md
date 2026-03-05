# Bot R2 Storage

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

Scope note:
- Storage behavior is documented for public deployment/usage only.
- Admin-only bot commands are intentionally excluded from docs.

## Public Commands That Persist State
- Credentials/state:
  - `/keys`, `/setkey`, `/unsetkey`, `/reset_config`, `/restart`
- Generation/config:
  - text/URL input, `/invent`, `/random`, `/peek`
  - `/vendor`, `/text_vendor`, `/image_vendor`, `/models`, `/test`
  - `/panels`, `/objective`, objective shortcuts, `/style`, style shortcuts, `/new_style`
  - `/language`, `/mode`, `/consistency`, `/detail`, `/crazyness`, `/concurrency`, `/retries`
  - `/prompts`, `/set_prompt`, `/list_options`, `/options`

## Storage classes used
- `logs/requests/` for request audit records.
- `crash-logs/` for crash records and latest pointer.
- `images/` for generated panel images.
- status objects:
  - `status/image-storage-status.json`
  - `crash-logs/status.json`

## Free-tier safety defaults
Applied by deploy script and runtime defaults:
- Images: `4GB` capacity, cleanup at `50%` (about `2GB` watermark).
- Crash logs: `512MB` capacity, cleanup at `80%`.
- Request logs: `512MB` capacity, cleanup at `80%`.

Hard safety:
- Image storage manager enforces a hard cap of `5GB`.
- Retention cleanup:
  - crash logs older than 5 days are deleted
  - request logs older than 5 days are deleted

## Relevant env vars
- `R2_S3_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_IMAGE_PREFIX`
- `R2_IMAGE_STATUS_KEY`
- `R2_CRASH_LOG_PREFIX`
- `R2_CRASH_LOG_STATUS_KEY`
- `RENDER_BOT_IMAGE_CAPACITY_BYTES`
- `RENDER_BOT_IMAGE_CLEANUP_THRESHOLD_RATIO`
- `R2_CRASH_LOG_CAPACITY_BYTES`
- `R2_CRASH_LOG_CLEANUP_THRESHOLD_RATIO`

## Notes
- R2 does not require pre-created folders. Prefixes are created on write.
- Use global endpoint format for S3 clients:
  - `https://<account_id>.r2.cloudflarestorage.com`
