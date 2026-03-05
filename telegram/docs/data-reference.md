# Web2Comic Data & Configuration Reference

This document lists the data-focused files used by the bot/engine, what each file represents, and where it is located.

## Bot Data Modules (`telegram/src/data`)

| File | Represents | Used By |
|---|---|---|
| `telegram/src/data/messages.js` | Static bot text content and message templates (welcome/help/base labels, docs links). | `telegram/src/webhook-bot.js` |
| `telegram/src/data/options.js` | Config option catalogs (`OPTION_MAP`) and secret key names (`SECRET_KEYS`). | `telegram/src/options.js`, command validation/printing |
| `telegram/src/data/providers.js` | Provider definitions: default models, model catalog, required key mapping, provider name list. | `telegram/src/webhook-bot.js`, provider/model commands |
| `telegram/src/data/styles-objectives.js` | Objective values, style presets, style shortcuts, objective shortcuts. | `telegram/src/webhook-bot.js` |
| `telegram/src/data/thresholds.js` | Input classification thresholds (short prompt / long story length). | `telegram/src/webhook-bot.js`, `telegram/src/message-utils.js` |

## Engine Data Modules (`engine/src/data`)

| File | Represents | Used By |
|---|---|---|
| `engine/src/data/prompt-templates.js` | Prompt template fragments/rules for storyboard, style-reference, panel image prompts; includes multilingual no-text block. | `engine/src/prompts.js`, `engine/src/index.js` |

## YAML Runtime Configuration Files

| File | Represents | Notes |
|---|---|---|
| `telegram/config/default.render.yml` | Default runtime configuration for Render webhook bot (generation/runtime/providers/output defaults). | Main bot deployment baseline config |
| `comicbot/config/default.bot.yml` | Legacy/default config for `comicbot` path. | Separate from `telegram` webhook runtime |

## Runtime-Persisted Data (not source-controlled defaults)

These are data artifacts written during runtime/testing (storage backend depends on environment settings):

- User state/config: per-user config + secrets + metadata (R2 object in persistence mode).
- Request logs: request + result metadata/status (R2/file based on persistence).
- Crash logs: structured crash/error events (R2/file).
- Generated images/status indexes: panel artifacts and storage accounting metadata (R2/file).
- Known users + blacklist indexes: persisted operational lists.

Primary code paths for persisted data:

- `telegram/src/config-store.js`
- `telegram/src/persistence.js`
- `telegram/src/request-log-store.js`
- `telegram/src/crash-log-store.js`
- `telegram/src/image-storage.js`
- `telegram/src/known-users-store.js`
- `telegram/src/blacklist-store.js`

