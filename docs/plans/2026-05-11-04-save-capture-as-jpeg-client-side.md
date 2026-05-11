# Save the JPG that Claude sees, not the original PNG

## Context

When the user drags to capture a region of the PDF, the browser produces a
high-resolution PNG (`SelectionOverlay.tsx:598` — `tmp.toDataURL("image/png")`).
That PNG is what is currently:

1. Saved to disk as `data/books/<book>/selections/<sel>_<i>.png`
   (`lib/store.ts:217-229`).
2. Shown back to the user in the composer preview and when reopening a
   conversation (`app/api/conversations/[id]/route.ts:43` hardcodes
   `image/png`).

When the server sends an image to Claude it first runs the PNG through
`optimizeImageForClaude` (sharp resize to ≤1568px long edge, mozjpeg
quality 85 — `lib/optimizeImageForClaude.ts:11-12`). That JPG is what
Claude actually receives, and it can look noticeably more compressed than
the PNG the user sees in the UI.

The user wants the saved file and the displayed image to be the same
compressed JPG that Claude sees, so they can visually judge how much
quality is lost. They chose **client-side conversion** (so the composer
preview shown before submit is byte-for-byte the JPG that hits Claude —
quality is close to but not identical to mozjpeg) and **read-fallback**
for legacy `.png` files on disk.

## Approach

Move the resize + JPEG-encode into the browser, at the moment the
selection canvas is produced. The browser sends JPEG base64 to the server,
the server stores those bytes verbatim as `<sel>_<i>.jpg`, and every
downstream consumer (Claude prompts, UI previews, conversation reloads)
treats the on-disk bytes as `image/jpeg`. Legacy `.png` files still work
via a read fallback and on-the-fly optimization when sent to Claude.

## Changes

### 1. `components/SelectionOverlay.tsx` — client-side compression

Replace the PNG encode at lines 590-598 with: downscale the cropped region
canvas to ≤ `MAX_LONG_EDGE` (1568px) on its long edge, then
`canvas.toDataURL("image/jpeg", 0.85)`.

- Compute the final dimensions: if `max(dw, dh) > MAX_LONG_EDGE`, scale
  both by `MAX_LONG_EDGE / max(dw, dh)`; else use `dw, dh` as-is. This
  may collapse with the existing `captureRatio` downsample at line 587 —
  do one composite scale to a single `tmp` canvas so we don't resample
  twice.
- Use `imageSmoothingQuality = "high"` (already set at line 596).
- `tmp.toDataURL("image/jpeg", 0.85)`.
- Update the `spans.push` at line 666-673: `imageMediaType: "image/jpeg"`.
- Widen the `CapturedSpan.imageMediaType` type at lines 14-24 to
  `"image/png" | "image/jpeg"` so the type also accepts captures loaded
  from the GET endpoint (which will be JPEG for new selections, PNG for
  legacy).
- Add `MAX_LONG_EDGE = 1568` and `JPEG_QUALITY = 0.85` as constants near
  the top of the file with a comment pointing to
  `lib/optimizeImageForClaude.ts` so the two stay in sync. Browser JPEG
  encoder ≠ mozjpeg, but the dimensions and quality target match.

### 2. `lib/store.ts`

- `saveSelection` (lines 217-229): change the on-disk extension from
  `.png` to `.jpg`. Rename the parameter from `imagesPngBytes` to
  `imagesJpegBytes` for accuracy. Caller passes the JPEG bytes that came
  off the wire.
- `readSelectionImage` (lines 231-246): try `.jpg` first, then `.png`
  per-span, then legacy `${base}.png` for span 0. Keep the `Buffer`
  return; format detection happens at the call site.
- `deleteSelection` (lines 297-317): widen the directory filter to match
  `${selectionId}_*.{jpg,png}`. Also remove `${base}.jpg` alongside the
  existing `${base}.png` legacy cleanup.

### 3. `app/api/conversations/route.ts`

The body type at lines 27-34 already allows `imageMediaType` to be
`"image/png" | "image/jpeg"`. Two simplifications:

- The save path (lines 99-102) becomes a pass-through: incoming
  `body.spans[i].imageBase64` is already the optimized JPEG, so the
  `Buffer.from(..., "base64")` result is written straight to disk via
  `saveSelection`.
- The Claude-bound prompt spans (lines 134-137) no longer need
  `optimizePromptSpansForClaude` — the spans already have JPEG +
  `imageMediaType: "image/jpeg"`. Build the prompt spans directly from
  `body.spans`, dropping the `optimizePromptSpansForClaude` call and
  import. `optimizeAttachmentsForClaude` still runs on user attachments,
  which are independent.
- Light input validation: trust `body.spans[i].imageMediaType === "image/jpeg"`
  if provided; otherwise default to `"image/jpeg"` (the only format the
  client will ever send after this change). Reject `image/png` here, with
  a 400 error — keeps the server-side contract honest and surfaces any
  client/server skew during the rollout.

### 4. `app/api/conversations/[id]/messages/route.ts`

`loadSelectionAsPromptSpans` (lines 69-87) currently always calls
`optimizeImageForClaude` on the file bytes. Change to format-aware:

- Read bytes via `readSelectionImage` (unchanged).
- Sniff the first bytes: `b[0] === 0xff && b[1] === 0xd8` → JPEG; else
  PNG.
- JPEG: base64-encode the bytes verbatim, `imageMediaType: "image/jpeg"`.
- PNG (legacy fallback): run `optimizeImageForClaude` as today so old
  selections still get optimized for Claude.

This avoids re-encoding JPEG (which would be lossy and pointless) while
still optimizing legacy PNGs on the fly.

### 5. `app/api/conversations/[id]/route.ts`

The GET handler at lines 16-52 hardcodes `imageMediaType: "image/png"`
(line 43). Replace with format detection on the buffer's first bytes —
`"image/jpeg"` if JPEG, `"image/png"` otherwise — so the UI receives the
correct content-type for both new (JPEG) and legacy (PNG) selections.
The `PreviewBox` in `components/ConversationPanel.tsx:1975-2049` already
threads `imageMediaType` into the data URL, so no UI changes needed once
the type union from change (1) is in place.

### 6. `lib/optimizeImageForClaude.ts`

- Keep `optimizeImageForClaude` (still needed for the legacy PNG fallback
  in change (4) and inside `optimizeAttachmentsForClaude`).
- Keep `optimizeAttachmentsForClaude` (user attachments still arrive in
  arbitrary formats and need shrinking).
- Remove `optimizePromptSpansForClaude` (lines 35-48). It has no
  remaining callers after change (3).

## Critical files

- `components/SelectionOverlay.tsx` (lines 14-24, 587-598, 666-673)
- `lib/store.ts` (lines 217-246, 297-317)
- `lib/optimizeImageForClaude.ts` (remove `optimizePromptSpansForClaude`)
- `app/api/conversations/route.ts` (lines 99-102, 134-137; remove
  `optimizePromptSpansForClaude` import)
- `app/api/conversations/[id]/route.ts` (lines 24-48)
- `app/api/conversations/[id]/messages/route.ts` (lines 69-87)

## Verification

End-to-end manual test against `npm run dev`:

1. Open a PDF, drag-capture a region. In the composer preview (before
   submit), the image should already look like the compressed JPG that
   will hit Claude — visibly more compressed than the PDF render at the
   same zoom. Type a question and submit.
2. Check `data/books/<book>/selections/`: the new file is `<sel>_0.jpg`
   (not `.png`). `file …jpg` reports "JPEG image data".
3. Reload the conversation. The image rendered above the first user
   turn matches the pre-submit preview (same bytes round-tripping).
4. DevTools → Network on the conversation's GET endpoint:
   `capture.spans[0].imageMediaType === "image/jpeg"`.
5. Long-edge check: capture a very large region, inspect dimensions of
   the saved JPG — both edges should be ≤ 1568 px.
6. Legacy fallback: pick a book with pre-existing `.png` selection files
   from before this change. Reload an old conversation; image still
   renders. Ask a follow-up; it still gets sent to Claude (PNG optimized
   on read).
7. Delete a new conversation/selection. Confirm `.json` and `.jpg` are
   both removed. Delete a legacy one. Confirm `.json` and `.png` are
   both removed.

No automated tests exist for this path; verification is manual.
