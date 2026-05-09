# Fix: PDF pinch-zoom should snap to 10% steps

## Context

The PDF zoom buttons step by 10% (`stepScale(±0.1)` at `components/Reader.tsx:588`, also reflected in the recent commit "Halve PDF zoom button step to 10%"). Keyboard `+` / `-` step the same way (`Reader.tsx:656`). But pinch-zoom on touch ends at whatever continuous multiplier the user's fingers happened to land on — e.g. 1.342×, 0.873× — so the resulting state doesn't line up with the button/keyboard step grid. The user sees a zoom level that the buttons can't reproduce and that doesn't read as a clean percentage.

The pinch hook already supports release-time snapping (`lib/usePinchZoom.ts:99-105` reads `opts.snapStep` and rounds the committed value to the nearest multiple). The conversation panel's font-zoom uses this — `snapStep: ZOOM_STEP` (= 0.1) at `ConversationPanel.tsx:465`. The PDF call site in `Reader.tsx:597-602` simply omits it. Adding `snapStep: 0.1` makes the PDF pinch behave consistently with its own buttons and with the font-zoom pinch.

Per the existing pinch-zoom design (smooth feedback during the gesture, snap on release), no `onCommit` override is needed — the hook will call the existing `handleScaleChange` with the snapped value at commit time, which is exactly what we want.

## Plan

### `components/Reader.tsx`

1. Add a module-scope constant alongside `SCALE_MIN` / `SCALE_MAX` (around line 70):
   ```ts
   const SCALE_STEP = 0.1;
   ```
2. Replace the magic `0.1` literals at the existing button/keyboard call sites with `SCALE_STEP` so pinch and the rest stay in sync if the value ever changes:
   - `stepScale(-0.1)` and `stepScale(0.1)` button handlers (`Reader.tsx:1104,1109` — the popover ± buttons).
   - `stepZoom(0.1)` / `stepZoom(-0.1)` in the keyboard handler (`Reader.tsx:701,705` area).
   - The `step={0.1}` slider attribute on the zoom range input in the popover.
   *(A search-and-replace under `grep -n "\b0\.1\b" Reader.tsx` will surface all sites.)*
3. Add `snapStep` to the pinch hook call:
   ```tsx
   usePinchZoom(mainRef, {
     getCurrent: () => scaleRef.current,
     min: SCALE_MIN,
     max: SCALE_MAX,
     onChange: handleScaleChange,
     snapStep: SCALE_STEP,
   });
   ```

That's the entire change. The hook's commit path already does:
```ts
const snapped = Math.round(pendingZoom / opts.snapStep) * opts.snapStep;
const final  = clamp(snapped, opts.min, opts.max);
(opts.onCommit ?? opts.onChange)(final);
```
With no `onCommit` provided, it calls `onChange(final)` — i.e., `handleScaleChange(final)` — which already preserves the focused-page intra-page scroll ratio on scale change.

Smooth-during, snap-on-release: same UX as the conversation pinch.

## Critical files

- `components/Reader.tsx` — add `SCALE_STEP` constant, swap literal `0.1` callers to use it, append `snapStep: SCALE_STEP` to the `usePinchZoom` options.

## Verification

- `npx tsc --noEmit` — type check passes.
- Manual on a touch device:
  1. Open the PDF view; zoom level reads 100%.
  2. Pinch in / out and release. The committed scale should land on a 10% multiple every time (50%, 60%, 70%, … 500%) — verify by reading the percentage in the zoom popover.
  3. The mid-gesture animation should still be smooth (continuous, not chunky).
  4. After release, `+` / `-` keys and the popover ± buttons continue from the snapped value with their own 10% step.
  5. Pinching to the extremes clamps at 50% and 500% (no overshoot).
- Sanity: pinch the conversation thread / messages — the existing 10% snap on release for font zoom is unchanged.
