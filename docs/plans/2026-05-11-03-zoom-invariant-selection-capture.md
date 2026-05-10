# Make selection capture zoom-invariant

## Context

`components/SelectionOverlay.tsx:582-590` rasterizes the user's selection by reading pixels directly out of `react-pdf`'s live canvas at its current pixel dimensions. The canvas is rendered at `scale={scale}` (`Reader.tsx:1435`), so a 2× zoom roughly quadruples the pixel count of the cropped PNG even though the content (same PDF region) is unchanged.

The stored `bbox` is already zoom-invariant — `SelectionOverlay.tsx:649-654` divides screen coords by `scale` so the bbox lives in scale=1 PDF point space. Only the image isn't. Symptoms: selections made while zoomed-in produce big PNGs on disk and big upload payloads to `POST /api/conversations`. (The server-side optimizer added in `2026-05-11-02` downsamples for Claude, but the unshrunk version still hits disk and the network upload.)

**Goal:** the captured PNG should look the same regardless of the user's current zoom — i.e., always equivalent to what you'd capture at PDF native scale (`scale = 1.0`), the same coordinate frame the stored `bbox` already lives in.

## Approach

In the capture loop in `SelectionOverlay.tsx` (around lines 582-590), keep the source crop coordinates exactly as they are (they correctly map CSS coords into the live canvas's pixel space, DPR included), but resize the destination canvas to a zoom-invariant target before `drawImage` writes into it. The browser's built-in `drawImage` resampling handles the downscale.

**Reference scale: 1.0.** PDF native — one PDF point per CSS pixel. The captured image's pixel dimensions exactly match the stored `bbox` (which is already in PDF points, see `SelectionOverlay.tsx:649-654`). A US Letter page at scale=1 is ~612 px wide, so a multi-line math crop ends up at most a few hundred pixels in each axis — small, consistent files.

**Don't upscale.** When the user has zoomed *out* below 1.0 (allowed: `SCALE_MIN = 0.5`), the live canvas already has fewer pixels than the reference; bilinear-upscaling those pixels just adds blur with no information gain. Cap the resample ratio at 1 (i.e., only downscale, never upscale). Net behavior:

| User zoom        | Behavior                                  |
| ---------------- | ----------------------------------------- |
| `scale > 1`      | Downsample to `1 / scale` ratio           |
| `scale == 1`     | 1:1 copy (no resampling)                  |
| `scale < 1`      | 1:1 copy (no upscale)                     |

At DEFAULT_SCALE (1.4) the captured image is `1/1.4 ≈ 71%` of the live-canvas crop in each axis; at SCALE_MAX (3) it's 33%. Captured file sizes stay bounded by the scale=1 equivalent.

## Implementation

### `components/SelectionOverlay.tsx`

Replace the capture block (former lines 582-590) with a resize-aware version. The `scale` prop is already on the component (`SelectionOverlay.tsx:43`) and in scope within the capture closure.

```ts
const captureRatio = scale > 1 ? 1 / scale : 1;
const dw = Math.max(1, Math.round(sw * captureRatio));
const dh = Math.max(1, Math.round(sh * captureRatio));

const tmp = document.createElement("canvas");
tmp.width = dw;
tmp.height = dh;
const ctx = tmp.getContext("2d");
if (!ctx) continue;
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";
ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, dw, dh);
const dataUrl = tmp.toDataURL("image/png");
const imageBase64 = dataUrl.split(",", 2)[1] ?? "";
```

`bbox`, text extraction, page indexing — all untouched. The downstream `CapturedSpan.imageBase64: string` contract (`SelectionOverlay.tsx:18`) is unchanged.

## Files

- **edit** `components/SelectionOverlay.tsx` — rewrite the capture sizing inside the per-page loop. Single file change.

No server-side changes. The optimizer added in `2026-05-11-02` still runs for Claude, but its job is now a no-op for selection images (well under 1568 px on the long edge at scale=1).

## Verification

1. Open a book at default zoom (1.4×). Select a multi-line region. Note the saved PNG dimensions / size under `data/books/<id>/selections/` — should be roughly the bbox width × bbox height in pixels (PDF point units).
2. Zoom to 3× (SCALE_MAX). Select the *same* region. The saved PNG should have approximately the same pixel dimensions as step 1 (small differences from rounding and from the resampling pass are fine) — *not* ~4–5× larger like before.
3. Zoom to 0.5× (SCALE_MIN). Select the same region. The PNG should be 1:1 from the live canvas — *smaller* than step 1, not blurry-upscaled.
4. Ask Claude a question on the step-2 selection. Should succeed with normal streaming. Claude's answer should reference content visible in the image (confirms scale=1 is still readable for math).
5. Open the lightbox on the step-2 selection — the image should look reasonable (some softening vs the live high-zoom view is expected since we're at scale=1, but no obvious artifacts).
6. `npm run build` clean.
