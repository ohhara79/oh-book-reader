# Persist PDF scroll position across reload

## Context

Today on reload, `components/Reader.tsx` restores `page` and `scale` from
`localStorage["ohbr.book.<id>"]` (line 62), then snaps scroll to the **top**
of the stored page via `scrollToPage(pageNum, false)` (lines 388–398). If the
user was scrolled mid-page or near a page boundary, that exact position is
lost. The user wants the actual scroll position restored.

## Approach

Extend the existing stored-state object with a `scrollTop` field, write it as
the user scrolls (debounced), and apply it during the existing restore-after-
dims effect.

### File to modify

- `components/Reader.tsx` — only file touched.

### Changes

1. **Extend `StoredBookState`**: add `scrollTop?: number` AND
   `scrollLeft?: number`. Both axes are required — when zoomed in such that
   the widest page exceeds the viewport, restoring only Y leaves the user
   parked off-content horizontally and the PDF appears blank until they
   scroll sideways.

2. **Capture stored offsets on hydrate** (the effect at lines 158–188):
   Read `stored.scrollTop` into `pendingScrollTopRef` and `stored.scrollLeft`
   into `pendingScrollLeftRef` when each is finite and `>= 0`. Reset both to
   `null` (and clear `restoreScrollDoneRef`) at the top of the effect so a
   bookId switch starts clean. Clear both pending refs when the URL has
   `?page=<n>` (shared link) so deep-links land on the page top.

3. **Apply offsets in the restore effect**:
   - Gate: if either pending offset is set AND `restoreSignal === 0`, return
     early — wait for **all** page dims so total `scrollHeight` /
     `scrollWidth` are final and clamping is correct.
   - Inside the `requestAnimationFrame`, if `pendingScrollTopRef` exists,
     compute `finalTop = clamp(pendingTop, 0, scrollHeight - clientHeight)`,
     **then derive the page that contains `finalTop + clientHeight/2` from
     `pageOffsets` / `pageDims` and `setPageNum(target)` if it differs**.
     This is critical: a saved `scrollTop` that drifts from the saved
     `pageNum` (fast scroll near save time) would otherwise put the viewport
     on a page outside the `[pageNum-RENDER_BUFFER, pageNum+RENDER_BUFFER]`
     mount window, leaving a blank area until the user scrolls (the IO
     observer won't self-correct because no scroll event fires after our
     programmatic set, and its update is dropped while
     `suppressIoUntilRef` is active). Then bump `suppressIoUntilRef` and
     assign `main.scrollTop = finalTop`.
   - If `pendingScrollLeftRef` exists, clamp to
     `[0, scrollWidth - clientWidth]` and assign `main.scrollLeft`.
   - Fall back to `scrollToPage(pageNum, false)` when no `scrollTop` is
     pending.
   - Clear both pending refs and set `restoreScrollDoneRef.current = true`
     once applied.

4. **Consolidate writes to one helper**:
   Replace the inline `localStorage.setItem` at lines 200–206 with a callback
   `persistBookState()` that reads `pageNumRef.current`, `scaleRef.current`,
   and both `mainRef.current?.scrollTop` / `scrollLeft`. Skip writes while
   `restoreScrollDoneRef.current === false` — otherwise the page/scale effect
   fires on hydrate and overwrites the saved offsets with `0` before restore
   runs.

5. **Save on scroll, debounced**:
   New effect attaching a `scroll` listener to `mainRef.current` (passive),
   debounced ~150ms via `setTimeout`, calling `persistBookState()`. Only
   active once `hydrated` is true. Cleanup clears the timer and removes the
   listener. Also call `persistBookState()` on `scrollend` (where supported)
   so the final position is captured promptly without waiting for the
   debounce.

6. **Keep page/scale saves**: the existing effect (lines 200–206) calls
   `persistBookState()` on `pageNum`/`scale` change, gated on
   `restoreScrollDoneRef`.

### Why wait for `restoreSignal` before restoring offsets

`pageOffsets`, `contentSize.height`, and the inner content `width` are
derived from `pageDims`, which fills in progressively (`flush()` every
100 ms, `setRestoreSignal((s) => s + 1)` once all workers finish — line
282). If we write `scrollTop = 12000` before later pages are sized,
`scrollHeight` is too small and the browser clamps to a wrong value. Same
for `scrollLeft` if narrower pages haven't been measured. The existing
per-page restore is fine on partial dims because it uses the specific page
wrapper's bounding rect; exact pixel offsets need full dims.

### Why pre-align `pageNum` from the restored `scrollTop`

The `renderWindow` mounts only `pageNum ± RENDER_BUFFER` (5 pages total).
The IO observer normally corrects `pageNum` after a scroll, but its update
is gated on `suppressIoUntilRef` and only fires from scroll events — after
a programmatic set there is no follow-up scroll event, so a pageNum that
disagrees with `scrollTop` would never correct on its own. Computing the
target page synchronously from `finalTop + clientHeight/2` and calling
`setPageNum` before the assignment makes the renderWindow correct on the
first paint.

### Why include both offsets in the same key

Single key, single JSON object → atomic write. Avoids races between two
effects writing different keys.

## Files / functions to reuse

- `bookStateKey(id)` (`components/Reader.tsx:62`) — storage key.
- `readBookState(id)` (`components/Reader.tsx:82`) — already returns
  `StoredBookState`; widening the type is enough.
- `restoreScrollDoneRef` (`components/Reader.tsx:129`) — already exists for
  the one-shot restore guard.
- `suppressIoUntilRef` (`components/Reader.tsx:128`) — used to silence the
  IntersectionObserver during programmatic scrolls; reuse here.
- `pageNumRef` / `scaleRef` (`components/Reader.tsx:125–126`) — already
  mirror the latest values for non-reactive reads.

No new utility hook is needed; the project's pattern is direct
`localStorage` access (Reader, ThreadList).

## Verification

1. `bun run dev` (or the project's dev script), open a book.
2. Scroll to a non-top position mid-page (e.g., halfway down page 5).
3. Hard reload (Cmd-R). Confirm the view restores to the same scroll
   offset, not the top of page 5.
4. Repeat near a page boundary (last 50 px of a page) — confirm restoration
   lands within a few pixels and the page renders immediately (no blank
   area requiring a scroll nudge to reveal it).
5. Zoom in until the page is wider than the viewport, scroll horizontally
   off-center, reload — confirm the horizontal position is restored
   (without this, the user lands on whitespace / page edge and has to
   scroll sideways to find content).
6. Change zoom, scroll, reload — confirm scroll position restores under the
   restored scale (saved offset is in the same scale, so it should match).
7. Open a deep-link URL like `/books/<id>?page=12` — confirm it goes to
   page 12 top, not the stored offsets (the `?page=` override path).
8. Open DevTools → Application → Local Storage and confirm
   `ohbr.book.<id>` now contains both `scrollTop` and `scrollLeft` fields
   that update ~150 ms after scrolling stops.
9. `npx tsc --noEmit` to confirm no type regressions.
