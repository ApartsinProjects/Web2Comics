# General Development Instructions

## Product Goals
- Prioritize fast first value: default flow should be two clicks (`Create Comic` -> `Generate`).
- Keep UX streamlined and clear by default, with advanced controls available but non-intrusive.
- Make generated comics tightly grounded in the selected story/content block.
- Optimize for adoption: reliability, clarity, and share-ready output.

## UX / UI Standards
- Keep one primary CTA per step; avoid competing actions.
- Use short, action-oriented microcopy (avoid technical/system wording in primary flow).
- Ensure all panel controls are visible without horizontal scrolling.
- Use compact graphical controls where possible instead of large text buttons.
- Keep quality indicators subtle (traffic-light style for confidence/grounding).
- Use collapsible sections for advanced options and metadata.
- After generation, minimize creation UI noise and focus on viewer + sidebar flow.
- Keep history, favorites, filters, and sorting accessible without cluttering the default path.

## Content Extraction & Story Selection
- Support robust generic extraction for all sites; not only news/wiki templates.
- Add/maintain site adapters for high-traffic domains and social sources.
- Always attempt auto-pick of best story block with confidence score.
- If confidence is low, suggest narrower alternatives and allow manual selection.
- Use clear extracted-content preview and selected-story summary before generation.
- Ensure Wikipedia/news extraction reliability remains high with fallback strategies.

## Prompting & Content Quality
- Maintain strong prompt grounding to source facts, entities, dates, and numbers.
- Support objective-based prompting (summarize, learn, fun, etc.) with tuned defaults.
- Keep panel/caption regeneration faithful to the current story beat intent.
- Improve factuality controls (`more factual`, `simpler`) and verify behavior with tests.

## Sharing, Export, and Attribution
- Keep share UX simple (single button -> target menu).
- Support practical share targets and presets (X, LinkedIn, Story, Email, etc.).
- Ensure downloaded/exported comics preserve selected layout templates.
- Include attribution line in shared/downloaded assets (e.g., made with Web2Comics).

## Connections & OAuth
- Keep connectors in dedicated Options tab.
- Use standard OAuth UX only (no manual token/id entry in normal user flow).
- Show connection status clearly; enable dependent toggles only when connected.
- Ensure popup windows/auth flows are resilient and detectable.

## Reliability & Testing
- Add tests for every bugfix and every key UX flow regression.
- Cover end-to-end user paths:
  - open page
  - invoke extension
  - select objective/story
  - generate
  - view/edit/share
- Include provider-path assertions (Gemini/OpenAI/OpenRouter/HF/Cloudflare where applicable).
- Keep top-site coverage tests for multiple languages/regions.
- Add verbose debug logs in test mode only.
- Run full test suite before release and fix failing paths.

## Documentation Discipline
- Keep docs synchronized with actual behavior (README, manual HTML, release notes).
- Update backlog and strategy docs when new feature directions are added.
- Record UX reviews and findings in dedicated markdown files.

## Engineering Workflow
- Prefer minimal-risk, incremental changes with clear regression checks.
- Keep defaults fast (3 panels, fast model/image settings) unless explicitly changed.
- Preserve existing IDs/hooks to avoid breaking tests and extension wiring.
- When adding new features, include:
  - UI update
  - logic update
  - tests
  - docs update
