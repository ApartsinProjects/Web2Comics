# Web2Comics Chrome Extension

The Chrome extension is the browser product in the Web2Comics project.

## Product Boundaries
- This document covers the browser extension only.
- Telegram bot behavior, commands, deployment, and bot operations live in separate bot documents.
- Shared comic-generation logic lives in the engine and is referenced here as a common dependency.

## Cross References
- Telegram bot overview: [`./telegram-bot.md`](./telegram-bot.md)
- Telegram bot README: [`../telegram/README.md`](../telegram/README.md)
- Shared engine overview: [`./engine.md`](./engine.md)
- Extension release notes: [`./RELEASE_NOTES.md`](./RELEASE_NOTES.md)

## What The Extension Does
- Extracts content from the current browser tab
- Lets the user choose providers, models, styles, objectives, and panel count
- Generates a storyboard and panel images
- Shows progress in the popup and rendered output in the side panel
- Saves local history and exports a single composite PNG comic sheet
- Supports right-click selected-text flows for instant generation or prefilled composer flow

## Main User Surfaces
- Popup: launcher, create flow, live progress, and popup history
- Side panel: comic viewer, history browser, export/share actions
- Options page: provider setup, prompt templates, storage tools, and diagnostics
- Context menu: selected-text generate and open-composer actions

## Provider Model
- Text and image providers are configured separately
- Supported providers include OpenAI, Gemini, Cloudflare Workers AI, OpenRouter, and Hugging Face
- The extension can fall back to other configured providers when a selected provider fails for budget or quota reasons

## Data Handling
- Runs locally in the browser extension runtime
- Stores settings, keys, current job state, and history in extension storage
- Sends extracted content and prompts only to the AI providers configured by the user

## Shared Engine Relationship
- The extension uses shared engine prompt-building and composition logic from [`../engine/`](../engine/)
- Engine overview: [`./engine.md`](./engine.md)
- Shared engine code helps keep storyboard and panel-generation behavior aligned across extension and bot products

## Primary Extension Docs
- Extension root README: [`../README.md`](../README.md)
- Docs index: [`./README.md`](./README.md)
- User manual: [`./user-manual.html`](./user-manual.html)
- Install guide: [`./INSTALL.md`](./INSTALL.md)
- Gemini setup: [`./Gemini_key.md`](./Gemini_key.md)
- Release notes: [`./RELEASE_NOTES.md`](./RELEASE_NOTES.md)

## Current Release Package
- Current extension release: `v1.0.4`
- Release asset: `Web2Comics-v1.0.4-extension.zip`
- GitHub release page: [`../README.md`](../README.md)
- Companion bot deploy package: [`./telegram-bot.md`](./telegram-bot.md)

## Development And Testing
- Local validation: `npm test`
- Browser E2E: `npm run test:e2e`
- Provider probing: `npm run probe:providers:extension`
