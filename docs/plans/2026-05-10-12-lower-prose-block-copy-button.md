# Lower the prose-block copy icon back down a touch

## Context

Commit `9138877` lifted the prose-block copy buttons (paragraph, blockquote, table, list) by switching `COPY_BTN_PROSE_BLOCK_CLS` from `top-1 right-1` to `bottom-full right-1`. With `bottom-full`, the icon's bottom edge sits at the wrapper's top edge — which means a 24-px-tall icon extends fully above the wrapper. The collapsed prose margin between blocks is only ~8px, so the icon ends up overlapping the *previous* block. The user's screenshot shows this clearly: when the previous block is a heading ("paragraph"), the icon visually aligns with the heading text instead of the gap, looking detached from the paragraph it actually belongs to.

Goal: bring the icon back down so it visually belongs to its block (sits right at the top edge of the block) without the heading-overlap problem and without the original first-line-text-coverage problem.

## Approach

Change `COPY_BTN_PROSE_BLOCK_CLS` (`components/MathMarkdown.tsx:142-143`) from:

```
absolute right-1 bottom-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100
```

to:

```
absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100
```

`top-0 -translate-y-1/2` anchors the icon's vertical center on the wrapper's top edge — half above, half on the first line. Geometry:
- Icon (24px) spans y=-12 to y=+12 within the wrapper.
- Above: only 12px protrusion into the prose gap, leaving roughly half of the icon clear of the previous block (which now barely touches it instead of covering its body).
- Below: 12px overlap with the *top* of the first line — the ascender / leading area, not the cap-body where letterforms live. Reads as "icon hovering at the very top of the block" rather than "icon sitting on the sentence".

This matches the placement style already used for inline math (`COPY_BTN_INLINE_CLS`, `components/MathMarkdown.tsx:135-136`), which uses the same `top-0 -translate-y-1/2` pattern, so the prose-block icon will feel consistent with the math-icon affordance.

Apply to all five prose-block overrides via the shared constant — no per-override changes needed since they all reference `COPY_BTN_PROSE_BLOCK_CLS`.

## Files

- **`components/MathMarkdown.tsx`** — sole file to edit. Replace the value of `COPY_BTN_PROSE_BLOCK_CLS` at line 142–143. The five usages at lines 257, 267, 277, 287, 297 don't need changing.

## Verification

1. `npm run dev`, open the same screenshot scenario: a heading immediately followed by a paragraph that contains the inline-math `\varepsilon` etc.
2. Hover the paragraph → icon now sits right at the top-right corner of the paragraph block, half above and half over the first line's ascender area. It should no longer visually align with the heading text above.
3. Confirm the icon does not block the cap-body of any first-line word (small overlap with ascender/leading area is expected and acceptable).
4. Spot-check blockquote / table / list — same placement, no heading-style overlap with previous block.
5. Regression check: code, mermaid, svg, display-math, inline-math, full-message copy buttons unchanged.
