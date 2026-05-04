# Block native scroll via non-passive touchmove while armed

## Context

Commit `b4111e5` flipped the overlay's `touch-action` to `"none"` once a selection was armed, on the assumption that mid-gesture `touch-action` changes plus an existing `setPointerCapture` would prevent the browser from committing to a vertical pan. On the user's device that didn't hold: long-press + vertical drag still scrolled the PDF view instead of drawing the selection rectangle.

The Pointer Events 3 spec says captured pointers should follow the capturing element's `touch-action`, but Chrome's actual behavior is that once its scroll machinery has decided the gesture is a pan (which can happen on the very first qualifying touchmove), capture is implicitly released and `pointercancel` fires. A `touch-action` change after that point arrives too late.

Outcome we want: long-press → drag in any direction draws the selection rectangle on every browser/device, including Chrome on Android.

## Approach: non-passive `touchmove` listener that preventDefaults while armed

In `components/SelectionOverlay.tsx`, add a `useEffect` that attaches a native `touchmove` listener to `overlayRef.current` with `{ passive: false }`. The handler calls `e.preventDefault()` whenever `armedRef.current` is true.

Why this works mechanically:

- React's synthetic `onPointerMove` can't preventDefault scrolling — React installs touch listeners as passive by default, and `preventDefault` on a passive listener is silently ignored.
- A non-passive listener runs *before* Chrome's scroll commit logic. `preventDefault` on the very first vertical touchmove after long-press cancels the browser's scroll decision, so `pointercancel` is never fired and the captured pointer keeps flowing into our React handlers as ordinary pointermoves.
- We gate on `armedRef.current` so unarmed touch behavior is untouched: native vertical pan with browser inertia, JS-driven horizontal pan with simulated inertia, all unchanged.

The `armed`-state-driven `touch-action` toggle from `b4111e5` is left in place. It's redundant given this fix, but harmless: it covers any browser that *does* honor mid-gesture `touch-action` changes (defense in depth), and the JSX expression is trivially small.

## Critical files

- `components/SelectionOverlay.tsx` — only file changed. New `useEffect` mounting and unmounting the non-passive listener on `overlayRef.current`.

## Trade-offs

- **The listener is attached once on mount.** It reads `armedRef.current` at event time, so no re-attachment is needed when the armed state changes. Simpler than re-binding on every state flip.
- **Touch events bubble through to the overlay even when the touch target is a child** (e.g. a pin button), so the listener catches every move within the overlay. Pin clicks themselves don't move enough to register, so this doesn't change tap-to-open behavior.

## Verification

1. `npm run dev` and open a PDF on a real Android device (the regression doesn't reproduce on every desktop browser; testing on the actual device is important).
2. **The regression being fixed:** long-press (~0.5 s hold), then drag *upward* → blue selection rectangle appears, releasing captures the selection. Repeat dragging *downward*, *left*, *right*, *diagonally* — all should produce a rectangle.
3. **Unarmed behavior (regression check):** without holding, drag vertically → page scrolls vertically with native inertia. Drag horizontally → JS pan with simulated inertia. Both unchanged.
4. **Pinch-zoom** still works.
5. **Tap on a pin** still opens its conversation.
6. **Pointercancel cleanup:** if a multi-touch interrupts an armed selection, `resetGesture` runs and `armedRef.current` flips off — subsequent touchmoves stop calling `preventDefault`, so native scroll resumes.
7. **Desktop (regression check):** mouse drag selection unchanged — touch listener never fires for mouse.
