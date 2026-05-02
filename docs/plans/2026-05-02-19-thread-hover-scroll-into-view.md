# Plan: Scroll hovered amber box into view based on viewport, not page

## Context

`2026-05-02-18-thread-hover-highlights-amber-box.md` introduced a
hover-driven page jump: when a thread row is hovered, the PDF view
scrolls if the box's page is not the focused page. Two cases still
miss the mark:

1. The box's page **is** the focused page, but the box itself is
   below the fold (e.g. the page is taller than the viewport and the
   user is scrolled to the top — the box sits hundreds of pixels
   down). The previous logic does nothing because
   `pages.includes(pageNumRef.current)` is true, leaving the box
   off-screen.
2. The box's page is **not** the focused page, so the previous logic
   scrolls — but it scrolls to page top via `scrollToPage(pages[0])`,
   and on a tall page the box can still be below the fold after the
   scroll lands.

Goal: scroll iff the box rectangle is not actually visible in the
scroll container, and when scrolling, aim at the box, not the page.

## Approach

Compute the hovered selection's topmost span (smallest page, then
smallest y) and convert its bbox into scroll-container coordinates.
If that rectangle sits inside the viewport with a 16 px margin top
and bottom, do nothing. Otherwise `main.scrollTo` at `boxTop - 16`.
This subsumes both miss cases above with a single check.

## Changes

### `components/Reader.tsx`

Replace the `handleThreadHover` body. The outer shape (state set,
debounce-timer reset, 150 ms `setTimeout`) is unchanged; only the
"what to scroll to and when" inside the timer changes.

```ts
const handleThreadHover = useCallback(
  (selectionId: string | null, pages: number[]) => {
    setHoveredSelectionId(selectionId);
    if (hoverScrollTimerRef.current) {
      clearTimeout(hoverScrollTimerRef.current);
      hoverScrollTimerRef.current = null;
    }
    if (!selectionId || pages.length === 0) return;

    // Pick the topmost span (smallest page, then smallest y) so we
    // aim the scroll at the start of the highlighted region.
    const sel = selections.find((s) => s.id === selectionId);
    if (!sel || sel.spans.length === 0) return;
    let target = sel.spans[0];
    for (const sp of sel.spans) {
      if (sp.page < target.page) target = sp;
      else if (sp.page === target.page && sp.bbox[1] < target.bbox[1])
        target = sp;
    }
    const targetPage = target.page;
    const targetBbox = target.bbox;

    hoverScrollTimerRef.current = setTimeout(() => {
      hoverScrollTimerRef.current = null;
      const main = mainRef.current;
      const wrapper = pageWrapperRefs.current.get(targetPage);
      if (!main || !wrapper) return;
      // If real page dims aren't loaded yet, the wrapper is a 600x800
      // placeholder; bbox math would be wrong. Fall back to page top.
      if (!pageDims[targetPage]) {
        scrollToPage(targetPage);
        return;
      }
      const wrapperTop =
        wrapper.getBoundingClientRect().top -
        main.getBoundingClientRect().top +
        main.scrollTop;
      const s = scaleRef.current;
      const boxTop = wrapperTop + targetBbox[1] * s;
      const boxBottom = boxTop + targetBbox[3] * s;
      const viewTop = main.scrollTop;
      const viewBottom = viewTop + main.clientHeight;
      const PAD = 16;
      if (boxTop >= viewTop + PAD && boxBottom <= viewBottom - PAD) return;
      main.scrollTo({
        top: Math.max(0, boxTop - PAD),
        behavior: "smooth",
      });
    }, 150);
  },
  [pageDims, scrollToPage, selections],
);
```

Notes on the implementation:

- `selections`, `pageDims`, and `scrollToPage` are added to the
  callback's dep list so the closure always sees the latest. The
  added churn is negligible — `selections` rarely changes and
  `pageDims` stops changing once the document is fully measured.
- `scaleRef.current` (already maintained next to `pageNumRef`) is
  used so the bbox-to-pixel conversion always uses the live zoom
  level, even if the user zooms while the timer is queued.
- `pageWrapperRefs.current.get(targetPage)` always returns a wrapper
  (every page has a registered ref, even ones outside the render
  window — they're rendered as placeholders). The
  `pageDims[targetPage]` guard is what protects against bbox math
  against a placeholder.
- 16 px padding matches `scrollToPage`'s existing top padding, so
  the visual outcome is consistent with manual page navigation.

## Critical files

- `components/Reader.tsx`

## Verification

1. `npm run dev`, open a book with at least one tall page that
   contains an amber box near the bottom.
2. Scroll the PDF view so that page is current (`pageNum` reflects it)
   but the box is below the fold. Hover the matching thread row.
   - Previously: no scroll, box stays hidden. Now: smooth scroll
     until the box's top sits ~16 px below the viewport top.
3. Hover a thread whose box is already fully inside the viewport.
   - No scroll fires.
4. Hover a thread whose box is on a different page.
   - Scrolls directly to the box (not just to page top), so a tall
     destination page doesn't leave the box still below the fold.
5. Hover a thread whose box is on a different page near the very
   bottom of the document.
   - Scrolls to box; clamped at 0 by `Math.max(0, boxTop - PAD)`,
     so we never produce a negative scroll target.
6. Sweep the cursor across many rows quickly; only the row the
   cursor lands on triggers a scroll, after the 150 ms debounce.
7. `npx tsc --noEmit` passes.
