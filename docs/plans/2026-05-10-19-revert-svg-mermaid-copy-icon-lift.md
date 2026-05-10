# Revert commit 19b5c91 (SVG / mermaid copy icon top-edge anchor)

## Context

Commit `19b5c91` ("Lift SVG and mermaid copy icon to the diagram's top edge") changed the copy-button positioning in `SvgBlock.tsx` and `MermaidDiagram.tsx` from `top-1` (4px below the wrapper top) to `top-0 -translate-y-1/2` (centered on the wrapper's top edge, half hovering above the diagram).

The user reports that the lifted icon now sometimes looks **too far** from the SVG / mermaid content — the half-above-the-edge placement leaves a visible gap on diagrams whose content doesn't reach the wrapper's top edge. Reverting to `top-1` puts the icon back inside the wrapper, snug to the top-right corner.

The original concern (icon overlapping a curve label on a tall figure) is accepted as a lesser evil than the now-too-distant placement.

## Changes

Revert only the two CSS-class edits from `19b5c91`. Later commits (`57ac882`, `1617c2f`) added `ZoomableBlock` rendering inside both files but did **not** touch `COPY_BTN_CLS`, so the revert is conflict-free.

### `components/MermaidDiagram.tsx:7-8`

```diff
 const COPY_BTN_CLS =
-  "absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";
+  "absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";
```

### `components/SvgBlock.tsx:7-8`

```diff
 const COPY_BTN_CLS =
-  "absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";
+  "absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";
```

## Files left untouched

- `docs/plans/2026-05-10-15-lift-svg-mermaid-copy-icon.md` — kept as historical record. The revert is documented here as a follow-up plan rather than by deleting the original.

## Verification

1. `npm run dev`, open a thread containing an SVG and a mermaid diagram.
2. Hover each → copy icon now sits 4px below the diagram's top edge, near the right corner — no longer floating half-above the wrapper.
3. Cross-check the prose-block and display-math copy icons (`MathMarkdown.tsx`) — they should still use the lifted `top-0 -translate-y-1/2` placement; only SVG / mermaid revert.
