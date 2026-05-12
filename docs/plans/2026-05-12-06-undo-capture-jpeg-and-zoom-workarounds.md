# Undo capture compression / downsample workarounds

## Context

The stdin "Unterminated string" failure that pushed us to compress capture
images was misdiagnosed. The real bug was a Node `child_process` → Bun
stdin pipe interaction and is now fixed by `bin/claude-buffered-stdin.sh`
(see commit `131e89f`, `docs/plans/2026-05-12-05-claude-stdin-wrapper.md`,
and the inline note at `lib/optimizeImageForClaude.ts:9-15`).

With the root cause resolved, the size-reduction work added to dodge it is
no longer earning its keep:

1. **Client JPEG re-encode at 0.85 quality** on every selection capture —
   capture quality is permanently lossy for no benefit.
2. **Server `mozjpeg` re-encode in `optimizeImageForClaude`** — a second
   lossy pass every time an image goes to Claude, including small images
   the user pasted that don't need any resize at all.
3. **`captureRatio = scale > 1 ? 1 / scale : 1` zoom-invariant downsample**
   — when the user zooms in to capture detail, we resample back down to
   PDF native scale before applying the 1568 cap, throwing away the
   crispness the user explicitly zoomed in to get.

The 1568 px long-edge cap stays — Anthropic's vision pipeline downsamples
anything larger to ~1568 anyway, so sending bigger just wastes wire bytes
and tokens.

After this change:
- Selection captures are encoded as PNG end-to-end (client → disk →
  Claude), using the live canvas pixels directly. The only client
  resampling is the 1568 long-edge cap.
- The single server-side image function becomes "**resize if and only
  if the long edge exceeds 1568, preserving the input's media type**".
  Anything ≤ 1568 (the common case for new client-sized captures and
  most pasted attachments) is passed through verbatim — no decode, no
  re-encode, no metadata loss.

## Changes

### 1. `components/SelectionOverlay.tsx`

Lines 26-30 — drop the JPEG quality constant, keep the long-edge cap:

```ts
// 1568 px matches Anthropic's vision-pipeline downsample target so we
// don't waste vision tokens or wire bytes encoding pixels Claude will
// just throw away.
const MAX_LONG_EDGE = 1568;
```

Lines 588-611 — remove the `captureRatio` zoom-divisor and switch the
encode back to PNG. The 1568 cap now operates directly on the cropped
canvas dimensions (which already grow with displayed zoom — that's the
point):

```ts
const nativeLong = Math.max(sw, sh);
const longCap = nativeLong > MAX_LONG_EDGE ? MAX_LONG_EDGE / nativeLong : 1;
const dw = Math.max(1, Math.round(sw * longCap));
const dh = Math.max(1, Math.round(sh * longCap));
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

Lines 666-673 (or wherever the captured span is pushed) — change
`imageMediaType: "image/jpeg"` back to `"image/png"`. `CapturedSpan`'s
type union at line 19 already permits both, no widening needed.

### 2. `lib/optimizeImageForClaude.ts` — rewrite to "preserve format, resize only if needed"

Replace the whole file. New shape:

```ts
import sharp from "sharp";
import {
  isImageMediaType,
  type Attachment,
  type ImageAttachmentMediaType,
} from "./attachments";

// 1568 px matches Anthropic's vision-pipeline downsample target. Anything
// at or under that cap is passed through verbatim — no decode, no
// re-encode, no metadata loss.
const MAX_LONG_EDGE = 1568;

export type ResizedImage = {
  base64: string;
  mediaType: ImageAttachmentMediaType;
};

export async function maybeResizeForClaude(
  base64: string,
  mediaType: ImageAttachmentMediaType,
): Promise<ResizedImage> {
  const input = Buffer.from(base64, "base64");
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= MAX_LONG_EDGE && h <= MAX_LONG_EDGE) {
    return { base64, mediaType };
  }
  let p = sharp(input).resize({
    width: MAX_LONG_EDGE,
    height: MAX_LONG_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  switch (mediaType) {
    case "image/png":  p = p.png(); break;
    case "image/jpeg": p = p.jpeg({ quality: 95, mozjpeg: true }); break;
    case "image/webp": p = p.webp({ quality: 95 }); break;
    case "image/gif":  p = p.gif(); break;
  }
  const out = await p.toBuffer();
  return { base64: out.toString("base64"), mediaType };
}

export async function maybeResizeAttachmentsForClaude(
  attachments: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (a) => {
      if (!isImageMediaType(a.media_type)) return a;
      const r = await maybeResizeForClaude(a.data, a.media_type);
      return { ...a, data: r.base64, media_type: r.mediaType };
    }),
  );
}
```

Rationale for `quality: 95, mozjpeg: true` on JPEG re-encode: when a
JPEG > 1568 has to be resized, sharp must decode and re-encode it (you
can't resize without it). Quality 95 is visually lossless and is the
right setting for "user uploaded a high-res photo, we had to shrink
it." Same logic for WebP. PNG and GIF re-encode losslessly.

Function renames (export-name changes):
- `optimizeImageForClaude` → `maybeResizeForClaude`
- `optimizeAttachmentsForClaude` → `maybeResizeAttachmentsForClaude`

This is a deliberate rename — the old names lied about "optimizing" when
the new behavior is "leave it alone when it's already fine."

### 3. `app/api/conversations/route.ts`

- Lines 20, 140: update import + call site to the new names.
- Lines 61-68: remove the "reject PNG" guard. Both PNG (new) and JPEG
  (legacy in-flight) are valid inputs for the disk write.
- Line 144 (`promptSpans.map` literal): flip `imageMediaType: "image/jpeg"
  as const` to `"image/png" as const`. Initial-turn spans are PNG from
  the client now.

### 4. `app/api/conversations/[id]/messages/route.ts`

- Lines 28-31: update import to `maybeResizeForClaude` and
  `maybeResizeAttachmentsForClaude`.
- `loadSelectionAsPromptSpans` (lines 70-104): collapse to one code
  path. Sniff magic bytes to determine the on-disk media type, then
  unconditionally call `maybeResizeForClaude`:

  ```ts
  function sniffImageMediaType(buf: Buffer): "image/png" | "image/jpeg" {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    return "image/png";
  }
  // ...
  const bytes = await readSelectionImage(bookId, selectionId, i);
  const mediaType = sniffImageMediaType(bytes);
  const r = await maybeResizeForClaude(bytes.toString("base64"), mediaType);
  return {
    page: s.page,
    imageBase64: r.base64,
    imageMediaType: r.mediaType,
    // ...
  };
  ```

  New captures (PNG ≤ 1568) and brief-era JPEGs (≤ 1568) both fast-path
  through verbatim. Only legacy oversized PNGs from before the 1568 cap
  actually hit sharp.

  `PromptSpan.imageMediaType` (declared in `lib/promptParts.ts`) needs
  to accept both `"image/png"` and `"image/jpeg"`; check and widen if
  it's currently narrowed to one.
- Lines 142, 147, 302: update the three `optimizeAttachmentsForClaude`
  call sites to `maybeResizeAttachmentsForClaude`.

### 5. `app/api/conversations/[id]/route.ts`

No change. The GET handler at lines 39-47 already detects JPEG vs PNG by
magic bytes and sets `imageMediaType` accordingly, so it transparently
handles all three on-disk populations (new PNG, brief-era JPEG, legacy
PNG).

### 6. `lib/store.ts`

- Line 219 parameter name and line 225 extension: `_${i}.jpg` →
  `_${i}.png`. Rename param `imagesJpegBytes` → `imagesPngBytes`.
- `readSelectionImage` (lines 236-251): reorder so `.png` is tried
  first; `.jpg` becomes a legacy fallback after it.
- `deleteSelection` (lines 354-364): no change — already cleans up
  both `.jpg` and `.png`.

### 7. `lib/referencedThreadsServer.ts`

- Lines 13-15: update import.
- Line 53: was unconditionally calling `optimizeImageForClaude(png.toString("base64"))`
  and assuming PNG input. Switch to:

  ```ts
  const bytes = await readSelectionImage(bookId, conv.selection_id, i);
  const mediaType = sniffImageMediaType(bytes);
  const r = await maybeResizeForClaude(bytes.toString("base64"), mediaType);
  ```

  (Hoist `sniffImageMediaType` into a shared module, e.g.
  `lib/imageSniff.ts` — or co-locate it next to `maybeResizeForClaude`
  in `lib/optimizeImageForClaude.ts` and export it.)
- Line 73: rename to `maybeResizeAttachmentsForClaude`.

## Critical files

- `components/SelectionOverlay.tsx` (lines 26-30, 588-611, 666-673)
- `lib/optimizeImageForClaude.ts` (whole-file rewrite)
- `lib/store.ts` (lines 217-251)
- `lib/referencedThreadsServer.ts` (lines 13, 53, 73)
- `app/api/conversations/route.ts` (lines 20, 61-68, 140, 144)
- `app/api/conversations/[id]/messages/route.ts` (lines 28-31, 70-104,
  142, 147, 302)
- `lib/promptParts.ts` — verify `PromptSpan.imageMediaType` accepts
  both PNG and JPEG; widen if needed.

No edits expected in `app/api/conversations/[id]/route.ts` or any
component beyond what TypeScript narrowing surfaces.

## Verification

Run `npm run dev`. Manual end-to-end:

1. **Fresh capture is PNG, at the displayed zoom.** Open a book, zoom
   to 2× or 3×, drag-capture a region. In
   `data/books/<book>/selections/`, the new file is `<sel>_0.png`. Run
   `file …png` — reports "PNG image data". Inspect dimensions: they
   match the live canvas crop (sw × sh) directly, scaled down only if
   the long edge exceeded 1568. The image looks as crisp as what you
   saw on screen.
2. **Composer preview matches saved bytes.** The image shown in the
   composer before submit is the same PNG that ends up in
   `selections/` and the same PNG that arrives in the conversation
   reload view (DevTools → Network on the conversation GET:
   `capture.spans[0].imageMediaType === "image/png"`).
3. **Claude actually gets PNG.** Submit an `ask`. Add a temporary
   `console.log` on the `loadSelectionAsPromptSpans` return value (or
   on the prompt blocks); confirm `imageMediaType === "image/png"` for
   the new turn. Claude's reply references the image correctly. No
   stdin parse errors in server logs even with multi-MB PNGs.
4. **Small attachments pass through verbatim.** Paste a small (< 1568
   on both edges) PNG into the composer. Add a temporary log in
   `maybeResizeForClaude` to confirm the early-return branch fires.
   Compare the bytes Claude receives (log them) against the bytes the
   client uploaded — byte-identical, original `media_type` preserved.
5. **Large JPEG attachment is resized but stays JPEG.** Paste a > 3000
   px JPEG. Confirm sharp's resize branch fires, output media type is
   still `image/jpeg`, long edge ≤ 1568, file looks fine (quality 95).
6. **Legacy JPEG selections (brief era) still work.** Find a book with
   `_0.jpg` selections from the JPEG window (or rename a fresh `.png`
   to `.jpg` and re-edit its bytes if you don't have one handy).
   Reload that conversation — the UI renders via the GET handler's
   magic-byte detection. Ask a follow-up — server sniffs JPEG, passes
   verbatim through `maybeResizeForClaude` (≤ 1568, fast path).
7. **Legacy oversized PNG selection.** Drop a > 2000 px PNG into a
   `selections/` directory by hand. Ask a follow-up — sharp resizes
   and emits PNG. Request succeeds.
8. **Delete cleanup.** Delete a new conversation/selection. Confirm
   `.json` and `.png` are both removed. Delete a legacy `.jpg`
   selection. Confirm `.json` and `.jpg` are both removed.
9. **`tsc` clean.** `npm run build` to catch narrowed-type mismatches
   from the rename + media-type flip.
