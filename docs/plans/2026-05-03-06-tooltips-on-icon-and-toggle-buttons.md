# Plan: Tooltips on header icon buttons and thread-list toggles

## Context

The header in `components/Reader.tsx` recently switched its Prev/Next/Zoom controls from text labels to icon-only buttons (chevrons, plus/minus). They have `aria-label` for screen readers, but no visible hover hint — sighted users have no on-hover confirmation of what each icon does.

Separately, the thread list toggles in `components/ThreadList.tsx` show short labels ("This page" / "All pages" and "Date" / "Page") whose meaning isn't obvious in isolation — particularly for "Date"/"Page", where "Page" could be confused with the "This page" filter on its left.

Goal: add native `title` tooltips so a user hovering any of these controls sees a one-line hint. Use the native `title` attribute, matching the existing pattern at `components/Reader.tsx:789` (sidebar toggle) — no new tooltip component is needed and the codebase already does this elsewhere (CopyButton, ConversationPanel, SelectionOverlay).

## Changes

### 1. Header icon buttons — `components/Reader.tsx`

Add a `title` attribute alongside the existing `aria-label` on each of the four icon buttons. Keep the wording short and identical to the aria-label so screen-reader and visual hint stay in sync:

| Line | Button | Add |
|------|--------|-----|
| 665–685 | Prev page (`<`) | `title="Previous page"` |
| 708–728 | Next page (`>`) | `title="Next page"` |
| 730–751 | Zoom out (`−`) | `title="Zoom out"` |
| 755–777 | Zoom in (`+`) | `title="Zoom in"` |

No other props change. Sidebar toggle at line 779 already has `title` and is left as-is.

### 2. Filter / sort toggles — `components/ThreadList.tsx`

The `FilterButton` helper at `components/ThreadList.tsx:260–282` currently accepts only `active`, `onClick`, `children`. Extend it with an optional `title?: string` prop that is forwarded to the underlying `<button>`.

Then at the four call sites (lines 179–198), pass a `title` describing what the toggle actually does (not just restating the label):

| Lines | Label | `title` |
|-------|-------|---------|
| 179–184 | This page | `"Show threads on the current page"` |
| 185–190 | All pages | `"Show threads from every page"` |
| 193–195 | Date | `"Sort by most recently updated"` |
| 196–198 | Page | `"Sort by page number"` |

The hints intentionally describe the *result* of clicking, since the labels alone (especially "Date"/"Page") are ambiguous.

## Files modified

- `components/Reader.tsx` — 4 `title` attributes added (no logic change)
- `components/ThreadList.tsx` — extend `FilterButton` props with optional `title`, pass through to `<button>`, add `title` to 4 call sites

## Verification

1. `npm run dev` and open a book in the reader.
2. Hover each header icon button (`<`, `>`, `−`, `+`) — the browser's native tooltip should appear after ~1s with the expected text.
3. Open the conversation panel and hover each of the four toggle buttons — confirm the hint text appears and clearly disambiguates "Date" vs "Page".
4. Run `npm run typecheck` (or `tsc --noEmit`) to confirm the new `title?: string` prop on `FilterButton` type-checks at all call sites.
