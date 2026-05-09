# Fix: PDF pinch-zoom flicker

## Context

Pinch-zoom on the PDF currently flickers severely. Root cause: every animation frame of the gesture, `usePinchZoom` calls `onChange: handleScaleChange`, which calls `setScale(next)` (`Reader.tsx:567`). That cascades through `pageDims` (recomputed for every page on every frame, `Reader.tsx:353-362`) and feeds new `width` props into every mounted `<Page>` (`PageSlot.tsx:36-41`). `react-pdf` re-rasterizes each page's canvas at the new width on every frame — ~60 canvas re-renders/sec — and the visible result is a constant flash between stale and freshly-rendered canvases.

The fix is the standard "live preview via CSS transform, commit state on release" pattern (same as iOS Safari pinch in scrollable content):

- During the gesture, do **not** touch `scale`. Apply a CSS `transform: scale(ratio)` to the existing pages container (`contentRef` at `Reader.tsx:1217`). GPU-composited, no re-rasterization, no flicker.
- On release, clear the transform and call `handleScaleChange(z)` once. Pages re-rasterize once at the snapped scale; the existing intra-page-ratio scroll preservation runs as it does for button/keyboard zoom.

`SelectionOverlay` lives inside `contentRef` and will scale visually along with the pages — that's exactly the behavior we want; the user sees pin overlays track the page during pinch. After commit, `scale` updates and the overlay returns to its untransformed state on the new scale. Pointer events used by the pinch hook itself ride on `<main>` (the parent), unaffected by the inner transform.

## Plan

### `components/Reader.tsx`

1. **Add a pinch state** holding ratio and transform-origin (or `null` when no pinch is active):
   ```ts
   type PinchState = { ratio: number; originX: number; originY: number };
   const [pinch, setPinch] = useState<PinchState | null>(null);
   ```
   State (not ref) so React rerenders when the ratio changes, which only updates the wrapper's inline `style` — no `scale` change, so `pageDims` and the `<Page>` widths stay stable, so no canvas re-rasterization.

2. **Helper to compute transform-origin in `contentRef`-local coordinates** (visible viewport center, captured once at gesture start so the anchor doesn't drift mid-gesture):
   ```ts
   function computePinchOrigin(): { originX: number; originY: number } | null {
     const main = mainRef.current;
     const content = contentRef.current;
     if (!main || !content) return null;
     const mainRect = main.getBoundingClientRect();
     const contentRect = content.getBoundingClientRect();
     const contentLeftInMain = contentRect.left - mainRect.left + main.scrollLeft;
     const contentTopInMain = contentRect.top - mainRect.top + main.scrollTop;
     return {
       originX: main.scrollLeft + main.clientWidth / 2 - contentLeftInMain,
       originY: main.scrollTop + main.clientHeight / 2 - contentTopInMain,
     };
   }
   ```

3. **Rewire `usePinchZoom`** at `Reader.tsx:598-604`:
   ```ts
   usePinchZoom(mainRef, {
     getCurrent: () => scaleRef.current,
     min: SCALE_MIN,
     max: SCALE_MAX,
     onChange: (z) => {
       setPinch((prev) => {
         const ratio = z / scaleRef.current;
         if (prev) return { ...prev, ratio };
         const origin = computePinchOrigin();
         if (!origin) return null;
         return { ratio, ...origin };
       });
     },
     onCommit: (z) => {
       setPinch(null);
       handleScaleChange(z);
     },
     snapStep: SCALE_STEP,
   });
   ```
   The hook's commit path already clamps and snaps to `snapStep` before calling `onCommit`, so `handleScaleChange(z)` receives the final 10% multiple.

4. **Apply the transform** on the pages container at `Reader.tsx:1216-1223`:
   ```tsx
   <div
     ref={contentRef}
     className="relative mx-auto"
     style={{
       width: contentSize.width || undefined,
       minHeight: contentSize.height || undefined,
       ...(pinch
         ? {
             transform: `scale(${pinch.ratio})`,
             transformOrigin: `${pinch.originX}px ${pinch.originY}px`,
             willChange: "transform",
           }
         : null),
     }}
   >
   ```

That's it. No new files, and no other call site changes — buttons / keyboard / slider / wheel paths still go through `handleScaleChange` exactly as today.

## Why this eliminates the flicker

The visible scaling is now done via a single `transform` style update on a wrapper `<div>`. The browser composites this on the GPU without re-rasterizing the page canvases inside it. `scale` (the React state) only changes once per gesture — at commit — so `react-pdf`'s expensive page render runs once instead of ~60 times per second.

## Critical files

- `components/Reader.tsx` — add `pinch` state, `computePinchOrigin` helper, rewire `usePinchZoom` (line 598), add transform style to `contentRef`'s wrapper (line 1217).

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Pinch-zoom in/out across the full range. The pages should scale smoothly (CSS-composited), with no flashing or canvas re-rasterization mid-gesture.
  2. On release, the scale snaps to the nearest 10% and the page re-rasterizes once at the new resolution (a single, briefly visible re-render is normal — that's the one-time commit, not flicker).
  3. The visible center of the viewport should roughly track the pinch — i.e., what was at the center stays near the center.
  4. After the gesture, single-finger pan still works (regression check from the previous fix).
  5. Buttons (`+`, `-`, popover ± / slider) and keyboard shortcuts still zoom as before — they go through `handleScaleChange` directly with no pinch state involved.
  6. Selection drag, long-press, and pin overlays continue to work after a pinch.
