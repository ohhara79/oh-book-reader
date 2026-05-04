# Wrap arrow-key focus across pages in "This page" filter

## Context

Plan `2026-05-04-07` added arrow-key wraparound at thread/pin list boundaries. In `"This page"` filter mode it preserved the existing same-direction page-step (jump to a neighbouring page that has threads) and only wrapped within the current page's `visibleRows` as a fallback.

That fallback turned out to be wrong for the user. With the cursor on the first item of the *first* page that has threads, `ArrowUp` walks `sortedRows[sortedIdx - 1 .. 0]` looking for a row not on `currentPage`, finds nothing, then wraps to the *current* page's last item. The user expects it to land on the *last* page's last item — i.e. wrap should keep walking `sortedRows` past the array boundary instead of falling back to the current page. Symmetric problem on `ArrowDown` from last-page-last-item.

## Approach

In `components/ThreadList.tsx` (the per-row `onKeyDown` handler at lines 381–457), after the existing forward/backward page-step search exhausts without a match, run a second loop that scans the *other* portion of `sortedRows`:

- `ArrowDown`: after scanning `sortedRows[sortedIdx + 1 .. end]`, scan `sortedRows[0 .. sortedIdx - 1]` and navigate to that row's first page (`target.pages[0]`).
- `ArrowUp`: after scanning `sortedRows[sortedIdx - 1 .. 0]`, scan `sortedRows[end .. sortedIdx + 1]` backward and navigate to that row's last page (`target.pages[target.pages.length - 1]`).

Skip rows that include `currentPage` (would just stay on the same page) and rows with no pages at all (`continue`, not `return`, so a single malformed row doesn't kill the wrap).

The existing `buttonRefs.current[0]` / `buttonRefs.current[visibleRows.length - 1]` final fallback stays — it's still reachable when literally every thread is on `currentPage` and no other page exists to wrap to.

## Critical files

- `components/ThreadList.tsx` — the `onKeyDown` handler only.

## Verification

Manual, in `npm run dev`:

1. Open a book with threads on multiple pages, set filter to "This page".
2. Navigate to the first page that has threads. Focus its first thread, press `ArrowUp` → page changes to the last page that has threads, focus lands on its last thread.
3. Navigate to the last page that has threads. Focus its last thread, press `ArrowDown` → page changes to the first page that has threads, focus lands on its first thread.
4. Mid-list page-stepping (Down on the last row of an interior page jumps to the next page with threads) still works.
5. On a book where only one page has threads at all, set filter to "This page": `ArrowDown` on the last row still wraps to the first row of that page; `ArrowUp` on the first row wraps to the last (the final fallback).
