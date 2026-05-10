# Add block-level copy buttons for paragraphs, blockquotes, tables, and lists

## Context

The thread view already has copy buttons for content where mouse-selection is awkward or yields a wrong format: code blocks, display/inline math, mermaid, SVG, plus full-message copy on every bubble and PDF selection-region copy. There is no copy affordance for prose-level blocks.

The biggest practical gap is **tables** — mouse-selecting a rendered HTML table doesn't yield clean markdown or TSV. Paragraph, blockquote, and list copy are convenience wins (the user explicitly opted into all four). All new buttons should copy the **original markdown source** (matching how code-block and message-level copy already behave).

This change is additive: no existing copy affordance changes behavior; only new component overrides are added in `components/MathMarkdown.tsx`.

## Approach

Reuse the existing pattern (`<div class="relative group">` wrapper + `CopyButton` positioned top-right with `COPY_BTN_BLOCK_CLS` for hover-revealed visibility), and obtain the original markdown source by slicing `normalizedText` using `node.position.start.offset` / `node.position.end.offset` — remark preserves these offsets by default.

To avoid stacked, redundant buttons (e.g., a `<p>` inside a `<blockquote>` would otherwise render its own copy button on top of the blockquote's), add a small rehype plugin modeled on the existing `rehypeMarkMathBlocks` (`components/MathMarkdown.tsx:42-79`) that tags only the **outermost** copyable block of each kind. Component overrides only render a copy button when that tag is present.

Granularity decisions:
- `<table>`: per-table copy (entire markdown table, including header/separator rows).
- `<blockquote>`: per-blockquote copy.
- `<ul>` / `<ol>`: per-list copy (entire list). No per-`<li>` button — matches the table-level granularity and keeps button density low.
- `<p>`: per-paragraph copy, but only when the paragraph is **not** inside a `<blockquote>`, `<li>`, `<table>`, or another already-copyable container.

Format: copy the raw markdown source (sliced from `normalizedText`). This is what remark received, so it round-trips cleanly.

Streaming: `node.position` is present on partially-parsed trees. The button will copy whatever source has streamed so far — acceptable, since the same is already true of code-block copy.

## Files

- **`components/MathMarkdown.tsx`** — sole file to edit. Add:
  1. A new `rehypeMarkCopyableBlocks` rehype plugin (alongside `rehypeMarkMathBlocks` at line 42), tagging the outermost `p`, `blockquote`, `table`, `ul`, `ol` with a `dataCopyable` attribute set to its kind. The walker tracks an `inCopyable` flag and, once inside any tagged ancestor, does not tag descendants of copyable types.
  2. Wire it into the `rehypePlugins` array (line 22-26), after `rehypeKatex` and before/after `rehypeMarkMathBlocks` (order doesn't matter since they tag disjoint elements).
  3. New component overrides for `p`, `blockquote`, `table`, `ul`, `ol` in the `components` map (line 143-193). Each override:
     - Reads `node?.properties?.dataCopyable` — if absent, returns the element unmodified.
     - If present, computes the source as `normalizedText.slice(node.position.start.offset, node.position.end.offset)` (with a guard for missing offsets).
     - Wraps the original element in `<div class="relative group">` (or `<span class="relative inline-block group">` if the element is inline-only — none of these are, so `<div>` is fine for all five).
     - Adds a `CopyButton` with `text={() => source}`, an appropriate `title` ("Copy paragraph", "Copy quote", "Copy table", "Copy list"), and `className={COPY_BTN_BLOCK_CLS}`.
  4. The `components` `useMemo` dep array (line 192) needs `normalizedText` added so overrides re-bind when the source text changes.

No changes to other files. `CopyButton` (`components/CopyButton.tsx`) and the `COPY_BTN_BLOCK_CLS` constant (`components/MathMarkdown.tsx:93-94`) are reused as-is.

## Reused utilities

- `CopyButton` (`components/CopyButton.tsx:12`) — already supports `text` as a function.
- `COPY_BTN_BLOCK_CLS` (`components/MathMarkdown.tsx:93`) — same hover-revealed positioning used by code/mermaid/svg/display-math.
- `rehypeMarkMathBlocks` walker pattern (`components/MathMarkdown.tsx:42-79`) — template for the new `rehypeMarkCopyableBlocks` plugin.

## Verification

End-to-end manual test (no automated tests cover the markdown renderer):

1. `npm run dev`, open a book, open a thread that includes — or send a question whose response includes — each of: paragraph, blockquote, GFM table, ordered list, unordered list. (A reliable prompt: "Reply with one paragraph of prose, one blockquote, one markdown table with 2 columns and 2 rows, one bulleted list with 3 items, and one numbered list with 3 items.")
2. Hover each block → copy button appears top-right; click → checkmark feedback; paste into a scratch buffer → confirm the markdown source matches the original.
3. Verify nested cases produce one button, not two:
   - Paragraph inside a blockquote → only the blockquote shows a button.
   - Paragraph inside a list item → only the list shows a button.
4. Regression check existing copy affordances still work: inline math, display math, fenced code, mermaid, svg, full-message copy in the bubble header.
5. Streaming: send a long response; while it's streaming, hover a completed paragraph mid-stream → button appears and copies the partial-but-complete paragraph source.
6. Print preview / `print:hidden` — copy buttons should not appear in print (already handled by `CopyButton`'s `print:hidden` class).
