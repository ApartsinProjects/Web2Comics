# User Experience Review (Two Passes)

Date: 2026-02-28  
Scope: popup, sidepanel, options (connections), first-run path

## Pass 1: Audit (Highest-Standard Heuristics)

### 1) Clarity of next action
- Issue: readiness text mixed multiple system states in one sentence (content + provider + setup), increasing cognitive load.
- Risk: users cannot quickly identify the single action that unblocks generation.

### 2) Respect for user intent
- Issue: extras could reopen as readiness changed, even after manual close in some conditions.
- Risk: "UI is fighting me" feel.

### 3) Action hierarchy in first run
- Issue: when both provider and content were missing, guidance sometimes pushed content first.
- Risk: users spend effort on extraction before enabling the required provider.

### 4) Connections panel signal-to-noise
- Issue: Connect + Disconnect were visible at the same time for each service.
- Risk: redundant controls, weaker visual hierarchy.

### 5) Testability and regression coverage
- Issue: existing tests assumed old readiness copy and always-visible disconnect controls.
- Risk: valid UX improvements looked like regressions.

## Pass 2: Improvements Applied

### A) Popup readiness guidance: single, task-oriented message
- Implemented canonical guidance priority:
  1. Connect provider
  2. Finish provider setup
  3. Pick/select source text
  4. Ready to generate
- Result: one clear next step at any time.

### B) Popup auto-open behavior: intent-safe
- Updated section auto-open policy to avoid forced reopen after manual collapse.
- Kept auto-open limited to meaningful cases (selection fallback and first unmet settings pass).

### C) Readiness action priority fixed
- "Fix next step" now prioritizes provider connection/setup before content actions when both are unresolved.

### D) Connections UX simplified
- Added stateful action visibility in Options > Connections:
  - `Not connected`: show `Connect`
  - `Connected`: show `Disconnect`
  - `OAuth app not configured`: disable `Connect`, hide `Disconnect`
- Applied across Google Drive, Facebook, X, Instagram, and Other share target.

### E) Tests updated/expanded
- Updated popup readiness copy assertions.
- Updated popup manual-collapse behavior assertion for the new non-forced-open model.
- Added/updated options tests for one-action-at-a-time connection controls and unavailable OAuth state.
- Stabilized sidepanel fallback-link assertion to validate safety without brittle URL-normalization dependence.

## Outcome

- First-run flow is now more task-oriented.
- UI is less likely to override explicit user behavior.
- Connections tab has cleaner, state-driven controls.
- Regression coverage reflects the new UX model.

## Pass 3: Follow-up UX Hardening (Applied)

### 1) Sidepanel action clarity
- Renamed compact panel controls from short cryptic labels to clear labels:
  - `Img` -> `Image`
  - `Cap` -> `Caption`
  - `Fact` -> `Factual`

### 2) Grounding signal de-noised
- Kept grounding evidence available but reduced visual dominance:
  - subtle shell styling
  - compact traffic-light indicator (green/yellow/red)
  - small count badge
- Improved fact relevance by filtering entity chips against panel caption/snippet context before display.

### 3) Per-panel action menu reliability
- Improved "More" action popover affordance and z-index layering.
- Added auto-close behavior when selecting a menu action to prevent stuck/hidden popovers.

### 4) Readability and control polish
- Increased caption readability contrast and spacing.
- Improved pill/button contrast, hit-area, and hover state clarity.
- Refined viewer stat chip legibility.

### 5) Test alignment and stability
- Updated integration tests for renamed panel actions and grounding behavior.
- Hardened objective flow test timing for popup generation readiness.
- Updated Playwright extension UI checks to match current layout-preset based sidepanel flow and composer section behavior.
