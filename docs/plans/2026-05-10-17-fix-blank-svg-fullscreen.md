# Plan: fix blank SVG fullscreen lightbox

## Context

Shipped in commit `57ac882`: click-to-fullscreen for SVG / mermaid / markdown img using a shared `ZoomableBlock` with `react-zoom-pan-pinch`. PNG and mermaid work as expected in both light and dark mode. **SVG fullscreen renders blank** in both modes — clicking the diagram opens the overlay but no diagram is visible.

### Root cause

AI-generated SVGs (verified by grepping `data/books/*/conversations/*.json`) consistently look like:

```html
<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg"> … </svg>
```

— a `viewBox` and no `width`/`height` attributes. Per the SVG spec, missing `width`/`height` default to `100%` of the containing block.

- **Inline view (works):** SvgBlock's trigger button has class `flex justify-center w-full max-w-full overflow-x-auto … [&_svg]:max-w-full [&_svg]:h-auto`. The button has an explicit width (`w-full` of the conversation bubble), so the SVG's implicit `width: 100%` resolves to the bubble width and `[&_svg]:h-auto` lets the height follow via `viewBox` aspect ratio. The diagram is visible.
- **Lightbox view (blank):** in `components/ZoomableBlock.tsx:99-103`, the inner content `<div>` is rendered as `<div className={contentClassName} dangerouslySetInnerHTML={{ __html: html }} />` and SvgBlock passes **no `contentClassName`**. The div has no explicit width and is itself a flex item inside `flex h-full w-full items-center justify-center`, so its width is content-based — and the SVG's `width: 100%` of nothing resolves to 0. The SVG renders at 0×0. Blank.

PNG works because `<img>` carries intrinsic pixel dimensions. Mermaid works because the mermaid library writes explicit `width`/`height` attributes into its SVG output.

## Approach

The fix is one line at the SvgBlock call site: pass a `contentClassName` to `ZoomableBlock` that gives the inner `<div>` an explicit viewport-relative size and forces the SVG to fill it. `ZoomableBlock` itself, the trigger styling, and the inline rendering are unchanged.

### Change

In `components/SvgBlock.tsx:65-69`:

```tsx
<ZoomableBlock
  label="SVG diagram"
  triggerClassName="flex justify-center w-full max-w-full overflow-x-auto bg-transparent border-0 p-0 text-left [&_svg]:max-w-full [&_svg]:h-auto"
  contentClassName="w-[90vw] h-[90vh] [&_svg]:w-full [&_svg]:h-full"
  html={state.html}
/>
```

What each part of `contentClassName` does:

- `w-[90vw] h-[90vh]` — gives the lightbox content `<div>` an explicit viewport-relative size, breaking the chicken-and-egg sizing loop. 90/90 leaves a small margin so the close button and backdrop are visible at the edges.
- `[&_svg]:w-full [&_svg]:h-full` — force any descendant SVG to fill the sized `<div>` regardless of whether it has explicit `width`/`height` or implicit `100%`. The SVG's `preserveAspectRatio` (default `xMidYMid meet`) preserves its aspect ratio inside that box, letterboxing as needed. This is deterministic across all the SVG variants the AI generates.

### Why not also overhaul `[&_svg]:h-auto` / `w-auto`

Tempting alternative: set `w-auto h-auto` so the SVG renders at its `viewBox`-natural pixel size. But that's browser-dependent for `viewBox`-only SVGs (Chrome and Firefox disagree on what "auto" resolves to without an intrinsic size), and the result on small SVGs is a tiny diagram floating in a viewport-sized backdrop. Forcing `w-full h-full` is consistent and gives the user a usefully large initial view; `react-zoom-pan-pinch` (already in `ZoomableBlock`) lets them zoom out (`minScale: 0.5`) or in (`maxScale: 8`) from there.

## Critical files

- `components/SvgBlock.tsx` — add the one `contentClassName` prop on the `ZoomableBlock` call.

No other files need to change. `ZoomableBlock`, `MathMarkdown`, `MermaidDiagram`, and `ConversationPanel` keep their current behavior — only SVG content gets the new sizing wrapper.

## Verification

1. **Build:** `npm run build` succeeds with no new TS/lint errors.
2. **Reproduce the bug first** (against current `main`): open a thread with a `language-svg` block, click the diagram → lightbox shows blank backdrop. This confirms the failure mode the user reported.
3. **After the fix:**
   - Click the same SVG → lightbox shows the diagram, sized to fill ~90vw × 90vh, aspect-preserving (letterboxed if the SVG aspect doesn't match the viewport).
   - Wheel-zoom in toward cursor; click-drag pans; double-click resets; Esc and × close.
   - Repeat in dark mode — content rendering should be identical (it's the same SVG, no dark-specific styling involved).
4. **Regression check:** mermaid lightbox, PNG attachment lightbox, markdown image lightbox, and selection-region lightbox all still behave as before — the change is scoped to SvgBlock.
5. **Edge SVG shapes worth eyeballing if the user has them:** an SVG with explicit pixel `width`/`height` (e.g. `width="500" height="300"`) — `[&_svg]:w-full [&_svg]:h-full` will scale it up to fill the box, which is the desired fullscreen behavior; if the user prefers natural-size rendering for such SVGs, we'd revisit, but this is unlikely to be an issue given the AI's output pattern observed in `data/books/`.
