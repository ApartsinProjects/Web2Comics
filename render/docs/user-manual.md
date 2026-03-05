# Web2Comic Bot User Manual

## What The Bot Does
Send plain text or a URL, and the bot generates comic panels and sends them back as ordered Telegram images.

Panel captions are prefixed as `X(Y)`:
- `X` = current panel number
- `Y` = total panel count

## Quick Start
1. Send `/start`
2. Send `/help`
3. Run `/user` to get your Telegram id
4. Add provider key with `/setkey GEMINI_API_KEY <YOUR_KEY>` (or ask admin for shared access)
5. Send a story or URL

## Core Commands
- `/help` command list
- `/about` creator and project links
- `/config` current runtime config
- `/presets` common options
- `/user` show your Telegram id
- `/keys` or `/credentials` key status

## Generation Controls
- `/vendor <name>`
- `/text_vendor <name>`
- `/image_vendor <name>`
- `/language <code>`
- `/panels <count>`
- `/objective` list objectives
- `/objective <name>` set objective
- `/style <preset>`
- `/set_style <text>`
- `/detail <low|medium|high>`
- `/concurrency <1..5>`
- `/retries <0..3>`

## Prompt Controls
- `/prompts` show active prompt templates
- `/set_prompt story <text>`
- `/set_prompt panel <text>`
- `/set_prompt objective <name> <text>`

## Options UI In Chat
- `/list_options` list all config paths with predefined options
- `/options <path>` show numbered options for one path
- `/choose <path> <number>` choose by index
- `/set <path> <value>` set value directly

If `/options` or `/choose` is called without required args, the bot explains usage and lists valid paths/options.

## Story Modes
- Normal text: generate directly
- Very short prompt: bot first expands story with AI, shows invented story, then generates comic
- URL input: bot renders page content and uses it as source

## Reset And Recovery
- `/reset_config` clear runtime overrides
- `/reset_default` same as reset config
- `/restart` reset user state and re-onboard
- `/unsetkey <KEY>` remove runtime key override

## Hidden/Admin Features
Standard users do not see admin commands in `/help`.

