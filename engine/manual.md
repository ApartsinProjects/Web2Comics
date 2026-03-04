# Web2Comics Engine CLI Manual

## Purpose
`engine/` provides a standalone command-line comic generation engine that does not require Chrome.

It accepts:
- an input file (`.html` or `.txt`)
- a YAML configuration file (providers, models, generation and output settings)

It produces:
- a single PNG comic sheet (similar to extension download flow)

## Command
```bash
node engine/cli/comic-engine-cli.js --input <path> --config <path> --output <path> [options]
node engine/cli/comic-engine-cli.js --url <https://...> --config <path> --output <path> [options]
```

Equivalent npm command:
```bash
npm run engine:comicify -- --input <path> --config <path> --output <path>
```

## CLI Options
- `-i, --input <path>`: input file path (`.html`, `.htm`, `.txt`)
- `-c, --config <path>`: YAML config file
- `-o, --output <path>`: output PNG path
- `--url <https://...>`: fetch URL via Playwright and save HTML snapshot before generation
- `--snapshot-path <path>`: explicit snapshot HTML path (otherwise auto-generated near output PNG)
- `--fetch-timeout-ms <ms>`: Playwright page load timeout (default `45000`)
- `--title <value>`: override generated storyboard title
- `--debug-dir <dir>`: save raw storyboard/debug artifacts (`storyboard.raw.txt`, `storyboard.json`, `result.json`)
- `-h, --help`: print usage
- `-v, --version`: print CLI version

## Environment Variables
The engine loads `.env.e2e.local` and `.env.local` from repo root (if present).

Supported keys:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `HUGGINGFACE_INFERENCE_API_TOKEN` (or `HUGGINGFACE_API_KEY`)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## YAML Format
Example structure:

```yaml
input:
  format: auto           # auto|html|text
  max_chars: 14000
  strip_selectors:
    - script
    - style
    - nav
    - footer

generation:
  panel_count: 3
  objective: summarize
  output_language: en
  detail_level: low
  style_prompt: "clean comic panel art, consistent characters"

providers:
  text:
    provider: gemini     # gemini|openai|openrouter|cloudflare|huggingface
    model: gemini-2.5-flash
    api_key_env: GEMINI_API_KEY
  image:
    provider: gemini
    model: gemini-2.0-flash-exp-image-generation
    api_key_env: GEMINI_API_KEY

runtime:
  timeout_ms: 120000
  image_concurrency: 3
  retries: 1

output:
  width: 1400
  panel_height: 700
  caption_height: 120
  header_height: 120
  footer_height: 34
  padding: 24
  gap: 16
  background: "#f8fafc"
  brand: "Made with Web2Comics Engine"
```

## Included Example Configs
- `engine/examples/config.gemini.yml`
- `engine/examples/config.openai.yml`

## Example Runs
Gemini:
```bash
npm run engine:comicify -- --input engine/examples/sample-story.txt --config engine/examples/config.gemini.yml --output engine/out/gemini-comic.png --debug-dir engine/out/gemini-debug
```

OpenAI:
```bash
npm run engine:comicify -- --input engine/examples/sample-story.txt --config engine/examples/config.openai.yml --output engine/out/openai-comic.png --debug-dir engine/out/openai-debug
```

Saved HTML:
```bash
npm run engine:comicify -- --input path/to/page.html --config engine/examples/config.gemini.yml --output engine/out/page-comic.png
```

Live URL (snapshot + original flow):
```bash
npm run engine:comicify -- --url https://en.wikipedia.org/wiki/Comics --config engine/examples/config.gemini.yml --output engine/out/wiki-comic.png --debug-dir engine/out/wiki-debug
```

## Performance Notes
- Increase `runtime.image_concurrency` for faster multi-panel image generation.
- Use lower `panel_count` for lower latency.
- Keep `input.max_chars` focused to reduce storyboard latency.

## Test Command
```bash
npm run test:engine
```
