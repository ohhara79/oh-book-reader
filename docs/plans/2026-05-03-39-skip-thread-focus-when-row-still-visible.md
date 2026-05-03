# Skip thread-list focus reset when the focused row is still visible

## Context

Under the **All pages** filter, arrow up/down navigation in the thread
list appears broken — focus snaps back to the first item after every
keypress.

Trace:

1. User focuses thread row N. The button's `onFocus` calls
   `onHover(selectionId, pages)` (`components/ThreadList.tsx:376-378`).
2. `handleThreadHover` in `components/Reader.tsx:534-585` smooth-scrolls
   the main pane so the highlighted region is in view. With **All
   pages** the target row may live on a different page than the current
   one.
3. The IntersectionObserver at `components/Reader.tsx:660-695` sees the
   new most-prominent page and calls `setPageNum(bestN)` (line 687).
4. `pageNum` flows down through `ConversationPanel`
   (`components/Reader.tsx:999`,
   `components/ConversationPanel.tsx:1165`) into `ThreadList` as
   `currentPage`.
5. The page-change focus effect at
   `components/ThreadList.tsx:322-340` fires. With filter `"all"` the
   ArrowUp/Down handlers (lines 387, 409) returned early without
   priming `pendingFocusConvIdRef`, so the effect falls through to
   `buttonRefs.current[0]?.focus()` at line 339 — focus snaps to item
   0.

Each subsequent ArrowDown moves to row 1, fires hover → scroll → page
change → effect → back to item 0. Hence the oscillation.

The fix is the user's suggestion: only reposition focus when the
previously focused row is no longer present. With **All pages**,
`visibleRows` is not filtered by `currentPage`, so the focused row is
still mounted and focus should be left alone.

## Approach

In the page-change focus effect, before the fallback
`buttonRefs.current[0]?.focus()`, bail out when focus is already on a
thread row inside the list:

```tsx
if (listRef.current?.contains(document.activeElement)) return;
buttonRefs.current[0]?.focus();
```

`listRef` already exists at `components/ThreadList.tsx:318` and is
attached to the `<ul>` at line 355.

## Critical files

- `components/ThreadList.tsx`
  - Page-change effect (lines 322–340): insert one guard line before
    the existing `buttonRefs.current[0]?.focus()` fallback.

## Non-changes

- Guards on lines 325–327 (only act on real page change, only when the
  list had focus, only when the new page has rows).
- Pending-focus branch on lines 328–337 — keeps cross-page ArrowUp/Down
  landing on the intended thread.
- ArrowUp/ArrowDown handlers on lines 380–427.
- `Reader.tsx` IntersectionObserver, hover-scroll, and
  `onRequestPageChange` wiring — no change needed there.

## Behavior after the change

- **filter `"all"`, focus still in list** → focused button is still
  mounted, `listRef.contains(activeElement)` is true → leave focus
  alone. Bug fixed.
- **filter `"page"`, explicit boundary navigation** →
  `pendingFocusConvIdRef` is set, the existing pending branch focuses
  the target row before reaching the new guard. Unchanged.
- **filter `"page"`, focused row got filtered out** → that `<li>`
  unmounted, `document.activeElement` is `<body>`,
  `listRef.contains(...)` is false → fallback to first item.
  Unchanged. (In practice this path is mostly pre-empted by the
  earlier `wasFocusedRef.current` early-return at line 326, since the
  unmount fires `onBlur`. The new guard is a safety net.)

## Verification (manual, in browser)

1. `npm run dev`, open a book with multiple pages and threads spanning
   several pages.
2. Set the thread-list filter to **All pages** (control at
   `components/ThreadList.tsx:232-238`).
3. Click any thread row to focus it, then press ArrowDown / ArrowUp
   repeatedly. Focus should walk through the list without snapping back
   to the top, even when the main pane scrolls to a different page in
   response to hover.
4. Switch back to **This page**. Focus a row near the bottom and press
   ArrowDown — the existing boundary-pagination behavior (advances to
   the next page and focuses the next thread there) should still work
   via the `pendingFocusConvIdRef` branch.
5. Still under **This page**, focus a row, then change page some other
   way (e.g., scroll the main pane until the IO snaps to a new page,
   or use the page-number input). Focus should land on the first row
   of the now-replaced list — same as before.
6. `npx tsc --noEmit` to confirm no type errors.
