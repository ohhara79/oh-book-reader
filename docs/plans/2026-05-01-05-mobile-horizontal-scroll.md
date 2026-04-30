# Fix horizontal touch scrolling on mobile

## Context

On mobile, the PDF viewer's left pane scrolls vertically with touch but not horizontally. When the PDF is zoomed in (or naturally wider than the mobile viewport), the user can see the right edge is clipped but cannot pan to it with a finger gesture. Mouse/scrollbar horizontal scrolling works on desktop, so the layout itself is correct — the issue is gesture handling.

## Root cause

`components/SelectionOverlay.tsx:275` sets `touchAction: "pan-y pinch-zoom"` on the overlay that covers the entire PDF page (`absolute inset-0`, line 274). This declaration tells the browser:

- allow vertical pan (browser scrolls)
- allow pinch-zoom
- block horizontal pan (consumed by overlay's pointer handlers)

Because the overlay sits over the whole page, every touch starts on it. The parent `<main>` at `components/Reader.tsx:290` has `overflow-auto` (correctly), but it can never receive horizontal pan gestures from touch — the browser is told not to forward them.

The long-press selection flow (400ms hold then drag, see `LONG_PRESS_MS` at `SelectionOverlay.tsx:39` and the threshold logic at lines 128–144) does not depend on `pan-y` being exclusive; it relies on (a) movement above `TOUCH_CANCEL_MOVE_PX` cancelling the timer so the browser scrolls, and (b) `setPointerCapture` after arming so the JS handler keeps the pointer. Adding `pan-x` simply lets the cancel-and-scroll path also work for horizontal motion.

## Change

Single-line edit in `components/SelectionOverlay.tsx:275`:

```diff
-      style={{ zIndex: 10, touchAction: "pan-y pinch-zoom" }}
+      style={{ zIndex: 10, touchAction: "pan-x pan-y pinch-zoom" }}
```

That is the only code change.

## Files touched

- `components/SelectionOverlay.tsx` (line 275)

## Verification

1. `npm run dev` and open the reader on a mobile-sized viewport (Chrome DevTools device toolbar, e.g. iPhone 12).
2. Open a PDF and zoom in until the page is wider than the viewport.
3. Touch-drag horizontally on the page area → the page should scroll left/right. Touch-drag vertically → still scrolls (regression check).
4. Long-press on the page (~0.4s, hold still), then drag → selection rectangle still appears and a selection is captured (regression check for the existing gesture).
5. Pinch-zoom with two fingers still works (regression check).
6. On desktop, mouse-drag selection and scrollbar scrolling are unaffected (they don't go through `touch-action`).
