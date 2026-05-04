# Enable diagonal pan on touch

## Context

After `2026-05-04-15..18` landed, single-axis touch panning worked: horizontal-dominant motion was driven by JS with simulated inertia, vertical-dominant motion fell through to the browser's native `pan-y`. The user noticed that diagonal swipes only scrolled along whichever axis happened to be dominant at threshold-trip time — the cross-axis component was discarded.

The split is a direct consequence of the previous architecture. `touch-action: pan-y pinch-zoom` let the browser claim only vertical pan, so JS had to handle horizontal alone, and the pre-arm branch picked one axis or the other. Each path moved a single `scrollLeft`/`scrollTop` only.

User decision: enable diagonal pan, accepting that vertical scroll loses native iOS rubber-banding. Horizontal had already been replaced with a JS approximation; this extends the same approximation to vertical so both axes coast consistently.

Outcome: a diagonal swipe scrolls both axes simultaneously with combined inertia; pure-axis swipes still work; long-press selection, pinch-zoom, and pin-tap behavior are unchanged.

## Approach: JS handles all pan; browser keeps only pinch-zoom

In `components/SelectionOverlay.tsx`:

1. **`touch-action`:** unarmed value flipped from `"pan-y pinch-zoom"` to `"pinch-zoom"`. Armed value stays `"none"`. With pan blocked in both axes, the browser never claims the gesture and JS owns it from the first qualifying touchmove.

2. **Refs generalized to two axes:**
   - `horizontalPanRef` → `panActiveRef`
   - `horizontalScrollerRef` → `panScrollerRef`
   - `lastPanXRef: number | null` → `lastPanRef: { x: number; y: number } | null`
   - `panSamplesRef` extended to `{ x: number; y: number; t: number }`

3. **`findHorizontalScroller` → `findScroller`:** returns the nearest ancestor scrollable in *either* axis. Resolves to `<main>` in `components/Reader.tsx` (which has `overflow-auto` for both axes).

4. **Pre-arm branch in `onPointerMove`:** the `|dx| > |dy|` split is gone. Once threshold trips, `panActiveRef` flips on (so long as a scroller exists) and every subsequent pointermove decrements both `scrollLeft -= ddx` and `scrollTop -= ddy`. Samples are pushed as `{x, y, t}` and pruned by the same 80 ms window.

5. **`startHorizontalInertia` → `startInertia(scroller, vx, vy)`:** the rAF loop applies both `scrollLeft -= vx*dt` and `scrollTop -= vy*dt`, decays both velocities with `TAU = 325`, and stops when `max(|vx|, |vy|) < MIN_V` or when *both* `scrollLeft` and `scrollTop` are unchanged for two consecutive frames. One-axis-stuck doesn't end the loop — the still-moving axis keeps coasting until it too clamps or decays.

6. **`onPointerUp`:** computes `vx = (last.x - first.x) / dt` and `vy = (last.y - first.y) / dt`, calls `startInertia(panScrollerRef.current, vx, vy)` before `resetGesture`.

7. **`resetGesture` and `onPointerDown`:** ref names updated to match.

The non-passive `touchmove` preventDefault from `2026-05-04-18` and the `armed`-state `touch-action` toggle from `2026-05-04-17` continue to govern post-arm behavior; they're not touched.

## Critical files

- `components/SelectionOverlay.tsx` — only file changed.

## Trade-offs accepted

- **No native vertical inertia.** The JS approximation is consistent across axes but doesn't match iOS's elastic boundary feel. Horizontal already lost native; vertical now matches.
- **Single-touch pan vs. pinch is unambiguous** — pinch is two-finger and stays with the browser via `touch-action: pinch-zoom`. Single-finger pan stays in JS.

## Verification

1. `npm run dev`, open a PDF wider and taller than the viewport on a real touch device (DevTools device toolbar is fine for a first pass; diagonal feel matters most on a phone).
2. **Diagonal pan (the new behavior):** swipe at ~45° → scrolls along both axes. Repeat for all four diagonals. Flick → coast along the diagonal with decaying inertia until an axis clamps.
3. **Pure horizontal swipe** still pans `scrollLeft` only with inertia. Pure vertical still pans `scrollTop` with inertia.
4. **Long-press selection (regression check):** long-press, drag in any direction → selection rectangle appears, captures on release.
5. **Pinch-zoom (regression check):** still works.
6. **Tap a pin (regression check):** still opens the conversation; no spurious scroll.
7. **Boundary stop:** flick toward a corner → coast halts cleanly when both axes clamp; no stuck rAF.
8. **Tap-to-stop coast:** during inertia, tap → motion halts (`cancelInertia` already wired in `onPointerDown`).
9. **Desktop (regression check):** mouse drag and scrollbar scrolling unaffected — `pointerType !== "touch"` skips the JS-pan path.
