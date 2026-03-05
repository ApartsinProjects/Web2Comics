# Web2Comic Bot User Manual

Cross references:
- Extension README (Markdown): [`../../README.md`](../../README.md)
- Extension user manual (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/user-manual.html>
- Bot docs bridge page (Markdown): [`../../docs/telegram-bot.md`](../../docs/telegram-bot.md)
- Bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

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
- `/keys` key status

## Generation Controls
- `/vendor <name>`
- `/text_vendor <name>`
- `/image_vendor <name>`
- `/language <code>`
- `/consistency <on|off>` enable style-consistency flow (supported image models only)
- `/crazyness <0..2>` control story-invention temperature (higher = wilder twists)
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
- Apply options via dedicated commands (`/objective`, `/panels`, `/mode`, `/vendor`, `/models`, `/language`, etc.)

If `/options` is called without required args, the bot explains usage and lists valid paths/options.

## Story Modes
- Normal text: generate directly
- Very short prompt: bot first expands story with AI, shows invented story, then generates comic
- URL input: bot renders page content and uses it as source

## Image Prompt Context
For each panel image, the bot sends context that includes:
- storyboard title
- short storyboard summary
- panel caption
- panel visual brief (`image_prompt`)

This keeps panel visuals coherent across the full story.

## Consistency Mode
- Default: `off`
- Command: `/consistency on` or `/consistency off`
- When enabled, after storyboard generation the bot first creates one summary style-reference image.
- Then each panel uses prompt text that explicitly asks to follow that reference style and passes the summary image as reference input.
- This is used only when the active image provider/model supports image-as-input; otherwise the bot falls back to normal panel generation.

## Panel Output Details
- Watermark is configurable and defaults to `off`
- Bot messages/photos are forwardable (content protection is disabled)

## Reset And Recovery
- `/reset_config` clear runtime overrides
- `/restart` reset user state and re-onboard
- `/unsetkey <KEY>` remove runtime key override

## Hidden/Admin Features
Standard users do not see admin commands in `/help`.

