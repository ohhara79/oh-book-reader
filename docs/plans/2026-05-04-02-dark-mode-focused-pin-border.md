# Plan: Use white focused-pin border in dark mode

## Context

In the PDF view, when a highlight pin (amber box) is focused, its border turns black via `focus:border-black` (`components/SelectionOverlay.tsx:713`). In dark mode this border stays black because:

- Dark mode for PDF pages is implemented as a CSS invert filter on `PageSlot` (`components/PageSlot.tsx:33`, commit 49a0d9e).
- `SelectionOverlay` is rendered as a sibling of the page slots, **outside** the inverted scope, so its colors are not auto-flipped.
- Result: a black focus border on a dark background — low contrast, hard to see.

The fix mirrors how the rest of `SelectionOverlay` already adapts to dark mode (e.g. `dark:border-zinc-700`, `dark:bg-zinc-900` on lines 797, 876).

## Change

Single-line edit in `components/SelectionOverlay.tsx:713`.

Replace:
```
focus:border-black focus:outline-none
```
with:
```
focus:border-black focus:outline-none dark:focus:border-white
```

That is, append `dark:focus:border-white` to the pin button's className so the focused border is white in dark mode and black in light mode.

## Verification

1. Run the dev server and open the PDF reader.
2. In light mode: click a highlight pin — border should be black (unchanged).
3. Toggle dark mode (system or app toggle, whatever the project uses) — click a highlight pin — border should be white and clearly visible against the inverted page.
4. Confirm hover/active styles (`hover:bg-amber-500/25`, `active:bg-amber-500/40`) still look right in both modes.
