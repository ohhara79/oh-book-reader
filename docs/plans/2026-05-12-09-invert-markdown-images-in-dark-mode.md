# Fix: invert markdown images in dark mode (follow attachment convention)

## Context

The previous commit (`50f55f1`) made `<MathMarkdown>` render `data:image/…`
URIs instead of stripping them. With images now actually showing up, a second
issue surfaces: in dark mode, the **inline** image (the thumbnail that sits in
the prose) renders at its native brightness, while every other image in the
app — selection previews and attachment thumbnails — is color-inverted to
match the dark UI.

The attachment / selection-preview convention is in
`components/ConversationPanel.tsx`:

- `PreviewBox` (line 2114-2118) and `AttachmentStrip` (line 2169-2174) hand
  `ZoomableImage` a `className` that includes
  `dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]`.
- `ZoomableImage` (line 2137-2161) puts that className **on the inline
  trigger `<img>`** (line 2153), and separately sets
  `contentClassName="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"`
  on `ZoomableBlock` so the lightbox wrapper inverts as well.

In `components/MathMarkdown.tsx:282-300`, the `img` override mirrors that
ZoomableBlock setup for the **lightbox** side (line 289 sets the same
`contentClassName`), but the inline trigger `<img>` at line 292 has no
className, so it stays un-inverted in dark mode. The user wants markdown
images to follow the same dark-mode convention as the attachment / selection-
preview path.

## Fix

In the `img` override of `components/MathMarkdown.tsx` (line 282-300), add the
inline-image dark/print filter to the trigger `<img>` so the inline thumbnail
inverts in dark mode the same way `ZoomableImage` does. The lightbox side is
already handled by `contentClassName` on line 289 — leave that alone.

The new trigger becomes:

```tsx
trigger={
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={src}
    alt={alt ?? ""}
    {...rest}
    className="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
  />
}
```

`className` is placed **after** `{...rest}` so the filter can't be silently
dropped by a hast property that happens to set className. (In practice
markdown image syntax `![alt](src)` never carries className, but the ordering
is defensive and matches no functional cost.)

We intentionally do **not** add `max-h-32 rounded border …` here. Attachments
size themselves to fit a strip; markdown-rendered images live inside `.prose`
flow and should keep their natural width/aspect — adding a fixed max-height
would shrink figures the assistant intends to show full-width.

## Critical files

- `components/MathMarkdown.tsx` — single change at the trigger `<img>` inside
  the `img` component override (line 292).

No other files need to change. `ZoomableBlock` already supports the convention
(it's what `ZoomableImage` is built on), and the lightbox side already has the
filter via `contentClassName`.

## Verification

1. `npm run dev`. Open a thread, paste a `![alt](data:image/png;base64,…)`
   markdown image into the composer (the selection-copy markdown produced by
   the `PreviewBox` copy button at
   `components/ConversationPanel.tsx:2101` works for this), toggle preview on
   via the eye icon at line 1952.
2. With OS / app set to **dark mode**, confirm the inline preview image is
   color-inverted, matching the thumbnails rendered by `AttachmentStrip` and
   `PreviewBox` directly above/below it.
3. Click the inline image to open the lightbox. It should also appear
   inverted in dark mode (no regression — this was already working via
   `contentClassName`).
4. Switch to **light mode** (or invert the OS scheme). The inline image
   should render with its original colors (the `dark:` variant only kicks in
   under `dark` class).
5. **Print regression** check: open the browser print preview while a
   markdown image is on screen. The `print:[filter:none]` modifier should
   strip the inversion so printed output matches the original artwork.
