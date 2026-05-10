# Lift the SVG / mermaid copy icon to the diagram's top edge

## Context

The rendered-SVG copy icon (`SvgBlock.tsx:68`, class `COPY_BTN_CLS = "absolute right-1 top-1 …"`) sits 4px below the wrapper's top edge. The wrapping `<div class="relative group my-2">` has no padding, so the icon lands directly on the SVG content — visible in the user's screenshot, where the icon overlaps the upper-right region of an `iterations vs log(1/ε)` chart on top of a curve label.

`MermaidDiagram.tsx:91` uses an identical class (also `top-1 right-1`), so the same overlap can happen for tall mermaid diagrams.

User asks: lift the icon "like other copy icon, such as paragraph copy icon" — i.e., match the placement of `COPY_BTN_PROSE_BLOCK_CLS` (`components/MathMarkdown.tsx:152-153`), which centers the icon on the wrapper's top edge with `top-0 -translate-y-1/2`. This is also the placement now used by display-math (`COPY_BTN_MATH_DISPLAY_CLS`, `MathMarkdown.tsx:144-145`).

## Approach

In each of the two files (`SvgBlock.tsx` and `MermaidDiagram.tsx`), change the `COPY_BTN_CLS` constant from `top-1` to `top-0 -translate-y-1/2`. The new value:

```
absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100
```

Each file's constant is local — both files share the same name `COPY_BTN_CLS` but they're independent module-scoped constants. Applies to all three usages within each file (loading state, error state, rendered state). The loading/error states render `<pre><code>` fallbacks; lifting the icon for those is fine since the lifted icon still hovers near the top-right and matches the visual style of the prose-block / display-math affordances.

Keep the anonymous `group` / `group-hover:` pairing (the SVG and mermaid wrappers are anonymous `.group`, and after the prior commit `777a1bd` the prose-block wrappers are `group/prose` — so prose hovers no longer trigger these icons inappropriately).

## Files

- **`components/SvgBlock.tsx:6-7`** — change `top-1` → `top-0 -translate-y-1/2` in the `COPY_BTN_CLS` value.
- **`components/MermaidDiagram.tsx:6-7`** — change `top-1` → `top-0 -translate-y-1/2` in the `COPY_BTN_CLS` value.

## Verification

1. `npm run dev`, open a thread containing the SVG from the user's screenshot (an `iterations vs log(1/ε)` chart).
2. Hover the rendered SVG → copy icon now sits at the very top of the diagram, half above the SVG and half over its top edge — no longer overlapping the curve / labels.
3. Spot-check a mermaid diagram (any flow / sequence diagram) → icon sits at the diagram's top edge, same visual anchor.
4. Provoke the SVG/mermaid error state (e.g. malformed `<svg>` source) → icon still appears at the top of the `<details>` fallback's `<pre>`, lifted; reads cleanly because `<pre>` margins absorb the lift.
5. Regression check: code blocks (no SvgBlock/MermaidDiagram involved) keep `top-1 right-1` — unchanged.
