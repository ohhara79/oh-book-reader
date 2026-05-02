# Pin thread list controls to the conversation panel header

## Context

In conversation list view (no thread open), `ConversationPanel` renders the `ThreadList` inside a scrollable area. `ThreadList` owns its own controls row at the top — the **This page | All pages** filter, the **Date | Page** sort, and the **N threads** count. Because that row scrolls with the list, it disappears as soon as the user has enough threads to scroll. The user wants those controls to sit on the same line as the "Ask AI" header title so they remain visible at all times.

The "Ask AI" title sits in a flex header bar (`components/ConversationPanel.tsx:739`) that only shows action buttons (download / share / delete / close) when a thread is active. When no thread is active, the right side of that bar is empty — the natural place for the controls.

## Approach

Lift the filter/sort state and the row computation out of `ThreadList` into a hook, then render the controls in the header bar (same line as "Ask AI") when in list view. Keep `ThreadList` as a pure renderer of the row list itself.

## Changes

### `components/ThreadList.tsx`

1. Extract a hook `useThreadListRows({ selections, convsBySelection, currentPage })` that owns:
   - `filter` / `sort` state, the `hydrated` flag, both `useEffect`s for localStorage (`ohbr.threadList`).
   - The three `useMemo`s: `allRows`, `sortedRows`, `visibleRows`.
   - Returns `{ filter, setFilter, sort, setSort, visibleRows }`.
2. Export a `ThreadListControls` component taking `{ filter, setFilter, sort, setSort, count }` that renders the two `FilterButton` groups and the `N thread(s)` count span. Reuse the existing private `FilterButton`.
3. Refactor `ThreadList`'s props to `{ visibleRows, filter, currentPage, onOpen, onHover }` — caller now owns state. Remove the controls block from its JSX. Keep the empty-state message ("No threads on page N." vs. "No threads yet.") since it still depends on `filter` and `currentPage`.

### `components/ConversationPanel.tsx`

1. Near `totalThreadCount`, call `const threadListState = useThreadListRows({ selections, convsBySelection, currentPage: pageNum })`. Compute `showThreadListControls = !active && totalThreadCount > 0`.
2. Header bar: when `showThreadListControls`, render `<ThreadListControls ... count={threadListState.visibleRows.length} />` in a wrapper with `ml-auto`. The existing `active &&` action-button cluster is unchanged (also given `ml-auto` since the outer flex no longer uses `justify-between`).
3. Header wrapper: change `flex items-center justify-between gap-2` to `flex flex-wrap items-center gap-x-2 gap-y-1.5` so the controls wrap below the title on narrow widths. Title gets `min-w-0 shrink-0` when controls are showing (so "Ask AI" stays compact), and falls back to `min-w-0 flex-1` when a thread is active (long titles still wrap normally).
4. List view body: pass `visibleRows={threadListState.visibleRows}`, `filter={threadListState.filter}`, plus existing `currentPage`, `onOpen`, `onHover` to `<ThreadList>`.

No other files change. `ThreadHeadingRow`, the localStorage key, and the `pageNum` prop wiring all work as-is.

## Critical files

- `/home/ohhara/work/oh-book-reader/components/ThreadList.tsx`
- `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`

## Notes / risks

- **Page-change reactivity**: `visibleRows` depends on `currentPage`. After the move, `pageNum` flows into the hook in `ConversationPanel`. The count in the header re-renders on the same path — no extra wiring needed.
- **Hydration flicker**: the existing `hydrated` flag means the first paint uses defaults (`filter: "page", sort: "date"`) before localStorage rehydrates. Already true today; just more visible now. Acceptable.
- **Narrow widths**: two toggle groups + count + "Ask AI" can exceed mobile width. `flex-wrap` on the header handles this — verify the wrapped row doesn't push the scroller down awkwardly.
- **Print**: header is `print:hidden`, no regression.

## Verification

1. `npx tsc --noEmit` clean; `npx next build` succeeds.
2. `npm run dev` and open a document with many threads spread across pages.
3. With no thread open, scroll the thread list — confirm the filter toggles, sort toggles, and count remain visible at the top.
4. Toggle **This page | All pages** and **Date | Page**; confirm the list reorders/filters and the count updates live.
5. Navigate pages in the document; confirm the count and visible list update without a thread being open.
6. Open a thread; confirm the header switches to title + download/share/delete/close (controls hidden), as today.
7. Reload the page; confirm filter/sort selection persists (localStorage key `ohbr.threadList`).
8. Empty state: a fresh doc with zero threads should show only "Ask AI" in the header (no controls), matching today.
9. Narrow the window; confirm the header wraps cleanly and stays usable.
