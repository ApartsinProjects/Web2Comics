# Telegram Bot Release Notes

## Production Hotfix (2026-03-10)

### Highlights
- Deployed a production-only UX hardening fix so handled provider/extractor recovery steps no longer appear as user-facing chat errors.
- Sanitized terminal provider-auth style failures so the bot does not expose raw credential/provider text such as invalid API key messages.
- Updated the Render post-deploy sanity probe to use a plain-text marker instead of an unknown slash command, preventing routine deploy checks from generating `Unrecognized command.` in the bot chat.

### Status
- Deployed from `main` commit `3ac0580`
- This hotfix is live in production even though the packaged bot artifact version remains `v1.0.4`

## v1.0.4 (2026-03-10)

### Highlights
- Updated the Telegram bot deploy package for the latest shared engine and persistence changes.
- Added dedicated bot release documentation so bot packaging is tracked separately from extension packaging.
- Kept bot docs cross-referenced with the extension overview and the shared engine overview.

### Packaging
- Deploy artifact: `Web2Comics-TelegramBot-v1.0.4-deploy.zip`
- Built via: `scripts/package-telegram-bot-release.ps1`
- Companion extension artifact: `Web2Comics-v1.0.4-extension.zip`

## v1.0.3 (2026-03-03)

### Highlights
- Refreshed bot documentation links and deployment references.
- Packaged the standalone bot deployment bundle for Render-based webhook hosting.

### Packaging
- Deploy artifact: `Web2Comics-TelegramBot-v1.0.3-deploy.zip`
- Built via: `scripts/package-telegram-bot-release.ps1`
