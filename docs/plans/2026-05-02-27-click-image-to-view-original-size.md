# Click image in conversation thread to view at original size

## Context

Conversation threads display images in two places:

- **Attachments** on Ask and Memo messages — rendered as 128px-tall thumbnails by `AttachmentStrip` (commit 91ef281).
- **Selected region** preview — rendered as 160px-tall thumbnails by `PreviewBox` (the amber/zinc box shown above the Ask form and inline with each user turn).

Neither had any click behavior. The user wants clicking any of these thumbnails to open the image at its **original (natural) pixel size** so fine detail (e.g., screenshots of code, math, or scanned page regions) is legible.

The underlying data is already a base64 data URL held in memory (`AttachedImage` from `lib/attachments.ts` for attachments; `imageBase64` + `imageMediaType` on each span for selections), so "original size" just means rendering the same `data:` URL with no size constraints. There is no separate higher-resolution source to fetch.

## Approach

Extract a single `ZoomableImage` component inside `components/ConversationPanel.tsx` and use it from both `AttachmentStrip` and `PreviewBox`. No new files, no new dependencies. Style mirrors the inline-modal pattern used by `components/SelectionOverlay.tsx` (state + Escape dismissal + Tailwind `fixed inset-0`).

## Changes

All edits happen in `components/ConversationPanel.tsx`.

### 1. New `ZoomableImage` component

Props: `{ src: string; alt: string; className?: string }`.

- Renders a `<button type="button">` (keyboard-activatable via Enter/Space) wrapping an `<img>` styled with the caller's `className`. Button styling is `cursor-zoom-in border-0 bg-transparent p-0` so the only visible change is the cursor; the image still shows the caller's existing border/rounded look.
- Local state `const [open, setOpen] = useState(false);`. Clicking the button opens; multiple `ZoomableImage` instances on the page each manage their own state, but only one can be open at a time because the open lightbox covers the screen.
- When `open`, renders a lightbox:
  - Outer container: `fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm print:hidden`. Full-screen, scrollable so an oversized image can be panned. `print:hidden` keeps it out of print output. `role="dialog" aria-modal="true"`.
  - Inner flex wrapper centers content when smaller than viewport but allows overflow: `flex min-h-full min-w-full items-center justify-center p-4`.
  - The preview `<img>`: `src={src}` with **no width/height/max-* classes** so the browser uses intrinsic dimensions — this is what delivers "original size".
  - `onClick` on the image calls `e.stopPropagation()` so clicking the image itself does not dismiss; clicking elsewhere on the backdrop closes via the outer `onClick={() => setOpen(false)}`.
  - Close button (`fixed right-2 top-2`), `aria-label="Close preview"`, with an × glyph.
- Dismissal effect gated on `open`:
  - `keydown` listener (capture): Escape → `setOpen(false)`, with `stopPropagation` so it does not also collapse other overlays.
  - Lock body scroll while open: `document.body.style.overflow = "hidden"`, restored on cleanup. Prevents the underlying thread from scrolling behind the lightbox.

### 2. Use `ZoomableImage` in `AttachmentStrip`

Replace the inline `<img>` with `<ZoomableImage>`, passing the existing `data:${a.media_type};base64,${a.data}` URL, `alt={"attachment " + (i + 1)}`, and the existing `max-h-32 rounded border …` classes as `className`.

### 3. Use `ZoomableImage` in `PreviewBox`

Replace the inline `<img>` rendered for each `capture.spans[i]` with `<ZoomableImage>`, passing `data:${s.imageMediaType};base64,${s.imageBase64}`, `alt={"selection page " + s.page}`, and the existing `max-h-40 rounded border …` classes.

## Critical files

- `components/ConversationPanel.tsx` — only file edited. Adds `ZoomableImage`; updates `AttachmentStrip` (around lines 1057–1072 pre-change) and `PreviewBox` (around lines 1015–1055 pre-change).
- `components/SelectionOverlay.tsx` — referenced for the dismissal pattern; not edited.
- `lib/attachments.ts` and `CapturedSelection` from `components/SelectionOverlay` — types already imported by `ConversationPanel.tsx`; not edited.

`AttachmentStrip` is invoked from `MessageBubble` for memo and user/ask messages; `PreviewBox` is rendered both as the live preview above the Ask form and inline with each user turn. All three sites gain the click-to-zoom behavior automatically.

## Verification

1. `npm run dev` and open a thread that has both image attachments and a multi-page selection.
2. Click an attachment thumbnail → lightbox opens; image is at natural pixel dimensions; if larger than viewport, the overlay scrolls.
3. Click a selection-region thumbnail (in both the live preview and an existing user turn) → same behavior.
4. Press Escape → closes. Click backdrop → closes. Click close button → closes. Click the image itself → stays open.
5. Tall image (taller than viewport) scrolls within the overlay; underlying thread does not scroll behind it.
6. Toggle dark mode and confirm appearance.
7. Print preview (Ctrl+P) — overlay must not appear.
8. `npx tsc --noEmit` passes.
