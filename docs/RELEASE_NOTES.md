# Web2Comics Release Notes

## v1.0.4 (2026-03-10)

### Highlights
- Added dedicated release packaging/documentation coverage for both the extension and the Telegram bot.
- Documented the extension and bot release artifacts separately while keeping cross-references between the two product docs.
- Added a docs-side engine bridge so both product release documents continue to point at shared engine behavior.

### Packaging
- Extension artifact: `Web2Comics-v1.0.4-extension.zip`
- Telegram bot artifact: `Web2Comics-TelegramBot-v1.0.4-deploy.zip`
- Built via: `scripts/package-release.ps1`
- Companion bot package built via: `scripts/package-telegram-bot-release.ps1`

## v1.0.3 (2026-03-03)

### Highlights
- Updated README badges and release links for the new release artifact.
- Refreshed installation documentation and root docs references to `v1.0.3`.
- Published new packaged extension ZIP for Chrome unpacked installation flow.
- Clarified terminology and docs consistency (`My Collection`, share targets, docs index, canonical `docs/instructions.md`).

### Packaging
- Release artifact: `Web2Comics-v1.0.3-extension.zip`
- Built via: `scripts/package-release.ps1`

## v1.0.2 (2026-02-28)

### Highlights
- Improved context-menu generation reliability and settings propagation.
- Added broader integration coverage for context-menu generation/composer flows.
- Hardened popup integration tests to reduce readiness-related flakiness.
- Expanded resilience checks for side-panel/popup fallback behavior.

### Quality
- Full automated test suite executed:
  - `npm run test`
  - `npm run test:e2e`

### Packaging
- Release artifact: `Web2Comics-v1.0.2-extension.zip`
- Built via: `scripts/package-release.ps1`
