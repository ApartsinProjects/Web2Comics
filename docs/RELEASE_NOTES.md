# Web2Comics Release Notes

## v1.0.3 (2026-03-03)

### Highlights
- Updated README badges and release links for the new release artifact.
- Refreshed installation documentation and root docs references to `v1.0.3`.
- Published new packaged extension ZIP for Chrome unpacked installation flow.
- Clarified terminology and docs consistency (`My Collection`, share targets, docs index, canonical `docs/instructions.md`).

### Packaging
- Release artifact: `Web2Comics-v1.0.3-extension.zip`
- Built via: `scripts/package-release.ps1`

## v1.0.2 (2026-02-28)

### Highlights
- Improved context-menu generation reliability and settings propagation.
- Added broader integration coverage for context-menu generation/composer flows.
- Hardened popup integration tests to reduce readiness-related flakiness.
- Expanded resilience checks for side-panel/popup fallback behavior.

### Quality
- Full automated test suite executed:
  - `npm run test`
  - `npm run test:e2e`

### Packaging
- Release artifact: `Web2Comics-v1.0.2-extension.zip`
- Built via: `scripts/package-release.ps1`
