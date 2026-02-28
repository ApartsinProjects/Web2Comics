# Web2Comics Product Backlog

This backlog is organized into 10 categories with 24 feature candidates.

## 1. Onboarding and Activation

1. **Two-click first run wizard**
   - Force initial flow to `Create Comic -> Generate` with all advanced settings hidden until first success.
2. **Interactive first-result tour**
   - After first comic, show a short guided overlay for `Edit`, `Share`, `Remix`, and `History`.

## 2. Content Extraction and Grounding

3. **Universal extraction pipeline v2**
   - Blend readability, semantic chunking, and adapter rules with fallback scoring for all domains.
4. **Auto-select best segment with confidence**
   - Preselect the best block and only show manual block picker when confidence is below threshold.

## 3. Prompting and Story Quality

5. **Objective-aware prompt templates**
   - Tune prompts by objective (`Summarize`, `Learn step-by-step`, `ELI5`, `Compare views`, etc.).
6. **Narrative coherence checks**
   - Add pre-generation checks to ensure panel sequence has beginning, middle, end, and key facts.

## 4. Editing and Regeneration

7. **Per-panel quick actions**
   - Add `Regenerate panel`, `Regenerate caption`, `Make simpler`, `Make more factual`.
8. **Batch rewrite controls**
   - One-click rewrite for all captions by tone (`Professional`, `Playful`, `Neutral`, `Educational`).

## 5. Sharing and Distribution

9. **Social export presets**
   - Presets for X, LinkedIn, Instagram Story cover, Facebook feed, and email card.
10. **Post-package export bundle**
   - Export zip containing image variants, caption text, hashtags, and source attribution card.

## 6. Collaboration and Review

11. **Shareable review links**
   - Create secure link for collaborators to comment on captions and approve/reject panels.
12. **Versioned comic drafts**
   - Maintain edit history with restore points and side-by-side draft comparison.

## 7. Trust, Transparency, and Safety

13. **Per-panel facts used panel**
   - Show extracted entities, dates, and numbers with source snippets per panel.
14. **Grounding risk warnings**
   - Warn when generated captions drift from extracted content and suggest tighter scope.

## 8. Performance and Reliability

15. **Sub-15s first panel mode**
   - Optimize default model/settings for first visible panel under 15 seconds on typical pages.
16. **Domain-level reliability telemetry**
   - Track extraction/generation success rates by domain and auto-enable fallback strategies.

## 9. History, Organization, and Retrieval

17. **Advanced history filters**
   - Filter by date, provider, objective, language, source domain, and favorites.
18. **Saved collections**
   - Let users group comics into named collections (for projects, classes, campaigns).

## 10. Ecosystem and Integrations

19. **Cloud backup connectors**
   - Optional automatic backup to Google Drive/Dropbox in structured project folders.
20. **Template marketplace**
   - Curated templates for jobs-to-be-done (`News recap`, `Meeting notes`, `Study guide`, `Explainer`).
21. **Audio comics mode**
   - Generate narrated comic tracks (panel-by-panel voiceover + optional SFX/music bed) for accessibility and podcast-style sharing.
22. **Image2Image grounding with user/site visuals**
   - Let users include uploaded images and extracted on-page images as visual references, then use image2image models to keep comics grounded in real visual context.
23. **Comic-to-video generation**
   - Convert comics into short videos (pan/zoom transitions, subtitles, voiceover, and social-ready aspect ratios) for higher engagement sharing.
24. **YouTube/video as first-class content source**
   - Add adapters for YouTube pages and other video sources to extract transcript, chapters, title/description, and key timeline moments as comic-ready input.

---

## Suggested Prioritization (Now / Next / Later)

- **Now**: 1, 3, 4, 5, 9, 15
- **Next**: 7, 10, 13, 14, 17, 22
- **Later**: 2, 6, 8, 11, 12, 16, 18, 19, 20, 21, 23, 24
