# Stop spurious pin focus + tooltip during scrolling (mouse-wheel and touch)

## Context

While the user scrolls the PDF (mouse wheel, trackpad, or touch swipe), an amber pin sometimes gains focus and its tooltip pops up — usually right after the page changes. The mouse is nowhere near the pin. Expected: scrolling never moves keyboard focus or surfaces tooltips.

The mechanism is intentional code: `components/SelectionOverlay.tsx:662-680` auto-focuses the first pin of the new page on `pageNum` change whenever `pinNavActiveRef.current === true`. That flag is set in the pin's `onFocus` (line 734) — which fires for non-keyboard reasons too:

- Programmatic focus-restore after a thread closes (`Reader.tsx:1049-1054`).
- A click (or tap) on a pin (focuses the button).

Once any of those have happened, the pin remains `document.activeElement` indefinitely. Wheel and touch scrolling do not move focus, so the flag stays `true`. When scrolling crosses a page boundary, IntersectionObserver updates `pageNum`, the effect fires, and since the focused pin is no longer on the visible page, the early-return at lines 670-674 doesn't match — control falls through to `pinButtonRefs.current[firstIdx]?.focus({ preventScroll: true })` at line 676. That `.focus()` triggers the pin's `onFocus`, which sets `hoverTip` with `source: "focus"` anchored at the pin's bottom-right corner — explaining the "tooltip on top or bottom when the page is changed" observation.

A wheel-event-only fix would miss touch scrolling (which fires pointer/touch events, not wheel) and keyboard scrolling (PageDown, Space). The right fix is to remove the input-modality guesswork and address the root cause: the auto-focus-on-page-change behavior itself.

## Approach

Remove the auto-focus-on-page-change behavior. Keep the related blur-on-empty-page behavior, but generalize it: whenever the most-visible page changes and the currently-focused element is a pin that isn't on the new page, blur it.

This means:

- **Keyboard pin-nav (Tab + ArrowUp/ArrowDown)** still works. ArrowUp/Down directly calls `.focus()` on the next pin in `sortedPins` (lines 763-773), which scrolls into view and updates `pageNum`. The page-change effect then sees the active element IS a pin on the new page and leaves it alone.
- **Mouse-wheel / trackpad / touch scrolling** with a previously-focused pin: when the page changes, the still-focused pin is off-screen relative to the new `pageNum`, so the effect blurs it. The focus tooltip dismisses via the existing `onBlur` handler (lines 749-762). No new pin gains focus, no new tooltip appears.
- **Keyboard scrolling (PageDown / Space)**: same as wheel/touch — focused pin gets blurred when it's no longer on the visible page. Acceptable; user re-Tabs to resume keyboard nav.

This eliminates the `pinNavActiveRef` state-tracking entirely (it only existed to gate this auto-focus). Simpler and modality-agnostic.

### Why not a wheel-only listener

A `wheel` listener would clear pin-nav state on mouse wheel, but:
- Touch swipe scrolling on mobile/tablets fires `touchmove` / `pointermove`, not `wheel` — the same bug recurs there (the user explicitly raised this).
- Keyboard PageDown/Space scrolling fires neither — same bug.
- It's more code and more state for a partial fix.

Removing the auto-focus path closes the bug for all scroll inputs uniformly.

### What we lose

The original comment at lines 655-659 documents an intended scenario: "paging across an empty page and back to a page with pins still re-grabs focus." After this change, paging across an empty page blurs the focused pin (as today), and arriving at a populated page does **not** re-grab focus automatically — the user re-Tabs. This is the necessary trade-off; the auto-focus is what causes the reported bug. Manual re-Tab is a small inconvenience compared to the surprise tooltip popping up off-cursor.

## Files to modify

- `components/SelectionOverlay.tsx` — simplify the effect at lines 662-680, drop `pinNavActiveRef` (lines 655-660, 734, 759).

## Implementation sketch

Replace lines 655-680 with:

```ts
const prevPageNumRef = useRef<number | null>(null);
useEffect(() => {
  const prev = prevPageNumRef.current;
  prevPageNumRef.current = pageNum;
  if (prev === null || prev === pageNum) return;
  // When the visible page changes (any cause: scroll, touch, keyboard
  // page-keys, or our own ArrowUp/Down focus shifts), if the active element
  // is a pin that's no longer on the visible page, blur it. The pin's
  // onBlur handler clears any active focus-source tooltip. We never
  // programmatically focus a different pin here — that caused tooltips to
  // pop up off-cursor during mouse-wheel and touch scrolling.
  const active = document.activeElement as HTMLElement | null;
  if (!active?.dataset?.pinSelectionId) return;
  for (let i = 0; i < sortedPins.length; i++) {
    if (sortedPins[i].page !== pageNum) continue;
    if (pinButtonRefs.current[i] === active) return; // active pin is on this page
  }
  active.blur();
}, [pageNum, sortedPins]);
```

Then in the pin button JSX (lines 703-790):

- Remove `pinNavActiveRef.current = true;` from `onFocus` (line 734).
- In `onBlur` (lines 749-762), drop the `if (next) pinNavActiveRef.current = false;` line (line 759). Keep the rest — relatedTarget-based hover/tooltip-clear logic is still relevant.

Net change: one effect simplified, one ref removed, two lines deleted from focus handlers.

## Verification

Reproduce the original bug, then verify the fix on three scroll modalities:

1. `npm run dev`, open a book with pins on multiple pages.
2. Click an amber pin → thread opens → close the thread (focus is now on the pin).
3. **Mouse wheel:** scroll past several pages.
   - Before: pin briefly highlights and tooltip pops up at each populated page transition.
   - After: no pin gains focus, no tooltip appears. The previously-focused pin gets quietly blurred when scrolled off-page.
4. **Touch / trackpad swipe:** same scenario via two-finger trackpad scroll or (on a touch device) finger swipe. Same expected result.
5. **Keyboard scroll:** focus a pin, then press PageDown / Space repeatedly. Same expected result.

Regression checks:

6. Tab to a pin, press ArrowDown / ArrowUp across page boundaries — focus moves pin-by-pin, scrolls into view, focus tooltip follows the focused pin.
7. Click pin → thread opens → close → focus restored to that exact pin (`pinFocusSelectionIdRef` flow in `Reader.tsx:1044-1056` is unchanged).
8. Hover a pin without focusing — hover tooltip still appears next to the cursor and dismisses on scroll (existing `hover`-source dismissal at lines 218-223 is unchanged).
