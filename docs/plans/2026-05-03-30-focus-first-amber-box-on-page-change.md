# Focus first amber box on the new page after page change

## Context

In the PDF view, an amber box (a pin button overlaid on a selection) can
hold keyboard focus. ArrowUp/ArrowDown walks across pin buttons (with
auto-scroll, even across pages — `components/SelectionOverlay.tsx`
lines 693-703).

ArrowLeft/ArrowRight changes the page (`components/Reader.tsx`
lines 463-474 → `goPrev`/`goNext` lines 342-355) but leaves keyboard
focus on the now-out-of-view pin from the previous page. Because
amber-box `onFocus` opens the thread tooltip
(`components/SelectionOverlay.tsx` lines 674-687) and `onBlur` only
clears it on a non-pin relatedTarget (lines 688-692), the stale tooltip
also lingers next to a box the user can no longer see.

The user wants ArrowLeft/ArrowRight to:

1. Focus the **first** amber box on the new page if one exists.
2. Otherwise, blur the currently focused amber box (so the stale
   tooltip goes away).

This mirrors the existing `ThreadList.tsx` page-change behavior added in
commits f924dfa / 11a521d (documented in
`docs/plans/2026-05-03-29-focus-first-thread-on-page-change.md`).

## Approach

Add a page-change effect to `SelectionOverlay.tsx` that watches
`pageNum` (passed in as a new prop) and refocuses the first pin on the
new page — but only when the currently focused element is itself a pin
button.

Why "currently focused is a pin" as the gate (not a `wasFocusedRef`
like ThreadList):

- It's checked synchronously inside the effect with no race window.
- It naturally suppresses unwanted focus theft when focus is in the
  thread list, the sidebar page input, or nowhere at all.
- It also handles the existing cross-page pin ArrowUp/ArrowDown flow
  (lines 693-703) correctly: that flow `focus()`es a pin on the
  adjacent page, the browser's auto-scroll triggers the
  IntersectionObserver (`components/Reader.tsx` lines 657-687) which
  updates `pageNum`. By the time the new effect runs, the active
  element is already a pin on the new `pageNum`, so the effect detects
  this and bails — the user's intended cross-page target is preserved.

## Critical files

### 1. `components/Reader.tsx`

Add `pageNum={pageNum}` to the `SelectionOverlay` JSX at lines 948-958.
No other changes here — `pageNum` is already updated by every
page-change path that should trigger the new effect (ArrowLeft/Right at
463-474, Home/End at 475-487, Space at 471, sidebar page input at 790,
share/restore at 162/173, and IO scroll observer at 678-679).

### 2. `components/SelectionOverlay.tsx`

a. **Props** (lines 42-52): add `pageNum: number;`.

b. **Destructure** (lines 82-92): add `pageNum,`.

c. **Refs** (near other refs around lines 93-105): add
   `const prevPageNumRef = useRef<number | null>(null);` (init `null`
   so the first effect run is treated as "no prior page" and skips the
   focus jump during hydration).

d. **Effect** (place after the `pinButtonRefs` block at line 627):

   ```ts
   useEffect(() => {
     const prev = prevPageNumRef.current;
     prevPageNumRef.current = pageNum;
     if (prev === null || prev === pageNum) return;
     const active = document.activeElement as HTMLElement | null;
     if (!active?.dataset?.pinSelectionId) return;
     const firstIdx = sortedPins.findIndex((p) => p.page === pageNum);
     if (firstIdx >= 0) {
       // If the active pin is already on the new page (cross-page
       // ArrowUp/Down already moved focus there), don't override.
       for (let i = firstIdx; i < sortedPins.length; i++) {
         if (sortedPins[i].page !== pageNum) break;
         if (pinButtonRefs.current[i] === active) return;
       }
       pinButtonRefs.current[firstIdx]?.focus({ preventScroll: true });
     } else {
       active.blur();
     }
   }, [pageNum, sortedPins]);
   ```

   - `preventScroll: true` avoids fighting the smooth scroll that
     `goPrev`/`goNext` already kicked off via `scrollToPage` (Reader
     line 365 sets `suppressIoUntilRef` for 800ms, so the scroll is
     authoritative).
   - The existing `onFocus` handler (lines 674-687) still fires
     normally — `preventScroll` only suppresses scroll-into-view, not
     the focus event — so the tooltip for the new pin appears.
   - The existing `onBlur` handler (lines 688-692) handles the blur
     case: `relatedTarget` is null on `.blur()`, so it dismisses the
     tooltip.

## Notes on related behaviors (intentional, no extra code)

- **Manual scroll while a pin has focus**: the IO observer updates
  `pageNum`, the new effect fires, and focus follows to the new page's
  first pin. Matches ThreadList's accepted behavior (consistent with
  "when the page changes and a pin was focused, focus follows").
- **Home/End/Space/sidebar page input**: same effect fires for any
  `pageNum` change. Acceptable and consistent.
- **Cross-page pin ArrowUp/ArrowDown**: handled by the
  "active pin is on the new page" early-return in the effect.

## Verification (manual, in browser)

1. `npm run dev`. Open a document with several pages where some pages
   have multiple amber boxes and at least one page has none.
2. Click an amber box on page 2 to focus it (tooltip appears). Press
   ArrowRight → expect PDF scrolls to page 3, focus and tooltip move
   to the first amber box of page 3.
3. Press ArrowLeft → focus and tooltip on first amber box of page 2.
4. ArrowRight to a page with no amber boxes → focused box is blurred,
   tooltip disappears, no errors.
5. Regression — cross-page pin nav: click the **last** amber box on
   page 2, press ArrowDown → focus jumps to the first amber box of
   page 3 (the specific cross-page target — should NOT be clobbered
   by the new effect re-focusing the first pin of page 3, since
   they're the same pin in this case). Then press ArrowUp → focus
   returns to last amber box of page 2 (NOT clobbered to first pin of
   page 2).
6. Regression — focus elsewhere: click into the thread list, then
   press ArrowRight (which still changes the page via the global
   handler) — amber boxes do NOT steal focus from the thread list.
7. Regression — no focus: scroll to a fresh load with no focused
   element, press ArrowLeft/Right — page changes, no amber-box
   tooltip pops.
8. Regression — Home/End: with an amber box focused on page 2, press
   End → focus moves to first amber box of the last page (or blurs
   if that page has none). Acceptable / desirable.
