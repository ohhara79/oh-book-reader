# Add image download affordance in conversation thread view

## Context

In the conversation thread view, three kinds of images can appear in messages:

1. **Captured region images** — PDF selection screenshots, rendered via `ZoomableImage` in `components/ConversationPanel.tsx:2114`.
2. **Attachment images** — user-uploaded images, rendered via `ZoomableImage` in `AttachmentStrip` (`components/ConversationPanel.tsx:2169`).
3. **Markdown-embedded images** — `![alt](data: or http)` inside assistant/user markdown, rendered via the `img` override in `components/MathMarkdown.tsx:282`.

All three funnel through `components/ZoomableBlock.tsx`, which wraps the image in an interactive `<button>` (trigger) and a click-to-close `<div>` (lightbox). Both wrappers apply `[&_*]:pointer-events-none` (lines 46–47) so the whole region is clickable for zoom. The side effect: right-clicking the image hits the wrapper, not the `<img>`, so the browser offers "Save link as…" (HTML) instead of "Save image as…". There is currently no download button anywhere.

Outcome: add a single download button to the `ZoomableBlock` lightbox toolbar so the user can save any of the three image types after opening it at full size.

## Approach

Add an optional download affordance to `ZoomableBlock`. When the consumer passes a downloadable source, the lightbox shows a download icon next to the × button. Filename comes from the existing `label`/`alt` text (already plumbed through every call site), extension is derived from the data: URI MIME type or URL path.

### Files to modify

- **`components/ZoomableBlock.tsx`** — extend `Props` and add the button.
  - Add optional `downloadSrc?: string` prop (the actual image URL or data URI to download; distinct from `trigger`/`content` so we don't have to infer it from React children).
  - In the lightbox `<div>` (currently lines 70–117), render a second fixed-position button to the left of the × at `right-12 top-2`, with an aria-label like `Download ${label}`. Use a small inline SVG (download arrow) styled like the close button.
  - On click: build a filename from `label` (slugify: lowercase, non-alphanumerics → `-`, collapse repeats, trim; fall back to `image`). Derive extension from `downloadSrc`:
    - Data URI: parse the MIME type after `data:` up to `;` and map `image/png`→`png`, `image/jpeg`→`jpg`, `image/webp`→`webp`, `image/gif`→`gif`, `image/svg+xml`→`svg`; else `bin`.
    - HTTP URL: use the path extension if recognized, else `png`.
  - Trigger download via a transient `<a href={downloadSrc} download={filename}>` appended to `document.body`, clicked, and removed. Data URIs work natively with the `download` attribute in all modern browsers; same-origin URLs and blob: URLs also work. Cross-origin URLs will open in a new tab — acceptable since in this app images are always data: URIs in practice.
  - Stop propagation on the button's click so it doesn't bubble into the lightbox close handler.
  - Add the existing pointer-events neutralization carve-out: the new button must sit outside `[&_*]:pointer-events-none` containers (the close button already sits at the lightbox root level for this reason — mirror that placement).

- **`components/ConversationPanel.tsx`** — pass `downloadSrc` through the local `ZoomableImage` helper.
  - `ZoomableImage` (line 2137) already receives `src` and `alt`. Forward `src` as `downloadSrc` to `ZoomableBlock`. No change needed at the two call sites (captures at line 2114, attachments at line 2169) — they already pass meaningful `alt` text (`selection page N`, `attachment N`).

- **`components/MathMarkdown.tsx`** — pass `downloadSrc` from the `img` renderer (line 282) to `ZoomableBlock`. The `src` and `alt` are already in scope.

### Why not other approaches considered

- Removing `pointer-events-none` to make right-click work natively: breaks the "click anywhere on the image to zoom/close" UX and the click-to-pan behavior inside `TransformComponent`. The explicit button is clearer and doesn't depend on users knowing about the browser context menu.
- A hover overlay on inline thumbnails: rejected per the user's preference — lightbox-only keeps the inline rendering uncluttered.
- Adding a download endpoint or filesystem-aware naming: unnecessary. All three image types are already in-memory data URIs by the time they reach the component, so `<a download>` handles it without a server round-trip.

### Filename examples

- Captured selection on page 12 → label `selection page 12` → `selection-page-12.png`
- Attachment #1 (PNG) → label `attachment 1` → `attachment-1.png`
- Markdown image with alt `Figure 3 results chart` → `figure-3-results-chart.png`
- Markdown image with empty alt → falls back to `image.png`

## Verification

1. `npm run dev` (Next.js 16, React 19).
2. Open a book with an existing thread that contains a captured region; click the image to open the lightbox; click the new download button; confirm a PNG with the slugified page-N filename lands in the downloads folder and opens correctly.
3. In the composer, attach an image (PNG and JPEG), send it, then download it from the thread via the lightbox; confirm the extension matches the original MIME.
4. Ask Claude something that returns a markdown image (or paste a data-URI markdown image into a memo) and verify the download button appears in the lightbox and produces a usable file.
5. Dark mode sanity check: the lightbox already inverts colors for the *display* via `dark:[filter:invert(1)_hue-rotate(180deg)]` on `contentClassName` — confirm the downloaded file is the **original** (uninverted) image. Since `downloadSrc` is the raw `src` (not the filtered DOM), this should be automatic, but verify by eye.
6. Keyboard: confirm Escape still closes the lightbox and that focus on the download button doesn't swallow Escape.

## Critical files

- `components/ZoomableBlock.tsx` (primary change)
- `components/ConversationPanel.tsx:2137-2161` (ZoomableImage wrapper)
- `components/MathMarkdown.tsx:282-304` (markdown img renderer)
