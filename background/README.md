# background Folder

## Purpose
Extension background/service-worker logic: generation orchestration, provider routing, storage, progress, and diagnostics.

## Contents
- `service-worker.js` : Main extension service worker. Handles message routing (`START_GENERATION`, `GET_STATUS`, `TEST_PROVIDER_MODEL`, panel edits, optional OAuth connection actions), provider selection, storyboard/image generation orchestration, retries/timeouts, progress updates, storage persistence/history, refusal-handling policy, context-menu flows for selected text (instant generate + open composer prefill), provider implementations (OpenAI, Gemini, Cloudflare, OpenRouter, Hugging Face), and optional Google Drive HTML backup upload.

## Artifacts
- No generated artifacts are expected here. Runtime state (jobs, history, debug logs) is stored in `chrome.storage.local`, not as files in this folder.

## Maintenance
- Update this README when files are added, removed, renamed, or when the folder purpose changes significantly.
