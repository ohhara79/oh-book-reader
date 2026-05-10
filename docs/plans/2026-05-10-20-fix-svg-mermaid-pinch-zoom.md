# Fix unreliable pinch-zoom for SVG/Mermaid in fullscreen lightbox

## Context

The fullscreen lightbox (`components/ZoomableBlock.tsx`) wraps content in `react-zoom-pan-pinch`'s `TransformWrapper` / `TransformComponent`. PNG images pinch-zoom reliably on touchscreens, but SVG and Mermaid diagrams pinch-zoom unreliably — gestures often fail outright, or the content "tries to zoom a little" but doesn't track the user's fingers.

## Root cause

The `react-zoom-pan-pinch` stylesheet ships exactly one rule that disables pointer-event hit-testing on inner content:

```css
/* node_modules/react-zoom-pan-pinch/.../transform-component.module.css */
.content img { pointer-events: none; }
```

This rule covers `<img>` (the PNG path) but not `<svg>`. SVG elements default to `pointer-events: visiblePainted` and SVG children (paths, text, group nodes, Mermaid arrow markers, etc.) are individually hit-testable. On touchscreens this breaks pinch detection in two related ways:

1. The two fingers of a pinch land on different SVG sub-elements (e.g. one on a `<path>`, one on a `<text>`). The library's `Pointers` map keys off targets/timing it expects to be consistent on a single wrapper element. With targets churning on every `touchmove` (because finger motion crosses sub-paths), the gesture is repeatedly mis-classified as panning or dropped.
2. Without `touch-action: none` on the transform wrapper, the browser's native pinch-zoom competes with the JS handler. For `<img>` (which has `pointer-events: none`) the browser's gesture engine never engages, so JS wins. For `<svg>`, the browser starts its own pinch on the SVG sub-element before the JS handler can `preventDefault()` consistently — producing the "starts to zoom but doesn't follow my fingers" symptom.

Both pathologies disappear if the lightbox content is made pointer-events-inert and the wrapper opts out of native gestures — which is precisely what the library already does for `<img>`, just incompletely.

## The fix

A single small change in `components/ZoomableBlock.tsx`:

1. Add `touchAction: "none"` to the `TransformComponent` `wrapperStyle` so the browser doesn't try to handle pinch/pan/zoom natively while react-zoom-pan-pinch is running. (This already works implicitly for `<img>` because it has `pointer-events: none`, but is needed for SVG.)
2. On the `dangerouslySetInnerHTML` wrapper div *inside the lightbox*, prepend `[&_*]:pointer-events-none` to its className. This makes the SVG and every descendant inside it inert to pointer events, mirroring the library's existing `.content img` rule but generalized. Touch events then bubble cleanly to the `react-zoom-pan-pinch` wrapper, which is the only element that needs to see them.

The same `[&_*]:pointer-events-none` is also safe to add to the trigger button's `dangerouslySetInnerHTML`: the trigger is a `<button>`, so individual SVG paths becoming non-hittable just means taps register as button clicks instead of path clicks — actually slightly *more* reliable on touch.

### Why this doesn't break anything

- **Click-to-close still works.** The lightbox close-on-background-click is implemented by the parent `<div onClick={close}>`. The inner wrapper has `onClick={(e) => e.stopPropagation()}`. With `pointer-events: none` on SVG descendants, clicks on the SVG land on the inner wrapper itself (it fills the same area), the wrapper stops propagation, and clicks outside the wrapper still close — identical UX.
- **Double-click reset still works.** The library detects double-click at the `TransformComponent` wrapper level via bubbled events.
- **Pan / single-finger drag still works.** Same touch-event delivery path as pinch.
- **PNG path is unchanged behaviorally.** `<img>` already had `pointer-events: none` from the library's CSS; `[&_*]:pointer-events-none` is a no-op for it. `touch-action: none` is also a no-op for the working PNG case (browser pinch was already suppressed there).
- **Library version is unaffected.** No need to patch `node_modules/react-zoom-pan-pinch`; the fix is entirely in our own component.

## Files modified

- `components/ZoomableBlock.tsx` — only file touched.
  - Add `touchAction: "none"` to the `wrapperStyle` object on `<TransformComponent>`.
  - Prepend `[&_*]:pointer-events-none` to the lightbox content div's className (both `html` and `ReactNode` branches).
  - Prepend `[&_*]:pointer-events-none` to `triggerCls` (helpful on touch, harmless on desktop).

No changes in `components/SvgBlock.tsx` or `components/MermaidDiagram.tsx` — the fix lives entirely in the shared lightbox.

## Verification

1. Run the dev server: `npm run dev`.
2. Open a book that contains:
   - A PNG / markdown image
   - An SVG code block (` ```svg `)
   - A Mermaid diagram (` ```mermaid `)
3. On a touchscreen device (or Chrome DevTools device emulation with multi-touch):
   - Tap each rendered diagram to open the fullscreen lightbox.
   - Pinch in/out repeatedly. The zoom should track fingers continuously and reliably for SVG and Mermaid, matching the existing PNG behavior.
   - Single-finger pan after zooming in should still work.
   - Double-tap should reset.
   - Tapping the dimmed background outside the diagram should still close the lightbox.
4. On desktop, sanity-check that mouse-wheel zoom and click-outside-to-close still work for all three content types.
