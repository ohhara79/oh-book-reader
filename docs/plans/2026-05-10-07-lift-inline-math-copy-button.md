# Move inline-math copy button above the text baseline

## Context

In conversation thread view, hovering over inline math reveals a copy-LaTeX button. The button is currently positioned with `top-1/2 left-full -translate-y-1/2`, i.e. vertically centered with the math expression and placed just to the right of it. Because inline math typically renders taller than the surrounding text, the math's mid-line aligns roughly with the baseline x-height of the text that follows, so the icon overlaps the next word on the same line (visible in the screenshot covering "an" after `a = Bg,`).

The user wants the icon nudged upward so it no longer covers neighboring text on the same line.

## Change

Single CSS-class adjustment in `components/MathMarkdown.tsx:96-97`:

- File: `components/MathMarkdown.tsx`
- Constant: `COPY_BTN_INLINE_CLS`
- Before: `"absolute top-1/2 left-full -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`
- After:  `"absolute bottom-full left-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`

`bottom-full` anchors the button's bottom edge to the math wrapper's top edge, so the icon sits entirely above the math instead of overlapping the surrounding line. Math expressions typically have line-height headroom above them, so this won't push the icon off-screen for inline math in the thread view.

The block-math button (`COPY_BTN_BLOCK_CLS`) is unchanged — it already lives in the top-right corner of the block.

## Verification

1. Start the dev server (`npm run dev`) and open a conversation thread that includes inline math followed by text on the same line (e.g. `a = Bg, and ...`).
2. Hover over the inline math and confirm:
   - The copy icon appears just above the math, not overlapping the trailing text.
   - Clicking the icon still copies the LaTeX source (logic in `MathCopyWrapper` / `CopyButton` is untouched).
3. Confirm block-math copy button still renders in the top-right corner as before.
4. Quick check on a thread where inline math appears at the start of a line — the icon should still be visible (above the line of math) and not clipped.
