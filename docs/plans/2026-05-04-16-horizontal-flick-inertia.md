# JS-driven horizontal flick inertia

## Context

After reverting `878d365` (see `docs/plans/2026-05-04-15-restore-mobile-region-select.md`), long-press region selection works again on mobile, but horizontal flick lost its momentum: the JS-driven pan from `7447cd7` maps finger movement 1:1 to `scrollLeft` and stops the instant the finger lifts. A quick swipe scrolls only by the pixels the finger actually traveled, which feels broken next to native scrolling.

We can't get this back via `touch-action` without breaking long-press again — that conflict is documented in commits `4b776e3` and `2026-05-04-15`. The remaining option is to simulate inertia in JS on top of the existing pan.

Outcome we want: a horizontal flick coasts after release, decelerating naturally, while everything else (long-press select, vertical pan, pinch-zoom, tap-to-open-pin) is unchanged.

## Approach: velocity sample + exponential decay rAF

In `components/SelectionOverlay.tsx`, extend the existing horizontal-pan path with two additions:

1. **Track velocity during the pan.** Keep a small ring of `{x, t}` samples (last ~80 ms) pushed on each `pointermove` while `horizontalPanRef.current` is true. Older samples drop off so the captured velocity reflects the *final* motion of the flick, not the average over the whole drag.

2. **Run an rAF decay loop on `pointerup`.** Compute `v0 = (lastSample.x - firstSample.x) / dt` (px/ms). If `|v0|` is below a small threshold the user wasn't flicking — skip. Otherwise schedule `requestAnimationFrame` ticks that:
   - apply `scroller.scrollLeft -= v * dt`
   - decay `v *= Math.exp(-dt / TAU)` with `TAU = 325 ms` (asymptotic distance ≈ `v0 * TAU`, ≈ 975 px for a fast 3 px/ms flick, ≈ 160 px for a 0.5 px/ms one)
   - stop when `|v|` drops below `MIN_V = 0.01 px/ms`, or when `scrollLeft` is unchanged for two frames (boundary clamp — no point burning frames against an edge)

3. **Cancel inertia on a new touch.** `cancelInertia()` runs at the top of `onPointerDown`, so tap-to-stop works the way users expect.

4. **Cleanup.** Cancel any pending rAF in the existing unmount effect.

The inertia path is gated on `horizontalPanRef.current`, which only flips true in the pre-arm horizontal-dominant branch. Long-press, vertical scroll, and pinch-zoom are all on different code paths and stay untouched.

## Critical files

- `components/SelectionOverlay.tsx` — only file changed. New refs (`panSamplesRef`, `inertiaRafRef`), helpers (`cancelInertia`, `startHorizontalInertia`), sample-tracking inside the existing pan branch, inertia trigger in `onPointerUp` before `resetGesture`, cleanup additions.

## Trade-offs

- **Feel is close to native, not identical.** iOS rubber-banding on overscroll isn't reproduced; we just stop at the boundary. Acceptable for a peek-the-clipped-edge use case.
- **Velocity is sampled from `pointermove` rate.** On low-fps devices the flick will register slightly slower than perceived, but the time-based decay corrects for this since `dt` uses real timestamps.
- **No coordination with vertical scroll.** A diagonal flick won't apply inertia to both axes — the JS pan only handles the horizontal-dominant case, and vertical is the browser's native pan-y (which already has inertia). That's the same scope as `7447cd7`.

## Verification

1. `npm run dev`, open a PDF wider than the viewport on a mobile-sized viewport (Chrome DevTools device toolbar) and on a real phone if available.
2. **Flick momentum (the new behavior):** quick horizontal swipe and release → page coasts after release, decelerating smoothly.
3. **Tap-to-stop:** during a coast, tap the page → inertia halts immediately, no spurious selection.
4. **Slow drag:** drag horizontally at low velocity and release → page stops near-immediately (no unwanted coast).
5. **Boundary:** flick toward the left/right edge of the scrollable area → coast stops cleanly at the edge, no jitter or runaway frames.
6. **Long-press select (regression check):** press-and-hold ~0.5 s, drag → selection rectangle still appears and captures.
7. **Vertical scroll (regression check):** drag up/down → native pan-y with native inertia, unaffected.
8. **Pinch-zoom (regression check):** still works.
9. **Desktop (regression check):** unaffected — `pointerType !== "touch"` skips the entire branch.
