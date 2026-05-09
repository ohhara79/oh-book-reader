# Fix: scroll jump still happens because the pinch state is sometimes null on commit

## Context

Commit `7b387aa` introduced a useLayoutEffect-driven scroll restore that anchors the post-pinch scroll to the gesture's origin. The user reports that, in practice, the jump still happens. A close re-read of the code path confirms a real bug at `Reader.tsx:734-755`:

```ts
onCommit: (z) => {
  if (!pinch) {
    handleScaleChange(z);   // ← falls back to focused-page intra-page-ratio anchor
    return;                 //   (the very anchor the fix was supposed to replace)
  }
  …                          // pinch-anchor scroll path with pendingPinchScrollRef
}
```

The `pinch` state is only ever set inside `onChange` (`Reader.tsx:725-732`), and `onChange` is only called from `usePinchZoom`'s rAF flush (`lib/usePinchZoom.ts:43-46`). The hook's commit path **cancels** any pending rAF before invoking `onCommit` (`lib/usePinchZoom.ts:97-99`):

```ts
if (raf) {
  cancelAnimationFrame(raf);
  raf = 0;
}
if (pendingZoom != null) {
  …
  (o.onCommit ?? o.onChange)(final);
}
```

So whenever the user releases their fingers between the last `pointermove` and the next animation frame — or any time the React render that would commit the latest `setPinch` hasn't been flushed yet — `pinch` is still `null` when `onCommit` reads it. The closure takes the `if (!pinch)` shortcut and routes through `handleScaleChange`'s rAF×2 intra-page-ratio anchor, producing exactly the jump the previous commit was meant to eliminate. The same null-fallback also explains the user's other recent observation that the loading spinner sometimes doesn't appear: `setPagesLoading(loading)` is on the pinch branch, not the fallback branch.

The fix: in the fallback case, recompute the origin on demand. At the moment `onCommit` fires with `pinch === null`, no transform has ever been applied (the transform JSX is `pinch ? {…} : null`), no programmatic scroll happened during the gesture, and the user hasn't been able to scroll either (their fingers were on the screen). So `mainRef.current.scrollLeft/scrollTop` and `contentRef`'s bounding rect are still at the gesture-start state — exactly what `computePinchOrigin()` already reads. We can use it as a same-shape replacement for the missing `pinch` value, drive the same anchored-scroll path, and also set the loading spinner.

While we're there, handle the corner where the snapped scale equals `scaleRef.current` (e.g., a tiny gesture that quantises back to the same step): `setScale` becomes a no-op, the `[scale]`-keyed `useLayoutEffect` never fires, and a stale `pendingPinchScrollRef.current` would otherwise leak into the next zoom action.

## Plan

### `components/Reader.tsx`

Replace the existing `onCommit` body (around lines 734-755) with:

```ts
onCommit: (z) => {
  // No actual scale change (gesture quantised back to the current step):
  // clear pinch and bail without queuing a scroll target or a spinner.
  if (z === scaleRef.current) {
    setPinch(null);
    return;
  }

  // Use the live `pinch` if onChange got at least one rAF flush in;
  // otherwise recompute the origin on the spot. At this point no
  // transform has been applied, so the read gives the same numbers
  // we'd have captured at the first onChange.
  const anchor = pinch ?? computePinchOrigin();
  if (!anchor) {
    setPinch(null);
    handleScaleChange(z);
    return;
  }

  const loading = new Set<number>();
  for (let n = renderWindow.start; n <= renderWindow.end; n++) {
    const wrapper = pageWrapperRefs.current.get(n);
    if (wrapper?.querySelector("canvas")) loading.add(n);
  }
  const startScale = scaleRef.current;
  const ratio = z / startScale;
  pendingPinchScrollRef.current = {
    targetX: anchor.originX * ratio,
    targetY: anchor.originY * ratio,
  };
  setPagesLoading(loading);
  setPinch(null);
  setScale(z);
},
```

No other code changes. `computePinchOrigin` already exists at `Reader.tsx:607-624` and reads exactly the shape (`{ originX, originY }`) we need; `pinch` is a structural superset (`{ ratio, originX, originY }`), so the `??` chain works cleanly.

## Why this should be enough

Three independent failure modes all funnel through the same `if (!pinch)` shortcut:

1. **Fast pinch under a frame (<~16 ms)**: no `pointermove` rAF ever flushes, so `setPinch` is never called.
2. **Long pinch but pointerup arrives before React commits the latest `setPinch` render**: the optsRef closure still captures `pinch === null`. React's batching makes this a real race, especially under load.
3. **First-frame race**: rAF cancelled in `endPointer` before the flush that would have set `pinch`.

All three converge on `onCommit` seeing `pinch === null`. With the fallback now reaching the same anchored-scroll path (instead of `handleScaleChange`), every pinch commits via the right anchor, and the loading spinner shows up consistently.

## Critical files

- `components/Reader.tsx` — rewrite the `onCommit` callback inside `usePinchZoom(...)` (around lines 734-755).

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Slow, deliberate pinch — committed scroll position lands where the visible center was when fingers lifted (was already working, regression check).
  2. Quick pinch / quick double-tap-pinch — same; no jump to a focused-page-anchored position.
  3. Pinch that ends at the same percentage you started at (e.g., wiggle without committing a step) — no scroll change, no flash.
  4. Repeat several pinches in quick succession — every one shows the spinner (covers the "sometimes I can't see the spinner" complaint as well, because the fallback path now also sets `pagesLoading`).
  5. Buttons / keyboard `+`/`-`/`0` / slider / wheel zoom continue to anchor on intra-page ratio (they don't go through `usePinchZoom`'s `onCommit`).
- Diagnostic (optional, during dev): temporarily log inside `onCommit` whether `pinch` was `null` to count how often the fallback path fires. Anything >0 over a few real gestures confirms the bug was being hit.
