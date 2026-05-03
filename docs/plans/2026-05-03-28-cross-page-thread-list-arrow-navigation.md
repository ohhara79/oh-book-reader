# Cross-page ArrowUp/ArrowDown in the thread list

## Context

In `components/ThreadList.tsx`, ArrowUp/ArrowDown move focus among the
currently-visible thread buttons but clamp at the boundaries
(`Math.min(idx + 1, visibleRows.length - 1)` / `Math.max(idx - 1, 0)`,
lines 354–363). When the filter is `"page"`, `visibleRows` is the slice
of threads whose `pages` include `currentPage` (lines 153–156), so the
boundary effectively hides any thread that lives on a different book
page.

The user wants ArrowDown on the bottom item to land on the next thread
that lives on another page (and, symmetrically, ArrowUp on the top item
to land on the previous such thread). The traversal order should follow
`sortedRows` — i.e., respect the active sort (Page or Date) — so e.g. in
Date sort the next item may live on an earlier book page.

The page-change must scroll the PDF too, so the rest of the reader
stays in sync. The existing focus-restoration effect in
`ThreadList.tsx` (lines 297–312) — added in commit f924dfa — already
handles "after `currentPage` changes, focus the previously-focused
conv at its new index" using `focusedConvIdRef`. We reuse that exact
mechanism by priming a "pending focus" id just before requesting the
page change.

## Approach

1. **Expose `sortedRows` from `useThreadListRows`.** ThreadList needs
   the full sorted list (not just `visibleRows`) to find the
   next/previous thread that lives off the current page.

2. **Add an `onRequestPageChange` prop to `ThreadList`.** Called with
   a target book page; the parent is responsible for updating
   `pageNum` and scrolling the PDF.

3. **Wire the callback through `ConversationPanel` to `Reader`.**
   Reader already has `setPageNum` and `scrollToPage`; the callback
   does both (mirroring `goNext`/`goPrev` at
   `components/Reader.tsx:342–355`).

4. **Extend the ArrowDown/ArrowUp handler in `ThreadList`** to:
   - Only attempt cross-page jumps when `filter === "page"` (in
     `"all"` mode every thread is already visible, so the existing
     clamp is correct).
   - On ArrowDown at the bottom row: walk forward through
     `sortedRows` starting just after the bottom row's index, find
     the first row where `!r.pages.includes(currentPage)`, choose its
     target page as
     `min(target.pages.filter(p => p > currentPage)) ?? target.pages[0]`,
     prime the pending-focus ref with `target.conv.id`, and call
     `onRequestPageChange(targetPage)`.
   - On ArrowUp at the top row: walk backward, choose target page as
     `max(target.pages.filter(p => p < currentPage)) ?? last(target.pages)`,
     prime pending-focus, and call `onRequestPageChange`.
   - If no such row exists, do nothing (stay at the boundary).

5. **Reuse the existing focus-restoration effect.** Today it reads
   `focusedConvIdRef.current` to re-find the previously-focused
   thread after `currentPage` changes (ThreadList.tsx:297–312). Add a
   sibling `pendingFocusConvIdRef` that, when set, takes precedence
   and is cleared after use. This avoids racing with the buttons'
   `onFocus` handler (which writes `focusedConvIdRef`) and keeps the
   new behavior localized.

## Critical files

- `components/ThreadList.tsx`
  - `useThreadListRows`: also return `sortedRows` (already computed
    at line 128) so callers can pass it down.
  - `Props`: add `sortedRows: Row[]` and
    `onRequestPageChange?: (page: number) => void`.
  - Component body: add `pendingFocusConvIdRef`; extend the focus
    restoration effect (lines 297–312) to consume it first.
  - `onKeyDown` on each button (lines 354–363): add the
    boundary-jump logic described above. Keep `e.preventDefault()`.

- `components/ConversationPanel.tsx`
  - `Props`: add `onRequestPageChange?: (page: number) => void`.
  - Destructure and forward it.
  - At the `<ThreadList ...>` site (around lines 1157–1168), pass
    `sortedRows={threadListState.sortedRows}` and
    `onRequestPageChange={onRequestPageChange}`.

- `components/Reader.tsx`
  - At the `<ConversationPanel ...>` site (around lines 965–990),
    pass
    `onRequestPageChange={(n) => { setPageNum(n); scrollToPage(n); }}`.
    `scrollToPage` is defined at line 357; this matches the
    `goNext`/`goPrev` pattern at lines 342–355.

## Reuse / non-changes

- No new sorting, filtering, or page-derivation helpers. Use
  `r.pages.includes(currentPage)` (same predicate as the existing
  filter at line 155).
- No change to focus tracking on individual buttons; the existing
  `focusedConvIdRef`/`focusedIdxRef` writes in `onFocus` are
  unchanged.
- No change to `"all"` filter behavior or to the empty-state branch
  (lines 314–324).

## Verification (manual, in browser)

1. Open a book with threads on multiple pages.
2. In the thread list with filter "This page" and sort "Page":
   - Focus the last thread on the current page, press ArrowDown —
     the reader should scroll to the next page that has a thread,
     and that thread should receive focus.
   - Focus the first thread on the current page, press ArrowUp — the
     reader should scroll to the previous page that has a thread,
     and that thread's last item should be focused.
   - Hold ArrowDown to walk through every thread in the book; each
     keystroke should advance one thread, crossing page boundaries
     transparently.
3. Switch sort to "Date" and confirm that boundary presses jump to
   the next/previous thread in date order (which may scroll to an
   earlier or later page).
4. Switch filter to "All pages" and confirm boundary presses do
   nothing (the clamp is preserved, no page change is triggered).
5. With only one page of threads in "This page" mode, confirm
   ArrowDown/ArrowUp at the boundary do nothing (no spurious page
   change).
6. Regression: the f924dfa behavior (changing pages via PDF keyboard
   shortcuts retains thread-list focus) must still work — verified
   by focusing a thread, then using Left/Right/PageUp/PageDown/Space
   in the PDF area.
