# Per-formula horizontal scroll for display math

## Context

In the conversation thread view, long display-math formulas (`$$ … $$`) are clipped horizontally and the user has no way to scroll the overflow into view. The panel-level scroller at `components/ConversationPanel.tsx:1538` is `overflow-auto`, but every wrapper between the formula and that scroller is a block-level element whose width is constrained by the bubble — none of them expands to the math's intrinsic width. So the scroller never sees content wider than itself and no horizontal scrollbar appears anywhere.

**Root cause.** rehype-katex emits `<span class="katex-display">` for `$$…$$`. The `span` override in `components/MathMarkdown.tsx:272-294` routes that through `MathCopyWrapper`, whose display branch (`MathMarkdown.tsx:200-207`) wraps it in a single `<span class="… relative group block">`. Neither that wrapper, nor the prose container at `MathMarkdown.tsx:378`, nor the message bubble in `components/ConversationPanel.tsx:2385-2390` has `overflow-x`. The formula simply overflows its containing block without expanding it, so the long math is visually clipped.

**Scope check.** `grep -rn katex-display` confirms `katex-display` is referenced only in `components/MathMarkdown.tsx` (the rehype tagger and the wrapper). No CSS override exists in `app/globals.css`. This is the only render path for display math.

## Approach

The standard math-rendering pattern: make each `.katex-display` block its own horizontal-scroll container so a scrollbar appears under *only* the formulas that overflow — not under prose, not at the bubble level, not at the panel level.

The naive version — `overflow-x-auto` on the existing wrapper — would scroll the copy button along with the math content (`position: absolute` children of an `overflow:auto` parent participate in the scrollable flow). To keep the button pinned to the visible right edge, split the wrapper in two: the **outer** span owns positioning (`relative group`) for the absolutely-positioned button, the **inner** span owns the math and the scroller. The button stays a sibling of — not a descendant of — the scrolling element.

`max-w-full` on the inner span is essential. Without an explicit width clamp, the inner `display: block` span would shrink-wrap to the math's intrinsic width and no overflow would ever be detected.

Both elements stay `<span>` to avoid `<div>`-inside-`<p>` HTML validity issues from remark-math's AST (display math nodes can land inside paragraph contexts).

KaTeX's default `.katex-display { margin: 1em 0 }` continues to live on the inner span via the inherited `className`, so vertical spacing around the formula is preserved. The copy button's vertical anchor (`top-0 -translate-y-1/2` of the outer) lands at the same visible position as before since the outer's top edge coincides with where the inner's margin starts.

Inline math (`$…$`, the `display={false}` branch of `MathCopyWrapper` at `MathMarkdown.tsx:208-217`) is untouched — it flows in text and has no overflow problem.

## Implementation

Single change in `components/MathMarkdown.tsx:200-207`. Replace:

```tsx
if (display) {
  return (
    <span ref={ref} className={`${className ?? ""} relative group block`}>
      {children}
      <CopyButton text={getLatex} title="Copy LaTeX" className={COPY_BTN_MATH_DISPLAY_CLS} />
    </span>
  );
}
```

with:

```tsx
if (display) {
  return (
    <span ref={ref} className="relative group block">
      <span className={`${className ?? ""} block overflow-x-auto max-w-full`}>
        {children}
      </span>
      <CopyButton text={getLatex} title="Copy LaTeX" className={COPY_BTN_MATH_DISPLAY_CLS} />
    </span>
  );
}
```

`ref` stays on the outer span; `getLatex` still finds the `annotation[encoding="application/x-tex"]` node because the KaTeX subtree remains a descendant. No other files change.

## Critical files

- `components/MathMarkdown.tsx:200-207` — split the display-math wrapper; outer holds `relative group block`, inner holds `katex-display block overflow-x-auto max-w-full`.

## Out of scope

- Making the *entire* conversation panel horizontally scrollable. That would let any wide content (long code lines, wide tables) reflow horizontally and was rejected because it shifts the reading layout for every message, not just the rare ones with overflowing math.
- Reformatting/breaking long formulas server-side. KaTeX has no general line-break support for display math, and rewriting the user's LaTeX is fragile.
- Inline math. The `display={false}` branch is untouched.

## Verification

Manual smoke test in the dev server (`npm run dev`):

1. **Reproduce the bug** — open a thread and paste an assistant message with a wide display formula:

   ```
   $$ \sum_{i=1}^{n} a_i x_i = b_1 x_1 + b_2 x_2 + b_3 x_3 + b_4 x_4 + b_5 x_5 + b_6 x_6 + b_7 x_7 + b_8 x_8 + b_9 x_9 + b_{10} x_{10} + \cdots + b_n x_n $$
   ```

   Expect:
   - A horizontal scrollbar appears **only under the formula**, not on the message bubble and not on the panel.
   - Scrolling the formula reveals the clipped right side.
   - The copy-LaTeX button is hover-revealed at the top-right of the **visible** area and does **not** move when the formula is scrolled horizontally.
   - Clicking copy yields the original LaTeX (annotation round-trip intact).

2. **Regression check** — short display formulas:
   - `$$E = mc^2$$` — no scrollbar (overflow-x-auto, not scroll).
   - `$$\int_0^1 f(x) \, dx$$` — no scrollbar; vertical spacing matches main.

3. **Surrounding prose** in the same bubble (paragraphs, lists, tables, code blocks) gets no horizontal scrollbar from this change.

4. **Inline math** (`$a^2+b^2=c^2$` in a sentence) — unchanged: no scrollbar, copy button still hover-revealed.

5. **Responsive resize** — drag the sidebar narrower/wider; the per-formula scrollbar appears/disappears as the formula's intrinsic width crosses the bubble's content width.

6. **Touch / `[@media(hover:none)]`** — the copy button is always visible on touch devices; confirm it stays pinned to the visible right edge while touch-scrolling the formula.

7. **No new console errors** while rendering.
