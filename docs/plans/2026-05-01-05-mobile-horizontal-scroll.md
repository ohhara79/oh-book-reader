# Fix horizontal touch scrolling on mobile

## Context

On mobile, the PDF viewer's left pane scrolls vertically with touch but not horizontally. When the PDF is zoomed in (or naturally wider than the mobile viewport), the user can see the right edge is clipped but cannot pan to it with a finger gesture. Mouse/scrollbar horizontal scrolling works on desktop, so the layout itself is correct — the issue is gesture handling.

## Why the obvious fix fails

The natural one-liner — broaden `SelectionOverlay`'s `touchAction` from `pan-y pinch-zoom` to `pan-x pan-y pinch-zoom` — was tried and reverted. It does enable horizontal browser scrolling, but it breaks the long-press selection gesture: with `pan-x` allowed, any small horizontal jitter during the 400ms hold lets the browser commit to a scroll and fire `pointercancel`, which clears the long-press timer (via `resetGesture`). Even when the timer fires, Chrome can keep treating the in-flight gesture as a scroll despite `setPointerCapture`, so the post-arm drag never produces a selection rectangle. The selection flow specifically depends on `touchAction: pan-y pinch-zoom` to keep horizontal motion in JS-only territory.

## Approach (proposed, not yet implemented)

Keep `touchAction: pan-y pinch-zoom` on the overlay so selection stays reliable, and let the overlay's existing pointer handlers drive horizontal scrolling manually:

1. On `pointerdown` (touch path), record the starting position and find the nearest horizontally-scrollable ancestor of the overlay (walk parents, look for `overflow-x: auto|scroll` with `scrollWidth > clientWidth`). With the current layout that resolves to `<main>` in `components/Reader.tsx:290`.
2. In `onPointerMove`'s pre-arm branch, when the existing `TOUCH_CANCEL_MOVE_PX` threshold trips and the motion is horizontal-dominant (`|dx| > |dy|`), enter a `horizontalPan` mode (a ref) and stop returning early.
3. While in `horizontalPan`, decrement the scroller's `scrollLeft` by the per-event horizontal delta. Vertical-dominant moves stay with the browser (it pans-y natively and fires `pointercancel`, which `resetGesture` already handles cleanly).
4. Reset the new refs in `resetGesture` alongside the existing ones.

This leaves the long-press / armed-drag flow exactly as it is today — it never enters `horizontalPan` because the timer fires before any threshold-crossing motion. There is no momentum/inertia, but the use case (peeking at the clipped edge of a zoomed PDF) does not need it.

## Files to modify

- `components/SelectionOverlay.tsx` — add refs (`scrollerRef`, `lastPanPosRef`, `horizontalPanRef`), a `findHorizontalScroller` helper, the manual-pan branch in `onPointerMove`, and the cleanup in `resetGesture`. No layout/CSS changes elsewhere.

## Verification

1. `npm run dev` on a mobile-sized viewport (Chrome DevTools device toolbar, e.g. iPhone 12).
2. Open a PDF, zoom until the page is wider than the viewport.
3. Touch-drag horizontally → page scrolls left/right (new behavior).
4. Touch-drag vertically → page scrolls up/down (regression check, still browser-driven).
5. Long-press (~0.4s, hold still), then drag → selection rectangle appears and capture fires (regression check).
6. Pinch-zoom with two fingers still works (regression check).
7. Desktop mouse drag-to-select and scrollbar scrolling are unaffected.
