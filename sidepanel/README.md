# sidepanel Folder

## Purpose
Comic viewer side panel UI, history browser, layouts/carousel, export/download/share behavior, and per-panel quick edit controls.

## Contents
- `sidepanel.html` : Side panel markup for `Comic View` and `History Browser`, generation progress view, layout preset selector, strip/panel/carousel modes, share target selector, viewer counters, history cards, and help links to the manual.
- `sidepanel.css` : Styles for comic layouts (strip/grid/carousel), generation placeholders/status shell, history browser cards/grid, keyboard focus states, and export/comic-view presentation.
- `sidepanel.js` : Side panel controller that renders generated comics and progress, supports layout presets and view switching, history browser chunked loading + keyboard navigation, per-panel quick edit actions (regenerate panel/caption, factual/simpler rewrites, jump-to-source), share actions, and composite PNG export/download.

## Artifacts
- No persistent artifacts are created in this folder. Download/export actions generate image files through browser downloads (saved outside the repo unless tests capture them).

## Maintenance
- Update this README when files are added, removed, renamed, or when the folder purpose changes significantly.
