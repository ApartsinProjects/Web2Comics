# Docs Index

Project documentation and user-facing reference pages for Web2Comics.

## Start Here
- `index.html` : GitHub Pages landing page for docs, policy, and support links.
- `ROOT_README.md` : release-oriented README snapshot used by packaging checks.
- `INSTALL.md` : installation + first-run guide.
- [`user-manual.html`](./user-manual.html) : end-user manual (popup, side panel, options, workflows).
- [`telegram-bot.md`](./telegram-bot.md) : Telegram bot overview, deployment, and testing links.
- `RELEASE_NOTES.md` : versioned release history.
- Extension root README (GitHub): <https://github.com/ApartsinProjects/Web2Comics/blob/main/README.md>
- Telegram bot README (GitHub): <https://github.com/ApartsinProjects/Web2Comics/blob/main/telegram/README.md>
- Telegram bot docs page (GitHub Pages): <https://apartsinprojects.github.io/Web2Comics/HTML/telegram-bot.html>

## Product and Strategy Docs
- `Product_Backlog.md` : categorized backlog.
- `Use_Cases_Beyond_Entertainment.md` : practical/professional use cases.
- `Monetization_Strategies.md` : monetization options.
- `brainstorm.md` : PM brainstorming outcomes.
- `ChangeRequests/` : proposal/change-request notes.

## Setup and Integration Docs
- `Gemini_key.md` : Gemini key setup.
- `google-drive-oauth-setup.md` : Google Drive OAuth setup notes.
- `permissions-audit.md` : Chrome extension permission rationale.

## Legal and Support Pages
- `privacy.html` : privacy note.
- `terms.html` : terms.
- `support.html` : support/help page.

## Internal References
- `initial_specs.md` : early architecture/spec baseline (historical reference).
- `instructions.md` : current development guidance.

## Notes
- Some docs are strategic/planning artifacts and do not imply implementation status.
- Keep docs synchronized with current UI labels and flows (`Comicify!`, `My Collection`, `Create Comic -> Generate` default path).

## Build HTML from Markdown
- Default build (rewrites `.md` links to `.html`, keeps root `.html` links working, drops shield badges from generated HTML):
  - `npm run docs:build`
- Keep badge lines in generated HTML:
  - `npm run docs:build:keep-badges`
