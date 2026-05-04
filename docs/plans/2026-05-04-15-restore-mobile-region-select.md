# Restore mobile long-press region selection

## Context

On mobile (touch devices), long-press + drag no longer arms region selection. The recent commit `878d365` ("Allow horizontal flick scrolling on touch devices") changed `SelectionOverlay`'s `touch-action` from `"pan-y pinch-zoom"` to `"manipulation"` and removed the manual JS horizontal-pan code, on the theory that captured pointers bypass `touch-action`.

This reintroduces a bug that was already diagnosed and explicitly reverted on May 1 (commit `4b776e3` — "Revert touch-action change that broke selection"). The cause documented in that revert applies verbatim to `manipulation` (which is equivalent to `pan-x pan-y pinch-zoom` for our purposes):

> any small horizontal jitter during the 400 ms hold lets the browser commit to a scroll and `pointercancel` clears the long-press timer. Even when the timer fires, Chrome can keep treating the in-flight gesture as a scroll despite `setPointerCapture`, so the post-arm drag never produces a selection rectangle.

The plan accompanying `878d365` (`docs/plans/2026-05-04-14-touch-horizontal-scroll.md`) asserts the opposite — but it does not cite or address the prior incident. The prior incident is the load-bearing evidence: the same change has been tried and shown to break selection on real devices.

Outcome we want: restore long-press → drag → region select on mobile, while keeping horizontal flick scrolling working (without native inertia, as before `878d365`).

## Approach: revert `878d365`'s code changes in `SelectionOverlay.tsx`

The cleanest fix is to put `components/SelectionOverlay.tsx` back to its pre-`878d365` state. That single file is the only code change in the bad commit. The companion plan doc (`docs/plans/2026-05-04-14-touch-horizontal-scroll.md`) can stay or be removed — it has no runtime effect.

Mechanically: `git revert 878d365 -- components/SelectionOverlay.tsx` (and optionally the plan doc) — or apply the equivalent edits manually. Either way, the resulting file matches the pre-878d365 state, which is the working configuration that has been tested on mobile.

### Specifics restored

In `components/SelectionOverlay.tsx`:

1. **`touch-action`** — line 639 of current file:
   - `touchAction: "manipulation"` → `touchAction: "pan-y pinch-zoom"`
   - Why this matters: with `pan-y` only, horizontal jitter during the 400 ms hold stays in JS-only territory and does **not** trigger a browser scroll commit / `pointercancel`. Vertical jitter still can, but vertical hold-jitter is much smaller in practice than horizontal.

2. **Restore three refs** (after line 110 in the current file):
   - `horizontalPanRef = useRef(false)`
   - `horizontalScrollerRef = useRef<HTMLElement | null>(null)`
   - `lastPanXRef = useRef<number | null>(null)`

3. **Restore `findHorizontalScroller()` helper** (before `armSelection`):
   walks up from `overlayRef.current.parentElement`, returns the nearest ancestor with `overflow-x: auto|scroll` and `scrollWidth > clientWidth`. Resolves to `<main>` in `components/Reader.tsx`.

4. **Restore `resetGesture()` cleanup** of the three refs.

5. **Restore `onPointerDown` touch path** initialization of the three refs (`lastPanXRef = e.clientX`, `horizontalScrollerRef = findHorizontalScroller()`, `horizontalPanRef = false`).

6. **Restore `onPointerMove` pre-arm branch**:
   - When the threshold trips, branch on `|dx| > |dy|`:
     - horizontal-dominant + a scroller exists → `horizontalPanRef = true` (keep `pointerIdRef` so subsequent moves keep flowing to JS).
     - otherwise → `pointerIdRef = null` (release to the browser; browser pans-y).
   - Below the cancel block, while `horizontalPanRef` is on, drive `horizontalScrollerRef.scrollLeft -= (e.clientX - lastPanXRef)` per move and update `lastPanXRef`.

The exact diff is the inverse of `git show 878d365 -- components/SelectionOverlay.tsx` — applying that as a reverse patch is the simplest implementation.

## Critical files

- `components/SelectionOverlay.tsx` — the only file to change.
- `docs/plans/2026-05-04-14-touch-horizontal-scroll.md` — optional: delete, since the approach it proposes is the one being reverted. Leaving it is harmless.

## Trade-offs explicitly accepted

- **No native horizontal inertia on flick.** That was the only thing `878d365` actually delivered. Restoring it without breaking long-press would require a substantially different architecture (e.g. `touch-action: none` + a full custom pan-with-inertia implementation, or moving region-select behind an explicit mode toggle). Out of scope here — the user's request is to fix the regression, not redesign the gesture model.

- The horizontal-pan workaround has a known limitation: it only triggers when the *initial* motion is horizontal-dominant. A user starting vertical and curving horizontal won't get JS pan. This was the pre-`878d365` behavior and is acceptable.

## Verification

1. `npm run dev`, open in Chrome DevTools device toolbar (e.g. iPhone 12) and on a real phone if available.
2. Open a PDF.
3. **Long-press selection (the regression):** press and hold ~0.5 s on the page, then drag → blue selection rectangle appears, releasing captures the selection and opens the conversation pane. Verify the haptic (vibrate) fires on devices that support it.
4. **Vertical scroll:** touch-drag up/down → page scrolls vertically with native inertia.
5. **Horizontal scroll (when zoomed wider than viewport):** touch-drag left/right starting with a clearly horizontal motion → `<main>` scrolls horizontally (no inertia, that's expected).
6. **Pinch-zoom** with two fingers still works.
7. **Tap on an existing pin** still opens its conversation; tapping outside a pin without holding does nothing weird.
8. **Desktop regression check:** mouse-drag selection and scrollbar scrolling on desktop remain unchanged (no `touch-action` involvement).
