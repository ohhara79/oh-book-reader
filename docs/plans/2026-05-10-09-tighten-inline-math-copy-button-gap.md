# Tighten horizontal gap between inline math and copy button

## Context

Vertical position of the inline-math copy button is now correct (commit `d3bbd5b`, `top-0 -translate-y-1/2`). User reports a small but visible horizontal gap between the math expression's right edge and the copy icon (screenshot: gap between `ε⁻¹` and the copy icon, before the trailing `: ite…`).

Source of the gap:

- The button is positioned with `left-full`, which places the *button's left edge* — not the icon's left edge — at the math wrapper's right edge.
- The copy icon is a 14px SVG centered inside a 24px (`h-6 w-6`) flex box (`components/CopyButton.tsx:18,69-81`), so there's ~5px of empty space between the button's left edge and the icon's left edge.
- KaTeX may also render a small right margin/space on inline math, contributing another few px.

The user wants the icon visually adjacent to (or slightly overlapping) the math, with little or no gap.

## Change

Add a horizontal translate to pull the button left, in `components/MathMarkdown.tsx:96-97`:

- File: `components/MathMarkdown.tsx`
- Constant: `COPY_BTN_INLINE_CLS`
- Before: `"absolute top-0 left-full -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`
- After:  `"absolute top-0 left-full -translate-y-1/2 -translate-x-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`

`-translate-x-2` shifts the button 8px to the left — enough to absorb the button's ~5px internal left padding plus typical KaTeX right margin, so the icon sits visually flush with the right edge of the math. Tailwind composes both translates (`-translate-y-1/2 -translate-x-2`) into a single transform automatically.

If 8px ends up too aggressive (icon overlaps math content), drop to `-translate-x-1.5` (6px); if still too gappy, bump to `-translate-x-2.5` (10px). The user can iterate from there.

Block math (`COPY_BTN_BLOCK_CLS`) and the `MathCopyWrapper` structure are unchanged.

## Verification

1. Start the dev server (`npm run dev`) and open a thread containing inline math (e.g. the `ε⁻¹: iter…` example from the screenshot).
2. Hover over the inline math and confirm:
   - The copy icon sits visually adjacent to the math's right edge with no noticeable gap.
   - The icon does not visibly overlap the math glyph itself.
   - Vertical position is unchanged (still centered on math wrapper's top edge).
   - Clicking the icon still copies the LaTeX source.
3. Confirm block-math copy button is unaffected (still in top-right corner of the block).
