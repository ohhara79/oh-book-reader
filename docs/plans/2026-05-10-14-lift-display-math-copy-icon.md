# Lift the display-math copy icon to the top of the formula

## Context

The display-math copy icon (for `$$…$$` blocks) currently uses `COPY_BTN_BLOCK_CLS` which is `top-1 right-1` — the same class as code blocks. Inside `MathCopyWrapper`'s display branch the wrapper is `<span class="katex-display relative group block">`, and KaTeX's display layout adds visible vertical space inside the wrapper (the `.katex` element sits inside a block with line-height plus internal padding around tall structures like fractions). The result: with `top-1`, the icon visually sits well below the top of the formula — in the user's screenshot the icon appears next to the fraction line of `\mathrm{poly}(\log \tfrac{1}{\varepsilon})`, not at the formula's top.

User wants the display-math icon lifted, the way the inline-math icon already is — `COPY_BTN_INLINE_CLS` (`components/MathMarkdown.tsx:135-136`) anchors the inline icon's vertical center on the math wrapper's top edge with `top-0 -translate-y-1/2`. The display icon should match that vertical placement.

## Approach

Add a new class constant `COPY_BTN_MATH_DISPLAY_CLS` next to the other copy-button class constants in `components/MathMarkdown.tsx` (around line 132–144):

```
absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100
```

Same vertical anchor as inline math (icon center at wrapper top — half above the formula, half on top of it). Different horizontal anchor: inline math uses `left-full -translate-x-2` (icon hangs off the right of the inline span); display math is a full-width block, so anchor at `right-1` of the wrapper instead. Keep the anonymous `group-hover:` so it pairs with the existing `group` on the display-math wrapper.

Then swap `COPY_BTN_BLOCK_CLS` → `COPY_BTN_MATH_DISPLAY_CLS` in `MathCopyWrapper`'s display branch (`components/MathMarkdown.tsx:163`).

Code blocks (`<pre>` override) keep `COPY_BTN_BLOCK_CLS` as-is — their internal padding makes `top-1 right-1` look fine and the user hasn't reported them.

## Files

- **`components/MathMarkdown.tsx`** — sole file to edit. Two changes:
  1. Add the new `COPY_BTN_MATH_DISPLAY_CLS` constant near the existing `COPY_BTN_BLOCK_CLS` / `COPY_BTN_INLINE_CLS` / `COPY_BTN_PROSE_BLOCK_CLS` (line 132–144).
  2. In `MathCopyWrapper` line 163, change `className={COPY_BTN_BLOCK_CLS}` → `className={COPY_BTN_MATH_DISPLAY_CLS}`.

## Verification

1. `npm run dev`, open the thread that produced the screenshot (a `$$…$$` block containing `\mathrm{poly}\bigl(\log \tfrac{1}{\varepsilon}\bigr)`).
2. Hover the formula → copy icon now sits at the very top edge of the formula's wrapper, half above the math and half over its top — matching the inline-math icon's vertical anchor.
3. Click → LaTeX source on clipboard (existing behavior, no change to `getLatex` lookup).
4. Regression check: inline math icon unchanged (still `COPY_BTN_INLINE_CLS`), code-block icon unchanged (still `COPY_BTN_BLOCK_CLS`), prose-block icons unchanged.
5. Spot-check a tall display-math block (e.g. matrix or aligned environment) — icon should still pin to the wrapper's top edge regardless of formula height.
