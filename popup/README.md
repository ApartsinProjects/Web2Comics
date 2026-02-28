# popup Folder

## Purpose
Extension popup UI (launcher, generator wizard, progress UI, popup history) assets and logic.

## Contents
- `popup.html` : Popup UI markup for the launcher (`Create Comic` / `History`), generator wizard form, progress panel, custom-style modal, and popup history modal. Includes small help (`?`) links into the user manual.
- `popup.css` : Popup styles for launcher/wizard/progress/history UI, advanced-settings disclosure, readiness indicators, and detailed progress/ETA display.
- `popup.js` : Popup controller logic for content extraction, provider/model selection, wizard readiness and hard-guarding, generation start/progress polling, ETA strings, provider filtering by configuration/validation, context-menu selected-text prefill handling, custom style management, history modal behavior, and sidepanel auto-open.

## Artifacts
- No file artifacts are generated here. Popup runtime state is transient and persisted via `chrome.storage.local` (settings, current job snapshots, debug logs, custom styles).

## Maintenance
- Update this README when files are added, removed, renamed, or when the folder purpose changes significantly.
