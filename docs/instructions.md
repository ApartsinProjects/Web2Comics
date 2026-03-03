# General Development Instructions

## Product Goals
- Prioritize fast first value: default flow is two clicks (`Create Comic` -> `Generate`).
- Keep UX streamlined by default, with advanced controls available but unobtrusive.
- Keep generated output grounded in selected source text/story.
- Optimize for reliability, clarity, and practical share outcomes.

## UX / UI Standards
- Keep one primary CTA per step.
- Use short, action-oriented microcopy.
- Avoid hidden-critical controls and horizontal scrolling in main flows.
- Keep confidence/quality indicators compact and non-intrusive.
- Prefer collapsible sections for advanced controls and diagnostics.

## Content and Prompt Quality
- Use robust extraction across generic sites and known high-traffic adapters.
- Auto-pick best story block when confidence is high; allow manual override.
- Keep panel/caption regeneration faithful to the same story beat intent.
- Keep image prompts explicit: one scene per panel, no collage/split layouts, no caption text overlays unless requested.

## Share, Export, and Attribution
- Keep sharing UX simple (single action -> connected target list).
- Preserve layout fidelity between viewer and downloaded output.
- Include attribution where required by product policy.

## Testing and Reliability
- Add tests for each bugfix and critical UX flow.
- Cover key end-to-end path: open page -> create -> generate -> view/edit/export.
- Add verbose logging in test mode only.
- Run full suite before release.

## Documentation Discipline
- Update README, install guide, release notes, and user manual for behavioral/UI changes.
- Keep terminology consistent (`My Collection`, `Comicify!`, `Create Comic`).
- Store docs under `docs/`.
