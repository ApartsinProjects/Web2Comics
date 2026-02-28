# e2e Folder

## Purpose
Playwright end-to-end tests for extension registration, real/mocked provider flows, diagnostics, and exports.

## Contents
- `chrome-extension-diagnostics.test.js` : Real-Chrome diagnostic test for unpacked extension loading/registration on Windows (`channel: 'chrome'`), capturing `chrome://version`, `chrome://extensions`, and event logs when service worker registration fails.
- `chrome-extension-manual-assisted.test.js` : Headed/manual-assisted Chrome verification flow for `chrome://extensions` → `Load unpacked`, then extension service-worker/popup validation with screenshots/artifacts.
- `comic-generation-sites.test.js` : Main Playwright E2E suite for comic generation across websites. Covers mocked and real provider modes, preflight checks, provider/config matrices, export/download validation, history assertions, prompt-template runtime assertions, and provider mini-matrix/single-site export flows.
- `context-menu-selection-flow.test.js` : Dedicated E2E for context-menu selected-text paths (instant generate and open-composer prefill).
- `extension-registration.test.js` : Registration/smoke assertions for extension packaging/runtime basics (manifest/icon expectations, popup/options/sidepanel availability, provider list sanity, current UI flow checks).
- `extension.test.js` : Modernized UI smoke tests that open extension pages directly via `chrome-extension://<id>/...` and validate current popup/options/sidepanel structure and branding.
- `x-content-source-real.test.js` : Real-site extraction E2E for `x.com` using the actual content-script message path (`EXTRACT_CONTENT`), gated by `RUN_X_REAL_E2E=1`.

## Artifacts
- Test artifacts are written outside this folder (for example under `test-results/` and `playwright-report/`), including traces, screenshots, exported comic images, and provider probe outputs.

## Maintenance
- Update this README when files are added, removed, renamed, or when the folder purpose changes significantly.
- `comic-generation-sites.test.js` accepts optional `WEBSITE_SITE_FILTER` (e.g. `x.com` or `twitterdev`) to run a focused subset during debugging.
- `chrome-extension-diagnostics.test.js` is opt-in by default and runs only when `RUN_CHROME_DIAGNOSTICS=1`.
