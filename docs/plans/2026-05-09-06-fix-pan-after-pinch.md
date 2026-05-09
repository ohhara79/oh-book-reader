# Fix: PDF pan broken after pinch-zoom

## Context

After pinch-zooming the PDF on touch, single-finger pan stops working. Repro: pinch to zoom, lift both fingers, try to drag the page with one finger — nothing happens.

Root cause is in `components/SelectionOverlay.tsx`. The recently-added `activeTouchPointersRef` (a `Set<number>` tracking active touch pointer ids) is meant to detect when a 2nd finger lands so the overlay can cancel its single-finger gesture and let the pinch hook on `<main>` take over. The set is grown in `onPointerDown` (line 393) and cleaned up in `onPointerUp` / `onPointerCancel` (lines 505, 698).

But the pinch hook on `<main>` calls `el.setPointerCapture(pointerId)` for **both** pointers when the 2nd finger arrives (`lib/usePinchZoom.ts:63`). DOM pointer-capture semantics: once captured, all further events for that pointer go to the captured element only. Children (the overlay) stop receiving pointer events for the captured pointers. So the overlay's `onPointerUp` and `onPointerCancel` never fire for those two pointers, and the cleanup `activeTouchPointersRef.current.delete(e.pointerId)` is skipped.

After both fingers lift, the set still contains both stale ids (size = 2). The next single-finger touch lands, `onPointerDown` adds to the set (size = 3), trips the `if (… size > 1)` guard at line 397, calls `resetGesture()` and returns — single-finger pan and long-press selection never engage.

The fix replaces the leak-prone set with a stateless check: `e.isPrimary`. The 2nd touch in a multi-touch sequence is always non-primary, so we can detect "second finger arriving" without any tracking state, and the leak path is gone.

## Plan

### `components/SelectionOverlay.tsx`

1. **Delete the `activeTouchPointersRef` ref** at line 389 — no longer needed.
2. **Rewrite the touch-detection block at the top of `onPointerDown` (lines 391–402)**. The existing `if (!e.isPrimary) return;` guard at line 403 already covers the no-op case for non-primary mouse buttons; we just need to add the touch-specific cancel-and-return for non-primary touches before that:
   ```tsx
   function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
     if (e.pointerType === "touch" && !e.isPrimary) {
       // Second-finger touch = pinch beginning. Cancel any in-progress
       // single-finger long-press / drag / pan so the pinch hook on
       // <main> can take over cleanly.
       resetGesture();
       setDrag(null);
       return;
     }
     if (!e.isPrimary) return;
     if (e.button !== 0) return;
     // … rest unchanged
   }
   ```
3. **Remove the cleanup lines** in `onPointerUp` (lines 504–506) and `onPointerCancel` (lines 697–699) — there's no ref to clean up anymore.

That's it. No other files touched.

## Why `isPrimary` works

`PointerEvent.isPrimary` is `true` only for the first pointer in a multi-touch session and stays `false` for later concurrent fingers. So when a 2nd finger arrives during a single-finger pan or pre-arm, its `pointerdown` is non-primary — exactly the trigger we want for "cancel and let pinch take over." When the user later lifts everything and starts a fresh single-finger pan, the new pointer is primary again. No state to leak.

## Critical files

- `components/SelectionOverlay.tsx` — three small edits in `onPointerDown` (around line 391), `onPointerUp` (around line 503), and `onPointerCancel` (around line 696); ref declaration at line 389 deleted.

## Verification

- `npx tsc --noEmit` — type check passes.
- Manual on a touch device:
  1. Open the PDF view.
  2. Pinch-zoom to scale the page (verify zoom still works).
  3. Lift both fingers.
  4. Touch with one finger and drag — page should pan smoothly. **This is the regression we're fixing.**
  5. Long-press with one finger — selection rectangle still arms after the long-press delay.
  6. Pinch again, then immediately (without lifting one of the fingers) try to add a 3rd finger — gesture should remain stable; nothing should arm a selection.
  7. Drag a single-finger long-press into a multi-page selection — the existing scroll-while-armed behavior still works.
- Repeat the cycle multiple times in one session to confirm no state accumulation.
