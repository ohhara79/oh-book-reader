# Fix: post-pinch scroll position jumps

## Context

Pinch flicker is fixed (CSS transform during gesture, `setScale` on commit). The remaining issue: when the user lifts their fingers, the page jumps to a different scroll position than what was visible mid-gesture.

Why: the in-progress visual is anchored at `pinch.originX/originY` (the viewport's visible center captured in `contentRef`-local coordinates at `Reader.tsx:621-622`). When `onCommit` fires, it calls `handleScaleChange(z)` (`Reader.tsx:551-587`), which preserves the **focused page's intra-page ratio** — a different anchor than the one the pinch transform was using. Wherever the user pinched (e.g. between two pages, or a section header far from page-center), the post-commit position lands somewhere else and the user sees a snap.

We already have what we need to fix this: `pinch.originX` and `pinch.originY` were captured at gesture start in content-local coordinates at the start scale. After applying the new scale `z`, the same physical content point lives at `(originX × z/startScale, originY × z/startScale)` in the new content-local coordinate system. Scrolling so that point is at the viewport center makes the post-commit visual match the mid-gesture visual exactly.

To avoid a one-frame flash where the unscaled new layout briefly shows the wrong scroll, the scroll adjustment runs in `useLayoutEffect` (after React commits the DOM, before paint), keyed off a `pendingPinchScrollRef`.

## Plan

### `components/Reader.tsx`

1. **Add a ref to carry the pinch scroll target across the commit re-render**:
   ```ts
   const pendingPinchScrollRef = useRef<{ targetX: number; targetY: number } | null>(null);
   ```

2. **`useLayoutEffect` keyed off `scale`** runs after the DOM has committed the new layout but before the browser paints. If the pinch handler set the ref, we adjust scroll there:
   ```ts
   useLayoutEffect(() => {
     const target = pendingPinchScrollRef.current;
     if (!target) return;
     pendingPinchScrollRef.current = null;
     const m = mainRef.current;
     const c = contentRef.current;
     if (!m || !c) return;
     const mainRect = m.getBoundingClientRect();
     const contentRect = c.getBoundingClientRect();
     const contentLeftInMain =
       contentRect.left - mainRect.left + m.scrollLeft;
     const contentTopInMain =
       contentRect.top - mainRect.top + m.scrollTop;
     m.scrollTo({
       left: Math.max(0, target.targetX + contentLeftInMain - m.clientWidth / 2),
       top: Math.max(0, target.targetY + contentTopInMain - m.clientHeight / 2),
       behavior: "auto",
     });
   }, [scale]);
   ```
   The ref is null on every other `scale`-change path (button, keyboard, slider, wheel), so this effect is a no-op for them — they keep using `handleScaleChange`'s existing intra-page-ratio restore.

3. **Rewire `onCommit`** (around `Reader.tsx:639-642`) to bypass `handleScaleChange` for the pinch path and route through the new ref + `setScale`:
   ```ts
   onCommit: (z) => {
     if (!pinch) {
       handleScaleChange(z);
       return;
     }
     const startScale = scaleRef.current;
     const ratio = z / startScale;
     pendingPinchScrollRef.current = {
       targetX: pinch.originX * ratio,
       targetY: pinch.originY * ratio,
     };
     setPinch(null);
     setScale(z);
   },
   ```
   Both `setPinch(null)` and `setScale(z)` are batched into one render. The render commits; `useLayoutEffect` reads the ref and snaps scroll before paint. Single, atomic transition from the transform-preview to the new-scale layout — same anchor as the pinch.

   Fallback path (`pinch === null`, e.g. refs were unavailable when the gesture started): defer to the existing `handleScaleChange(z)`.

That's the entire change. The pinch state shape (`{ ratio, originX, originY }`), the transform style on `contentRef`, and `onChange` are unchanged.

## Why a ref + `useLayoutEffect`, not `flushSync` and not the existing `rAF×2`

- `rAF×2` (what `handleScaleChange` does) lets the browser paint the wrong scroll once before correcting — visible flash.
- `flushSync` would also work but spreads the logic into the event handler and forces a synchronous render outside React's normal scheduling. The ref pattern keeps the handler small and React-idiomatic.
- `useLayoutEffect` runs after DOM commit, before paint — exactly the window where we know the new layout is in place but the user hasn't seen it yet.

## Critical files

- `components/Reader.tsx` — add `pendingPinchScrollRef`, the new `useLayoutEffect(...)`, and rewrite `onCommit` (around lines 598–644).

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Scroll to the middle of a page so a recognisable feature (an equation, a figure caption) sits at the visible center.
  2. Pinch in (or out) and release. The same feature should remain at the visible center after the gesture finishes — no jump from "what I saw at release" to "where the page settled."
  3. Repeat near the top and bottom of pages, and across page boundaries (visible-center landing in the gap between two pages). The anchor should still be preserved.
  4. Buttons, keyboard `+/-/0`, slider, wheel zoom continue to work as before — they go through `handleScaleChange` and use the focused-page intra-page-ratio restore.
  5. After a pinch, single-finger pan still works (regression check from the earlier fix).
  6. No flicker mid-gesture (regression check from the previous fix).
