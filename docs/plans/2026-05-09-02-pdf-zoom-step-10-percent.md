# Halve PDF zoom button step from 20% to 10%

## Context

The PDF reader's zoom +/- controls currently step by 20% per click (`0.2` in scale units), which feels coarse now that a fine-grained slider sits between the buttons. The slider already uses `step={0.1}`, so the buttons should match for consistent behavior. The user wants smaller, more precise per-click adjustments.

## Change

In `components/Reader.tsx`, replace `0.2` with `0.1` (and `-0.2` with `-0.1`) at four locations:

- **Line 685** — keyboard "+" / "=" shortcut: `stepZoom(0.2)` → `stepZoom(0.1)`
- **Line 689** — keyboard "-" shortcut: `stepZoom(-0.2)` → `stepZoom(-0.1)`
- **Line 1096** — zoom-out UI button: `stepScale(-0.2)` → `stepScale(-0.1)`
- **Line 1139** — zoom-in UI button: `stepScale(0.2)` → `stepScale(0.1)`

The user only mentioned the +/- buttons, but the keyboard shortcuts are the same conceptual control and should stay aligned with the buttons. Including both keeps behavior consistent.

No other code touches these step values. `SCALE_MIN` / `SCALE_MAX` (lines 68-69) and the slider's existing `step={0.1}` (line 1120) remain unchanged.

## Verification

- `npm run dev`, open a PDF, open the zoom popover.
- Click +/- and confirm each click moves the percentage label by 10%.
- Press `+` / `-` on the keyboard and confirm the same 10% step.
- Drag the slider to confirm it still works (unchanged).
- Confirm the buttons disable correctly at `SCALE_MIN` (50%) and `SCALE_MAX` (500%).
