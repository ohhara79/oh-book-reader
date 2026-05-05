# Collapse the font-resize UI into a single icon + popover

## Context
In the conversation thread view header, font resize is currently three inline elements — `A−`, `100%`, `A+` — that take ~120px of horizontal space alongside Delete / Download / Share / Close. On narrow widths the row wraps. Replace the inline trio with a single `Aa` icon button that opens a small popover containing the existing A− / 100% / A+ controls, freeing toolbar space while preserving the increment-style interaction.

## Current state
- Toolbar lives in `components/ConversationPanel.tsx` lines **1110–1140** (the three font buttons), inside the `ml-auto flex items-center gap-1` group that also holds delete/download/share/close.
- State: `fontZoom` (`useState`, line 261) + `decFontZoom` / `incFontZoom` / `fontPercent` (lines 273–281).
- Constants: `MIN_ZOOM=0.7`, `MAX_ZOOM=1.5`, `ZOOM_STEP=0.1`, persisted to `localStorage["ohbr.messageFontZoom"]`.
- No icon library — icons are inline SVGs (e.g. `FilterIcon` in `components/ThreadList.tsx:546`).
- Existing dropdown patterns: `AppMenu.tsx:19` and `IconMenu` in `ThreadList.tsx:487` (both manage open state, click-outside, and Escape).

## Design
**Trigger button** — single `h-7 w-7` icon button matching its toolbar siblings. Renders a 16×16 inline SVG of two `A` glyphs (small + large) drawn with the same `strokeWidth="1.5"` round-cap stroke style as the sibling delete/download/share/close icons, so the toolbar reads as a uniform set of icons rather than a mix of text and SVG.

**Popover body** — anchored under the trigger (`absolute right-0 top-full mt-1`), styled like `IconMenu`'s panel (`rounded border border-zinc-200 bg-white shadow-md` + dark variants). Inside: the current `A−`, `{fontPercent}%`, `A+` controls reused verbatim — same handlers, same disabled states, same aria labels. This preserves the existing interaction and avoids re-deriving min/max/step logic.

**Open/close behavior** — mirror `AppMenu` / `IconMenu`:
- `useState` for open, `useRef` on wrapper for click-outside
- `mousedown` outside closes; `Escape` closes
- `aria-haspopup="dialog"`, `aria-expanded`, `aria-label="Font size, currently {fontPercent}%"`

## Files to change
- `components/ConversationPanel.tsx`
  - Add `fontMenuOpen` state + wrapper ref + close-on-outside/Escape effect (place near the existing `fontZoom` state around line 261).
  - Replace lines **1110–1140** with the trigger button and conditional popover.
  - No changes to `MIN_ZOOM`/`MAX_ZOOM`/`ZOOM_STEP`/persistence/handlers.

## Verification
1. `npm run dev`, open a conversation thread.
2. Header now shows a single SVG icon button (two A's, small + large) before delete/download/share/close.
3. Click it → popover opens with `A− 100% A+`. Clicking outside or pressing `Escape` closes it.
4. `A−` / `A+` adjust font size; disabled at 70% and 150% respectively; percentage updates live.
5. Reload — font size persists (localStorage).
6. Dark mode: trigger and popover render with the dark variants (test by toggling system theme).
7. Narrow the window — the toolbar no longer wraps because of the font controls.
