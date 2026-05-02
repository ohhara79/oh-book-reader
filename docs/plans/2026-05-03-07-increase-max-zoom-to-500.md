# Plan: Increase Max Zoom from 300% to 500%

## Context

The PDF reader currently caps zoom at 300% (`SCALE_MAX = 3`). The user wants to raise the cap to 500% so they can zoom in further on small details. This is a single-constant change — all zoom enforcement (button handlers, localStorage restore clamping) already references `SCALE_MAX`, so updating the constant cascades everywhere it matters.

## Change

**File:** `components/Reader.tsx`

- **Line 67:** Change `const SCALE_MAX = 3;` → `const SCALE_MAX = 5;`

That's the only edit. No other code touches the 300% bound directly:
- Zoom-in button (line 761) uses `Math.min(SCALE_MAX, scale + 0.2)`
- localStorage restore (line 164) uses `Math.min(SCALE_MAX, ...)`
- Percentage display (line 756) is `Math.round(scale * 100)` — will render up to `500%` automatically

## Verification

1. Run the dev server.
2. Open a PDF in the reader.
3. Click the zoom-in (+) button repeatedly past 300% — it should keep increasing in 20% steps and reach 500% before stopping.
4. Confirm the header displays `500%` at the cap.
5. Reload the page — saved scale should restore correctly (any value ≤ 500% kept as-is).
6. Click zoom-out (−) from a high zoom — should still bottom out at 50%.
