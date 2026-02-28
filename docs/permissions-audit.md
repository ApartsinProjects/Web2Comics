# Permissions Audit (Chrome Web Store Readiness)

Date: 2026-02-27

## Current Required Permissions

- `activeTab`
  - Used to read/send messages to the currently active page only after user action in popup.
- `storage`
  - Used for settings, provider keys, job state, and history.
- `scripting`
  - Used to (re)inject `content-script.js` when the target tab has no ready receiver.
- `sidePanel`
  - Used to open and control the comic viewer side panel.
- `alarms`
  - Used in service worker for periodic cleanup tasks.
- `identity`
  - Used for OAuth flows in optional integrations (Google Drive backup, Facebook connection, X connection).

## Host Access Scope

- `host_permissions`: `http://*/*`, `https://*/*`
- `content_scripts.matches`: `http://*/*`, `https://*/*`
- Additional API host scope: `https://www.googleapis.com/*` for Google Drive upload APIs.

Reason: content extraction must work across arbitrary websites, while avoiding non-web schemes such as `chrome://`, `edge://`, `file://`.

## Removed to Reduce Review Friction

- `unlimitedStorage` removed.
  - Not required for baseline functionality; storage compaction already exists.
- `web_accessible_resources` entry removed.
  - Not needed for current runtime behavior and avoids exposing extension assets to arbitrary pages.

## Reviewer Notes (Suggested for CWS submission)

- No remote code execution.
- No `tabs` broad permission (uses `activeTab`).
- No `webRequest`, `declarativeNetRequest`, `downloads`, or external background servers.
- `identity` is requested only for explicit user-initiated OAuth connects (Google Drive / Facebook / X).
- Data sent only to user-configured AI providers for requested generation.
