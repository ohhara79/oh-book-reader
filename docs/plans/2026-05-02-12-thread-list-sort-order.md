# Add sort order option to ThreadList

## Context

The conversation thread list (`components/ThreadList.tsx`, added in the previous "thread list in empty panel" change) sorted threads only by `updated_at` desc with `conv.id` as a stable tiebreak. With many threads spread across a book, "by date" is fine for "what was I just working on" but useless for "walk through the threads in reading order." The user asked for a second sort mode — "By page" — surfaced as a UI toggle alongside the existing "This page / All pages" filter.

Two threads can share a page or even the same selection, so the page-sort needs a deterministic in-page tiebreak. The existing `SelectionSpan` already carries `bbox: [left, top, width, height]` (confirmed against `components/SelectionOverlay.tsx:497-500`, which renders it as CSS top-left), so reading-order on the page (top y, then left x) is a natural secondary key.

The list is rendered both in the in-thread panel and in the empty-conversation panel, but both go through the same `ThreadList`, so this was a single-file change.

## Files changed

- `components/ThreadList.tsx` — type widened to expose bbox; `Row` extended with sort keys; `sort` state and a second segmented control added.

## Implementation

### Type widening

`ThreadListSelection.spans` previously dropped bbox at the type boundary (`{ page: number }[]`). Widened to `{ page: number; bbox: [number, number, number, number] }[]`. Reader's `Sel` type already carries bbox, so the structural type check in `Reader.tsx` and `ConversationPanel.tsx` continues to pass with no changes there.

### Sort keys on `Row`

`Row` gained `sortTop: number` and `sortLeft: number`. They are computed once inside the existing `useMemo` that builds `allRows`: for each selection, find the spans on the *minimum* page (`pages[0]`) and take the smallest `bbox[1]` and `bbox[0]` among them. Defaults to `Number.POSITIVE_INFINITY` so selections with no spans sort to the bottom deterministically.

The `useMemo` was also split: `allRows` now only builds the rows (no sort), and a second `sortedRows` memo applies the comparator chain that depends on `sort`. `visibleRows` filters `sortedRows` by the page filter as before.

### Comparator chains

- `"date"` — `b.updated_at - a.updated_at`, then `a.id` vs `b.id`. Identical to the prior behavior.
- `"page"` — `pages[0]` asc, then `sortTop` asc, then `sortLeft` asc, then `updated_at` desc (multiple convs sharing one selection — most recent first), then `id` for stability.

### UI

Reused the existing `FilterButton` segmented-control component. The toolbar row was rewrapped in `flex flex-wrap` so the new `[ Date | Page ]` group sits next to `[ This page | All pages ]` on wide layouts and wraps to the next line on the narrow conversation panel. Sort state is local React state, defaults to `"date"` so first paint is unchanged. Not persisted to localStorage / URL — matches how `filter` already works.

## Edge cases

- **Same selection, multiple conversations** — same page and bbox, so the page comparator falls through to `updated_at` desc, then `id`. Stable, and the most recent thread is on top.
- **Multi-page selection** — sorted by `pages[0]` (the minimum page), which matches the badge logic that already shows `p.12–14` from min/max.
- **Selection with no spans** — `pages[0]` is `undefined` → coerced to `+Infinity`, sortTop/sortLeft also `+Infinity`. Sinks to the bottom in page mode without throwing.
- **Bbox coordinate system** — `[left, top, width, height]` with top-left origin (CSS-style), confirmed via `SelectionOverlay.tsx:497-500`. Sorting by `bbox[1]` asc then `bbox[0]` asc is the natural reading order.
- **Filter and sort are orthogonal** — "This page" + "Page" sort produces a tight ordered list of just-this-page threads in reading order; "All pages" + "Page" walks the entire book.
- **State resets on remount** — `sort` is local to `ThreadList`, so closing and reopening the empty panel resets to `"date"`. Matches how `filter` resets to "This page" today.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run dev`, open a book with several threads spread across multiple pages, including at least one page with two threads at clearly different y positions, and ideally one page with two threads sharing a selection.
3. Confirm the panel still defaults to `[ This page ] [ Date ]`.
4. Switch to `[ All pages ] [ Page ]`: list should be ordered by ascending page number, and within a page, top-to-bottom by selection rectangle.
5. Switch to `[ This page ] [ Page ]`: only that page's threads, ordered top-to-bottom by selection top, then left.
6. Switch back to `[ Date ]`: original ordering returns.
7. Open the empty conversation panel (no thread selected) on a book that has threads — the same toolbar with both segmented controls should appear.
