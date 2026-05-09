# Image-style answers in the thread view

## Context

The conversation thread renders Claude's output through `MathMarkdown` (react-markdown + remark-gfm + remark-math + rehype-katex). Two things are missing for Claude to "answer with an image":

1. **Mermaid is already wired** (`components/MathMarkdown.tsx:45-47` routes ```` ```mermaid ```` fences to `components/MermaidDiagram.tsx`), but the system prompt in `lib/claude.ts:10-22` never tells Claude that mermaid is available, so Claude almost never volunteers a diagram.
2. **SVG is not supported.** `rehype-raw` is not loaded, so raw `<svg>` is stripped, and there is no fenced-block hook for ```` ```svg ````. SVG is the right complement to mermaid for things mermaid can't express well — geometry, math figures, free-form sketches, anything custom.

Goal: enable Claude to answer with diagrams when it helps. Two changes — one is a prompt tweak, one is a small renderer addition that mirrors the existing mermaid hook. Raster/PNG output is explicitly out of scope (would require a Claude Agent SDK tool, sandboxed image generation, file storage; significantly larger).

## Changes

### 1. Add an SVG fenced-block renderer

Mirror the mermaid pattern.

**New file: `components/SvgBlock.tsx`** (client component)
- Accepts `code: string`.
- Sanitizes the SVG source with DOMPurify using the SVG profile: `DOMPurify.sanitize(code, { USE_PROFILES: { svg: true, svgFilters: true } })`. This strips `<script>`, event handlers, external refs, etc.
- Renders the sanitized markup via `dangerouslySetInnerHTML` inside a wrapper `<div>` styled `max-w-full overflow-x-auto` so wide diagrams scroll instead of breaking the panel layout.
- `useMemo` the sanitized output keyed on `code` so we don't re-sanitize on every render.

**Edit: `components/MathMarkdown.tsx`**
- Extend the existing `pre` component override (already detects `language-mermaid` at lines 38-50) to also detect `language-svg` and route to `<SvgBlock code={src} />`. Keep the same `&& !streaming` gate so we don't try to render half-streamed SVG.
- Import `SvgBlock` next to the existing `MermaidDiagram` import (line 9).

**`package.json`**
- Add `dompurify` (runtime) and `@types/dompurify` (dev). Plain `dompurify` is fine — `MathMarkdown` is `"use client"` (top of file) and `SvgBlock` will be too, so this only runs in the browser. No need for `isomorphic-dompurify`.

### 2. Tell Claude about mermaid and SVG in the system prompt

**Edit: `lib/claude.ts:10-22`** — append to `SYSTEM_PROMPT`:

> When a diagram would meaningfully help the answer (geometry, flows, hierarchies, sequences, structures), use a fenced code block: ```` ```mermaid ```` for flowcharts/sequence/state/ER diagrams, or ```` ```svg ```` for free-form figures (geometry, math figures, custom drawings). For SVG, use `currentColor` for strokes and text so the diagram adapts to light/dark mode, set a `viewBox`, and omit fixed pixel dimensions when possible. Don't add diagrams when prose suffices.

Keep it terse — the existing prompt is already lean. The "don't add diagrams when prose suffices" line is important so Claude doesn't reach for a diagram on every question.

## Critical files

- `components/MathMarkdown.tsx` — extend the `pre` override (lines 36-53).
- `components/SvgBlock.tsx` — new file, ~20 lines, mirrors `components/MermaidDiagram.tsx` shape.
- `lib/claude.ts` — append to `SYSTEM_PROMPT` (lines 10-22).
- `package.json` — add `dompurify` + `@types/dompurify`.

## Reused pieces

- `components/MermaidDiagram.tsx` — pattern to copy for `SvgBlock` (client component, source-keyed memo, gracefully handles bad input).
- The existing `streaming` flag plumbed through `MathMarkdown` — reuse it to gate SVG rendering on a complete code block.

## Verification

1. **Type-check + build**: `npm run build` (Next 16 app router; should pass with no new warnings).
2. **Mermaid prompt path** (no code change, just prompt): start the dev server (`npm run dev`), open a book, ask a question that benefits from a flowchart (e.g. "summarize the steps in this algorithm as a flowchart"). Confirm Claude emits a ```` ```mermaid ```` block and `MermaidDiagram` renders it.
3. **SVG renderer**: ask a geometry-style question or "draw an SVG diagram of …". Confirm the response renders as an inline SVG (not a code block) and scales sensibly in the panel. Toggle the OS/browser dark mode to confirm `currentColor` strokes follow the theme.
4. **Sanitizer XSS check**: in a thread, manually paste an assistant-style message containing ```` ```svg <svg onload="alert(1)"><script>alert(1)</script></svg> ```` (or temporarily seed one in the conversation JSON under `data/books/<id>/conversations/`). Reload the thread. The script tag and `onload` must be stripped; nothing should fire.
5. **Streaming**: while a response is mid-stream, the partial SVG/Mermaid block should stay as a code box (no half-rendered diagram flashing). Once the stream finishes, it should swap to the rendered diagram.
6. **Export**: the thread export path (`lib/exportConversation.ts`) treats the response as text — confirm exported transcripts still contain the raw fenced blocks so they round-trip.
