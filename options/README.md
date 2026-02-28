# options Folder

## Purpose
Extension Options page UI and settings management, provider configuration, prompts/prompt library, storage tools, and optional social/cloud connections.

## Contents
- `options.html` : Options page markup with section tabs (`General`, `Providers`, `Prompts`, `Storage`, `About`), provider cards and model selectors, prompt-template editors, and data/export controls.
- `options.css` : Options page styling for navigation, provider cards, forms, status badges, prompt editor UI, and help-link icons.
- `options.js` : Options controller for loading/saving settings, provider credential validation state, provider model test actions (`TEST_PROVIDER_MODEL`), prompt-template validation/persistence, prompt-library import, storage maintenance actions, optional Google Drive/Facebook/X OAuth connection actions, and local recommended model default import (`shared/recommended-model-set.local.json`).

## Artifacts
- No build artifacts are generated in this folder. Options actions can export user data/debug logs, but exported files are written via browser download to user-selected locations.

## Maintenance
- Update this README when files are added, removed, renamed, or when the folder purpose changes significantly.
