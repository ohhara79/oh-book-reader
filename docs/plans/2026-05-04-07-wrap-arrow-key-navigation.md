# Wrap arrow-key navigation at list boundaries

## Context

In two places the user can move a focus through "thread items" with `ArrowUp` / `ArrowDown`:

1. **Conversation thread list view** — `components/ThreadList.tsx` (sidebar list of threads).
2. **PDF view pin overlay** — `components/SelectionOverlay.tsx` (the amber selection pins overlaid on PDF pages).

Today both stop at the boundary:
- `ThreadList` returns early when at the last/first row (lines 381–428). It only takes additional action in the `"page"` filter mode, where it page-steps to neighbouring pages that have threads — but in the `"all"` filter, or when there is no neighbouring page with threads, nothing happens.
- `SelectionOverlay` clamps the index with `Math.min(i + 1, sortedPins.length - 1)` / `Math.max(i - 1, 0)` (lines 749–758), so pressing past the boundary just keeps focus where it is.

The user wants the focus to wrap: pressing `ArrowDown` on the last item should land on the first, and `ArrowUp` on the first should land on the last — in both views.

## Changes

### 1. `components/ThreadList.tsx` — wrap within `visibleRows`

Lines 381–428, inside the per-row `<button>`'s `onKeyDown`.

**`ArrowDown`** (currently lines 382–403):
- If `idx < visibleRows.length - 1`: focus `buttonRefs.current[idx + 1]` (unchanged).
- Otherwise (at the last visible row):
  - If `filter === "page"` and `onRequestPageChange` is provided, run the existing page-step search. If a target page is found, navigate to it (unchanged behaviour).
  - If no page-step happens (either because the filter isn't `"page"`, or no other page contains a thread), wrap by focusing `buttonRefs.current[0]`.

**`ArrowUp`** (currently lines 404–427): symmetric — wrap to `buttonRefs.current[visibleRows.length - 1]` when at the first row and no page-step fires.

This keeps the existing `"page"`-filter page-stepping intact and only adds a wrap fallback when nothing else would happen.

### 2. `components/SelectionOverlay.tsx` — modular wrap across all pins

Lines 749–758, inside the per-pin `<button>`'s `onKeyDown`.

Replace the clamped indices with modular arithmetic over `sortedPins.length`:

```ts
if (e.key === "ArrowDown") {
  e.preventDefault();
  if (sortedPins.length === 0) return;
  const next = (i + 1) % sortedPins.length;
  pinButtonRefs.current[next]?.focus();
} else if (e.key === "ArrowUp") {
  e.preventDefault();
  if (sortedPins.length === 0) return;
  const prev = (i - 1 + sortedPins.length) % sortedPins.length;
  pinButtonRefs.current[prev]?.focus();
}
```

Notes:
- Pins are already sorted by `(page, top, left)` (lines 644–648), so wrapping from last to first naturally moves from the bottom-most pin on the last page to the top-most pin on the first page.
- `.focus()` will scroll the wrapped pin into view automatically (the existing per-page-change blur effect at lines 656–672 only blurs; it doesn't fight focus).
- The `tabIndex={p.isPrimary ? 0 : -1}` distinction is unaffected — arrow keys deliberately walk through every pin (per the comment at line 595), and only Tab uses primary pins.

## Critical files

- `components/ThreadList.tsx` (lines 381–428)
- `components/SelectionOverlay.tsx` (lines 749–758)

No other files need to change. No new utilities or shared helpers — the two handlers stay self-contained because the boundary semantics differ (ThreadList preserves a page-step, SelectionOverlay does pure wrap).

## Verification

Manual, in a browser running `npm run dev`:

1. **ThreadList — `"all"` filter**
   - Open the thread list, set filter to "All pages".
   - Click the first thread, press `ArrowUp` → focus moves to the last thread.
   - Click the last thread, press `ArrowDown` → focus moves to the first thread.

2. **ThreadList — `"page"` filter, page has threads on other pages**
   - Set filter to "This page" on a page that has threads, on a book where other pages also have threads.
   - At the last thread on the current page, press `ArrowDown` → page changes to the next page with threads (existing behaviour preserved).
   - Same for `ArrowUp` → previous page with threads.

3. **ThreadList — `"page"` filter, no other page has threads**
   - On a book where only the current page has threads, set filter to "This page".
   - Press `ArrowDown` on the last row → wraps to the first row.
   - Press `ArrowUp` on the first row → wraps to the last row.

4. **SelectionOverlay (PDF pins)**
   - Open a PDF with multiple pins across multiple pages.
   - Tab into the first pin, press `ArrowUp` → focus jumps to the last pin (and the page scrolls to it).
   - Tab/arrow to the last pin, press `ArrowDown` → focus jumps to the first pin.
   - Confirm intermediate `ArrowUp` / `ArrowDown` between pins still works as before.

5. **No regressions**
   - With a single thread / single pin, arrow keys keep focus on it (wrap to itself, no error).
   - Empty list (no threads / no pins): handler is unreachable because nothing is focusable; sanity-check no console errors.
