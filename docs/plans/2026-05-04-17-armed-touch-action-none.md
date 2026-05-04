# Drop `pan-y` while a touch selection is armed

## Context

After the fixes in `2026-05-04-15` (revert `878d365`) and `2026-05-04-16` (horizontal flick inertia), long-press region selection works on mobile — but only if the user's first post-arm motion is horizontal. If they drag up or down at the start of the selection, no rectangle appears.

The cause is the overlay's `touch-action: pan-y pinch-zoom`. After the 400 ms timer fires we call `setPointerCapture`, but `pan-y` still allows the browser to commit to a native vertical scroll on the very first vertical pointermove. That scroll commit fires `pointercancel`, which calls `resetGesture()` and clears the in-flight selection. Horizontal motion is JS-only by virtue of `pan-y`, so it keeps working.

We deliberately keep `pan-y` in the unarmed state so taps and short scrolls feel native (vertical scroll with browser inertia, no JS overhead). The conflict only matters once the user has committed to a selection.

Outcome we want: long-press → drag in *any* direction draws the selection rectangle. Unarmed touch behavior (vertical native scroll, JS horizontal flick) is unchanged.

## Approach: toggle `touch-action` to `"none"` while armed

In `components/SelectionOverlay.tsx`:

1. Add an `armed` boolean state (separate from `armedRef`, which is the synchronous-access ref used in event handlers — state is needed to drive the JSX style).
2. `setArmed(true)` at the end of `armSelection`; `setArmed(false)` at the end of `resetGesture`.
3. Compute the inline style as `touchAction: armed ? "none" : "pan-y pinch-zoom"`.

Why this works mechanically:

- During the 400 ms hold, the user is by definition holding still (otherwise the pre-arm threshold trips and we never get here). No native scroll has begun, so the browser hasn't claimed the pointer.
- `setPointerCapture` runs inside the long-press timer callback, then `armSelection` runs. By the next pointermove, the overlay's `touch-action` is already `"none"`.
- With the captured pointer pointing at an element whose `touch-action` is `"none"`, modern Chrome and Safari route subsequent pointermoves to JS — vertical motion no longer becomes a native scroll.

There is a spec ambiguity: CSS Touch Action says `touch-action` is evaluated at touchstart, while Pointer Events 3 says captured pointers honor the capturing element's `touch-action`. In practice, real browsers honor the latter for mid-gesture changes that occur before any scroll commit. If a specific device misbehaves, the fallback is to set `touch-action: none` permanently and hand-roll vertical pan + inertia, mirroring the horizontal path. Out of scope here.

## Critical files

- `components/SelectionOverlay.tsx` — only file changed. New `armed` state, two `setArmed` calls (in `armSelection` and `resetGesture`), one expression change in the JSX `style`.

## Trade-offs

- **Two sources of truth for "armed".** `armedRef` (sync access in event handlers) and `armed` state (drives JSX). They are kept in lockstep by the two functions that gate arming. Acceptable; the alternative (deriving `armedRef` from state) doesn't work because pointer event handlers need synchronous access.
- **One extra render per gesture.** State flip on arm + on reset. Negligible.

## Verification

1. `npm run dev`, open a PDF on a mobile-sized viewport (Chrome DevTools device toolbar) and on a real phone if available.
2. **The regression being fixed:** long-press (~0.5 s hold), then drag *upward* or *downward* → blue selection rectangle appears, releasing captures the selection.
3. Same as (2) but dragging left/right → rectangle appears (regression check, was already working).
4. Same as (2) but dragging diagonally → rectangle appears.
5. **Unarmed taps/scrolls (regression check):** without holding, drag vertically → page scrolls vertically with native inertia. Drag horizontally → JS pan with simulated inertia. Both unchanged.
6. **Pinch-zoom** still works.
7. **Pointercancel cleanup:** if a multi-touch interrupts an armed selection, the overlay returns to `pan-y pinch-zoom` (touch-action restored via `resetGesture`).
8. **Desktop (regression check):** mouse drag selection unchanged — `touch-action` doesn't apply to mouse pointers.
