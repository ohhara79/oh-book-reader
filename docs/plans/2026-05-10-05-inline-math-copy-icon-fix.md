# Plan: Move inline-math copy button outside the `.katex` CSS scope

## Context

Two prior commits attempted to place a copy button on inline math:

- `a599b41` — full-size button floating 24px above the math; looked like a stray icon disconnected from the formula.
- `a622484` — shrunk to a 16×16 chip at the math's top-right corner. User screenshot shows two real problems:
  1. The chip sits on top of the math glyph (`E` in `(V, E)`) — should overlay surrounding text instead.
  2. The icon doesn't render as the two-rectangles copy glyph; it shows as a solid blob.

**Root cause for problem 2** (confirmed by reading `node_modules/katex/dist/katex.css:1067-1088`):

```css
.katex svg {
  display: block;
  position: absolute;
  width: 100%;
  height: inherit;
  fill: currentColor;
  stroke: currentColor;
}
```

KaTeX forces `fill: currentColor`, `width: 100%`, and `position: absolute` on every `<svg>` inside `.katex`. The current inline-math wrapper is itself the `<span class="katex">` (we kept the original class on the wrapping element), so the copy button's SVG is a descendant of `.katex` — the CSS rules apply, fill the rectangles, stretch the SVG to 100%, and break the copy glyph.

The display-math button doesn't have this problem because it sits inside `<span class="katex-display">` *but outside* the inner `<span class="katex">` — `.katex svg` doesn't match it.

User direction (problem 1): **button should overlay surrounding text, not the math.** Place it just to the right of the math, on the same baseline, at the default `md` size so the icon reads clearly.

## Approach

One file. Two coupled fixes in `components/MathMarkdown.tsx`:

1. **Restructure `MathCopyWrapper`'s inline branch so the button is outside `.katex`'s CSS scope.** Today the wrapper renders one span (`<span class="katex relative inline-block group">{children}<CopyButton/></span>`). Change it to a plain outer wrapper with the original `katex`-classed span nested inside as a sibling of the button:

   ```tsx
   <span ref={ref} className="relative inline-block group align-baseline">
     <span className={className ?? ""}>{children}</span>  {/* original katex span */}
     <CopyButton … />                                      {/* sibling of .katex */}
   </span>
   ```

   Now `.katex svg` no longer matches the button's SVG. The `getLatex` ref still works because `querySelector` traverses all descendants regardless of structure.

2. **Reposition the inline button to the right of the math, vertically centered, at default `md` size.** Update `COPY_BTN_INLINE_CLS` to `absolute top-1/2 left-full -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded`. Drop the `size="sm"` prop on the inline `CopyButton` call so it uses the default `md` (24×24 button, 14×14 icon).

No hover flicker: the button is a DOM descendant of the wrapping span, so CSS `:hover` on the wrapper stays true while the cursor is on the button (hover propagates to ancestors). The cursor moves from the math (inside the inner katex span) to the button (sibling, positioned at `left: 100%`) — both still have the outer wrapper as an ancestor.

Display math, code blocks, mermaid, and SVG paths are unchanged.

## File-level changes

| File | Change |
|---|---|
| `components/MathMarkdown.tsx` | (a) In `MathCopyWrapper`'s inline branch, render `<span ref relative inline-block group><span class={original katex}>{children}</span><CopyButton/></span>` instead of putting the button as a sibling of `{children}` inside the same span. (b) Update `COPY_BTN_INLINE_CLS` to `absolute top-1/2 left-full -translate-y-1/2 …`. (c) Remove `size="sm"` from the inline `CopyButton` call. Display-math branch unchanged. |

No other files touched. `CopyButton`'s `size` prop added in `a622484` stays — keeping the API; just no caller for `"sm"` after this change.

## Risks

- **End-of-line math**: button at `left-full` extends past the math's right edge. For math at the visual end of a line (e.g., heading text), the button protrudes into the message bubble's right padding (`p-2` = 8px). On a wide bubble it's fine; on a narrow one it may clip at the bubble edge. Acceptable for a hover-only affordance.
- **Mid-paragraph math**: button overlays the next inline content (space or text) on hover. By design.
- **Vertical alignment**: `top-1/2 -translate-y-1/2` centers in the wrapper's content box, which equals the inner katex span's height. Adding `align-baseline` on the outer span keeps the wrapper aligned to the surrounding text baseline so the inline-block doesn't shift the line.

## Verification

Start dev server. In an existing thread, find inline math like:

1. `Given an undirected graph $G = (V, E)$ with weights …` — hover the math; the chip appears just to the right of `)`, overlaying the space + start of "with". The copy glyph (two rectangles, outlined, transparent fill) is clearly recognizable. Math is fully visible. Click → checkmark; paste yields `G = (V, E)`.
2. `## Why the form $B^\top y$` — hover; chip protrudes slightly past the math's right edge. Math fully visible.
3. `$x$` — chip to the right of `x`. Math visible.

Also verify:

- Copy icon matches the message-level copy button's appearance (two-rectangles outlined glyph, no fill).
- Touch emulation: button visible without hover.
- Display math `$$…$$`, code blocks, mermaid, SVG copy buttons unchanged.

## Critical files

- `/home/ohhara/work/oh-book-reader/components/MathMarkdown.tsx`
- `node_modules/katex/dist/katex.css:1067-1088` (reference for the CSS rules being escaped)
