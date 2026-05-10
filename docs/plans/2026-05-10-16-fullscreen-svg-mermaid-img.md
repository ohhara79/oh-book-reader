# Plan: click-to-fullscreen for SVG, mermaid, and markdown images

## Context

In conversation thread view, SVG, mermaid, and `<img>` content sometimes renders too small or too large because intrinsic dimensions vary wildly between sources. Auto-resizing in-place is hard to get right (any single rule misbehaves on a counter-example: e.g. `w-full` would make legitimately small icons balloon).

The existing PNG attachments already have a click-to-fullscreen overlay (`ZoomableImage` in `components/ConversationPanel.tsx:2024`). The proposed change extends that pattern to SVG and mermaid blocks, and to markdown-embedded images, and adds zoom + pan inside the overlay so users can read details on any size content. Mobile pinch-zoom must work without separate gesture code, so we add `react-zoom-pan-pinch` for a unified desktop/mobile implementation.

In-place sizing is intentionally left unchanged — fullscreen is the answer for awkward sizing.

## Approach

### 1. Add dependency

- `npm install react-zoom-pan-pinch` (≈9 KB gzipped, supports React 19, handles wheel-zoom, pinch-zoom, drag-pan, bounds, momentum out of the box).

### Dark-mode handling (cross-cutting)

Guiding principle: the lightbox is a *zoomed view* of the inline rendering. Whatever the user sees inline in their conversation bubble — including any dark-mode treatment — they should see at larger size in the overlay, with no extra wrappers, panels, or recolouring imposed by the lightbox itself. Inline rendering is already legible in both color schemes; fullscreen inherits that legibility by mirroring it exactly.

Concrete rules:

- **Backdrop and close button must adapt to the color scheme.** The existing PNG lightbox uses a fixed `bg-black/80` backdrop and a white close button. That's wrong for the goal here: in light mode it makes content sit on a dark surface that does *not* match the inline conversation bubble, so e.g. a dark-line SVG becomes hard to read against black even though it reads fine inline. New backdrop: `bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm`. New close button: `bg-zinc-900/90 text-white dark:bg-white/90 dark:text-zinc-900`. This makes the overlay feel like a zoomed conversation surface in either mode.
- **Content inside the lightbox renders identically to inline** — no extra filters or wrappers added by `ZoomableBlock`. PNG keeps its existing `dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]` (passed in by the call site, used both inline and in fullscreen). SVG renders raw, the same as inline (no white panel). Mermaid renders raw — its `theme: prefers-dark ? "dark" : "default"` at `MermaidDiagram.tsx:44` already adapts both inline and fullscreen.
- **PNG fullscreen behavior changes slightly:** the backdrop is no longer always black. This is intentional and aligns with the "mirror inline" principle — photos look fine against a near-white surface in light mode just as they look fine against the conversation bubble.

So `ZoomableBlock` is unopinionated about content; it only owns the overlay chrome (backdrop, close button, transform behavior) and exposes per-call-site styling for trigger and lightbox content:

```tsx
type Props = {
  label: string;
  triggerClassName?: string;  // styling for the inline trigger button
  contentClassName?: string;  // styling for the lightbox content wrapper
  children?: ReactNode;
  html?: string;
};
```

Call sites:
- `ZoomableImage` (PNG, markdown img): `triggerClassName` carries the inline size/border/dark-filter classes from `ConversationPanel.tsx:2005,2104` (preserved verbatim); `contentClassName="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"` so the filter still applies in fullscreen. No size constraint in fullscreen — `react-zoom-pan-pinch` handles scaling.
- `SvgBlock`: `triggerClassName="flex justify-center max-w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"` (matches current inline at `SvgBlock.tsx:65`); `contentClassName` omitted so the SVG renders at natural size in fullscreen.
- `MermaidDiagram`: `triggerClassName="flex justify-center"` (matches current at `MermaidDiagram.tsx:88`); `contentClassName` omitted.

### 2. Extract a shared `ZoomableBlock`

Create `components/ZoomableBlock.tsx`. One export, one job: render a clickable trigger that opens a fullscreen lightbox with zoom/pan inside.

API:

```tsx
type Props = {
  label: string;             // for aria-label on trigger and dialog
  triggerClassName?: string; // applied to the trigger element
  // The trigger and the lightbox content are the same node, rendered twice.
  // For HTML-string content (SVG/mermaid) pass `html` instead of children.
  children?: ReactNode;
  html?: string;
};
```

Behavior (lifts the structure of the existing `ZoomableImage` at `components/ConversationPanel.tsx:2024-2092`, with chrome updated for color-scheme awareness — see Dark-mode handling above):
- Trigger: a `<button type="button">` with `cursor-zoom-in` and `triggerClassName`. Renders `children` or `dangerouslySetInnerHTML`. Buttons can validly contain phrasing content (`<img>`, `<svg>`); for HTML strings we put `dangerouslySetInnerHTML` directly on the button so the only descendant is `<svg>`.
- Overlay state managed locally with `useState`. On open: lock `document.body.style.overflow`, register Esc handler with `capture: true` (matches existing pattern at `ConversationPanel.tsx:2043`).
- Overlay JSX: `fixed inset-0 z-50 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm print:hidden`, dialog/aria-modal, click-backdrop closes, top-right `×` close button styled `bg-zinc-900/90 text-white dark:bg-white/90 dark:text-zinc-900` so it stays visible on either backdrop.
- Inside the overlay, wrap content in `TransformWrapper` + `TransformComponent` from `react-zoom-pan-pinch` with: `minScale={0.5}`, `maxScale={8}`, `centerOnInit`, `wheel={{ smoothStep: 0.005 }}`, `doubleClick={{ mode: "reset" }}`, `panning={{ velocityDisabled: false }}`. The library handles pinch-zoom on mobile and wheel-zoom + drag on desktop with one code path.
- One subtlety: clicks on the zoomable content must not bubble to the backdrop close-handler. Wrap the `TransformWrapper` in a div with `onClick={(e) => e.stopPropagation()}` (mirrors `ConversationPanel.tsx:2084`).
- `contentClassName` is applied to a wrapper div inside `TransformComponent` (or directly via `dangerouslySetInnerHTML` if `html` is used). `ZoomableBlock` adds no other styling to content — this is what enforces "lightbox mirrors inline".

### 3. Refactor `ZoomableImage`

`ZoomableImage` in `ConversationPanel.tsx:2024` becomes a thin wrapper that delegates to `ZoomableBlock`, passing an `<img>` as children and forwarding `src` / `alt` / `className`. This keeps existing call sites (`ConversationPanel.tsx:2002`, `:2100`) working unchanged and folds zoom/pan into PNG attachments and selection-region previews "for free".

### 4. Wire SVG and mermaid

`components/SvgBlock.tsx` — current render path (lines 62-70):

```tsx
<div className="relative group my-2">
  <div className="flex justify-center max-w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
       dangerouslySetInnerHTML={{ __html: state.html }} />
  <CopyButton ... />
</div>
```

becomes:

```tsx
<div className="relative group my-2">
  <ZoomableBlock
    label="SVG diagram"
    triggerClassName="flex justify-center max-w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto bg-transparent border-0 p-0 w-full"
    html={state.html}
  />
  <CopyButton ... />
</div>
```

The outer `relative group` is preserved so the existing copy-button positioning and `group-hover` behavior are unchanged. No `contentClassName` — the SVG renders raw inside the lightbox, identical to inline, and the color-scheme-aware backdrop ensures legibility in both modes.

`components/MermaidDiagram.tsx` (lines 85-93) gets the same treatment with `label="Mermaid diagram"` and `triggerClassName="flex justify-center"`. Mermaid's own light/dark theme handles content legibility in both modes, both inline and in the lightbox.

### 5. Markdown images

In `components/MathMarkdown.tsx`, add an `img` override to the `components` map (alongside the existing `pre`, `span`, `p`, etc., around lines 214-310):

```tsx
img({ node, src, alt, ...rest }) {
  if (!src) return null;
  return (
    <ZoomableBlock
      label={alt || "Image"}
      triggerClassName="cursor-zoom-in inline-block"
      contentClassName="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt ?? ""} {...rest} />
    </ZoomableBlock>
  );
},
```

Note `src` from react-markdown can be `string | Blob` in newer versions — narrow to string. The `contentClassName` carries the dark-mode invert filter inside the lightbox, matching the existing PNG attachment pattern.

## Critical files

- `components/ZoomableBlock.tsx` — new, the shared lightbox
- `components/SvgBlock.tsx` — wrap render branch
- `components/MermaidDiagram.tsx` — wrap render branch
- `components/ConversationPanel.tsx` — refactor `ZoomableImage` (lines 2024-2092) into a thin wrapper
- `components/MathMarkdown.tsx` — add `img` override (around lines 214-310)
- `package.json` — add `react-zoom-pan-pinch`

## Out of scope

- Inline (non-fullscreen) sizing changes — left as-is per discussion.
- A toolbar with explicit +/-/reset buttons — relying on gestures (wheel/pinch/drag) plus double-click to reset (built into `react-zoom-pan-pinch`).
- Loading-state and error-state branches in `SvgBlock` / `MermaidDiagram` — those show source code as `<pre>`, no need for fullscreen there.

## Verification

1. **Build & types:** `npm run build` succeeds; no new TS errors in the touched files.
2. **Desktop interactive (Chrome/Firefox, `npm run dev`):**
   - Open a thread containing a mermaid block, an SVG block, an inline markdown image, a PNG attachment, and a selection-region image.
   - Click each → fullscreen overlay opens; Esc closes; backdrop click closes; × button closes.
   - In overlay: scroll wheel zooms in/out toward cursor; click-and-drag pans; double-click resets.
   - Body scroll is locked while overlay is open and restored on close.
   - Copy buttons on SVG/mermaid still appear on hover and copy source unchanged.
3. **Mobile (Chrome devtools mobile emulation + a real device if available):**
   - Tap each → overlay opens; pinch-zoom and one-finger drag-pan work; tap backdrop closes.
4. **Dark mode:** toggle OS color scheme (or devtools "Emulate prefers-color-scheme: dark") and re-run the interactive checks. The contract is: **content inside the lightbox should look like a zoomed copy of the inline rendering, in either mode.**
   - Backdrop is light in light mode, dark in dark mode. Close button stays visible against either backdrop.
   - PNGs and markdown images: same dark-mode filter applies inline and in the lightbox; the visual is consistent.
   - SVG: renders identically inline and in the lightbox; legible in both modes against the matching backdrop (no white panel inserted).
   - Mermaid: re-renders with the dark theme (light text/lines on a dark background) both inline and inside the lightbox; light theme inline matches light theme in the lightbox.
5. **Print preview:** overlay is hidden in print (`print:hidden` on the overlay).
6. **Edge cases:**
   - SVG/mermaid that fails to render (error branch) still shows source `<pre>` without a fullscreen wrapper.
   - Streaming AI response: mermaid/SVG only render when `streaming === false` (existing behavior at `MathMarkdown.tsx:222,226`); fullscreen wrapper only appears once rendered.
   - Markdown image with no `src` → renders nothing (guarded above).
