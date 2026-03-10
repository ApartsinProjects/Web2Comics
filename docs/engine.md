# Web2Comics Shared Engine

The shared engine is the common comic-generation core used by both the Chrome extension and the Telegram bot.

## Product Boundaries
- This document describes the shared engine as common infrastructure.
- Extension-specific UI behavior belongs in [`./extension.md`](./extension.md).
- Telegram-bot-specific transport, storage, and command behavior belongs in [`./telegram-bot.md`](./telegram-bot.md).

## Cross References
- Extension overview: [`./extension.md`](./extension.md)
- Telegram bot overview: [`./telegram-bot.md`](./telegram-bot.md)
- Engine manual source: [`../engine/manual.md`](../engine/manual.md)

## What The Engine Does
- Accepts normalized source text or fetched content
- Builds storyboard prompts
- Calls configured text and image providers
- Produces storyboard data and composed comic output
- Provides shared prompt and composition behavior across products

## Where It Is Used
- Chrome extension: page extraction feeds into shared storyboard and panel-generation logic
- Telegram bot: text, URL, PDF, image, and voice extraction feed into the same shared generation core

## Primary Engine Reference
- Full engine manual: [`../engine/manual.md`](../engine/manual.md)
- Engine source: [`../engine/src/`](../engine/src/)
- Engine CLI: [`../engine/cli/comic-engine-cli.js`](../engine/cli/comic-engine-cli.js)

## Validation
- Engine tests: `npm run test:engine`
- Docs build consumers: extension and bot overview pages both reference this engine page
