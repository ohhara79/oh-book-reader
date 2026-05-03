# Plan: Add example screenshot to README

## Context

A sample screenshot has been placed at `docs/examples/oh-book-reader.png` (~820 KB). The README currently has no visual preview of the app, so a new reader pulling up the repo can't tell at a glance what "PDF reader with Claude-powered Q&A on selected regions" actually looks like. Embedding the screenshot near the top of the README gives that visual context.

## Change

Edit `README.md` only. Add a screenshot reference immediately after the introductory paragraph (after line 3) and before the `## Prerequisites` heading. This placement makes the screenshot the first thing a reader sees after the one-paragraph description, before the setup instructions.

Use a standard markdown image embed with a relative path so it renders correctly on GitHub and in any local markdown viewer:

```markdown
![oh-book-reader screenshot](docs/examples/oh-book-reader.png)
```

Alt text mirrors the repo name to keep it concise and meaningful for screen readers / fallback rendering.

## Files to modify

- `README.md` — insert the image embed after line 3 (the description paragraph), with a blank line separating it from the surrounding content.

## Out of scope

- No new heading like `## Screenshot` — the image speaks for itself in this short README and a heading would add structure the doc doesn't otherwise need.
- No changes to the screenshot file itself; it has already been added by the user.
- No other README rewrites.

## Verification

1. Open `README.md` in a local markdown previewer (or `gh` / GitHub web UI after pushing) and confirm the screenshot renders inline between the intro paragraph and the Prerequisites section.
2. Confirm the relative path resolves: `ls docs/examples/oh-book-reader.png` from repo root.
3. Visually sanity-check that the embedded image isn't oversized in the rendered view; if it is, the markdown embed already lets GitHub scale it — no extra HTML needed.
