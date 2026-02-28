# Adoption UX Growth Plan

Date: 2026-02-27
Owner: Product + UX + Engineering

## Goal
Increase user adoption by making first success fast, reliable on major sites (especially Wikipedia), and easy to share.

## Priority Initiatives (Requested)

1. Make first success under 15 seconds by default.
- Set fast defaults: 3 panels, low detail, Gemini fast-first path, lightweight image settings.
- Success metric: p50 "Create Comic -> first rendered panel" < 15s on supported pages.

2. Ship explicit "Wikipedia mode" extraction profile.
- Add site-specific extraction heuristics and UI hinting for Wikipedia page structures.
- Success metric: extraction success > 95% on top Wikipedia pages in test set.

3. Replace technical readiness text with task-oriented guidance.
- Use action copy like "Select article section to continue".
- Success metric: lower "disabled generate" abandonment rate.

4. Add one-click "Auto-pick best story section" with confidence score.
- Default auto-pick; show manual block picker only when confidence is low.
- Success metric: manual block selection usage decreases without quality drop.

5. Introduce guided first-run with two clicks only.
- Flow target: Create Comic -> Generate.
- Hide advanced controls until first successful generation.
- Success metric: first-run completion rate increase.

6. Provide inline "Regenerate panel/caption" controls in viewer.
- Enable per-panel fixes without re-running whole job.
- Success metric: fewer full reruns per completed comic.

7. Add quality guardrails before generation.
- Detect overly broad/generic extraction; offer 2-3 focused segment options.
- Success metric: higher caption relevance score on first attempt.

8. Create share-first output formats.
- One-click presets for X, LinkedIn, Slides including title/source attribution.
- Success metric: export/share action rate increase.

9. Add trust/transparency layer.
- Show "facts used" (entities/dates/numbers) per panel.
- Success metric: increased trust score in user feedback.

10. Build growth loop with templates/use-cases.
- Presets: News recap, Wiki explainer, Meeting notes to comic, Learning summary.
- Success metric: higher repeat usage across varied page types.

## Immediate Implementation Status

- Implemented now:
  - Fast-first defaults aligned in runtime/shared settings.
  - Task-oriented readiness messaging in popup.
- Planned next:
  - Wikipedia extraction mode + confidence scoring + auto-pick.
  - Guided first-run simplification and post-success progressive disclosure.
  - Viewer inline regeneration + trust/share features.
