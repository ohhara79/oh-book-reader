# Cap PDF and font zoom at 300%

## Context

PDF zoom and font zoom both currently top out at 500% (`SCALE_MAX = 5` at `components/Reader.tsx:71`, `MAX_ZOOM = 5.0` at `components/ConversationPanel.tsx:75`). The user wants both ceilings lowered to 300%. Every call site already references the constants — buttons / sliders / keyboard / wheel / pinch-zoom all clamp through `SCALE_MAX` and `MAX_ZOOM` — so the change is two single-line edits.

Persisted zoom values are also clamped through the same constants on load:
- PDF scale: `Math.min(SCALE_MAX, Math.max(SCALE_MIN, stored.scale))` (`Reader.tsx:192`).
- Message and list font zoom: `Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n))` inside `readZoomFromKey` (`ConversationPanel.tsx:231`).

So a previously-persisted 4× or 5× zoom from a user's localStorage will be quietly pulled down to 3 the next time the page loads — nothing in storage needs to be wiped manually.

## Plan

### `components/Reader.tsx`

Change `SCALE_MAX = 5` to `SCALE_MAX = 3` (line 71).

### `components/ConversationPanel.tsx`

Change `MAX_ZOOM = 5.0` to `MAX_ZOOM = 3.0` (line 75). This affects both the message font zoom and the thread-list font zoom (they share `MAX_ZOOM`).

That's the entire change. No call-site edits, no migration needed.

## Critical files

- `components/Reader.tsx:71` — `SCALE_MAX`.
- `components/ConversationPanel.tsx:75` — `MAX_ZOOM`.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual:
  1. Open a PDF; the zoom popover slider should top out at 300%, the `+` button should disable at 300%, and `+` keypress should clamp at 300%.
  2. Pinch-zoom in past 300% should hit the cap (release lands at 300%).
  3. In the conversation panel, click the `aA` font menu — slider tops out at 300%, `A+` button disables at 300%.
  4. Same for the thread-list-view font menu.
  5. If you previously had `ohbr.book.<id>` saved with `scale: 5`, after this change the next load shows the document at 300% (clamped on read). Same for `ohbr.messageFontZoom` / `ohbr.threadListFontZoom`.
