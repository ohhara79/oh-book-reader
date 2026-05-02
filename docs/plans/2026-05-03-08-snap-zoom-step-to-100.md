# Plan: Snap Zoom Step to 100%

## Context

The reader uses a fixed `0.2` zoom step starting from `SCALE_MIN = 0.5`. From 50% the progression is 50% → 70% → 90% → 110% — 100% is never reachable via the buttons. The user wants 100% always reachable.

## Fix

Snap to `1.0` whenever a zoom step would cross it. If we're below 100% and the next step is above (or vice-versa), set scale to exactly `1.0` instead. This keeps the existing 0.2 grid otherwise — only the "crossing 100%" case is special-cased.

Examples after the fix:
- 50% → 70% → 90% → **100%** → 120% → 140% (zoom in, default scale lands on the grid)
- 140% → 120% → **100%** → 80% → 60% → 50% (zoom out unchanged)
- 110% → **100%** → 80% (zoom out from above also snaps)

## File modified

`components/Reader.tsx`

### Change 1 — add `stepScale` helper near `handleScaleChange`

```ts
const stepScale = (delta: number) => {
  const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale + delta));
  if ((scale < 1 && next > 1) || (scale > 1 && next < 1)) {
    handleScaleChange(1);
  } else {
    handleScaleChange(next);
  }
};
```

### Change 2 — zoom-out button onClick

Replace `handleScaleChange(Math.max(SCALE_MIN, scale - 0.2))` with `stepScale(-0.2)`.

### Change 3 — zoom-in button onClick

Replace `handleScaleChange(Math.min(SCALE_MAX, scale + 0.2))` with `stepScale(0.2)`.

(Floating-point note: `0.5 + 0.2*n` produces values like `0.7000000000001`. The strict `< 1`/`> 1` comparisons still classify those correctly, and `handleScaleChange(1)` writes the exact value, so no rounding is needed.)

## Verification

1. `npm run dev` and open a book.
2. Click zoom-out until 50% (clamped at SCALE_MIN). Click zoom-in repeatedly: 50 → 70 → 90 → **100** → 120 → … up to 500%.
3. Click zoom-out from 500% back down: … → 120 → **100** → 80 → 60 → 50%.
4. Confirm the % readout shows exactly `100%` at the snap point, not `99%` or `101%`.
5. Confirm scroll position is preserved across zoom changes (existing `handleScaleChange` behavior is unchanged).
