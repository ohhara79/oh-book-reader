# Plan: Fix inline-math copy button

## Context

The first pass (commit `a599b41`) added per-block copy buttons for code, mermaid, SVG, display math, and inline math. Display/code/mermaid/SVG look fine, but the inline-math button looks broken in practice: it's a full-size 24×24 button positioned 24px above the math (`-top-6 right-0`), so it floats well above the line as a visually disconnected chip — see the user's screenshot of a heading like `## 2. Why the perpendicular piece has the form $B^\top y$`, where the button hangs above the heading like a stray icon.

This follow-up plan fixes only the inline-math case. Display math, code, mermaid, and SVG buttons are already shipped and untouched.

## Approach

Shrink the inline-math button and tuck it into the math's top-right corner instead of floating above. Two changes:

1. **`components/CopyButton.tsx`** — add a `size?: "sm" | "md"` prop (default `"md"`, current behavior). `"sm"` = `h-4 w-4` button with a 10×10 SVG icon. The existing `"md"` callers (per-message, code blocks, mermaid, SVG, display math) need no edits.

2. **`components/MathMarkdown.tsx`** — change `COPY_BTN_INLINE_CLS` from
   `absolute -top-6 right-0 …` (24px above, full size, prominent backdrop)
   to
   `absolute top-0 right-0 …` (top-right corner of the math, no protrusion above the line),
   and pass `size="sm"` when `MathCopyWrapper` is in the inline branch.

   Keep the hover-reveal classes (`opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100`). Drop `shadow-sm` and lighten the backdrop (e.g., `bg-white/70 dark:bg-zinc-800/70`) so the chip reads as part of the math rather than a separate UI surface. Display-math button keeps its existing styling.

Result: a 16×16 chip that overlays the top-right corner of the math glyph on hover. For a typical inline formula like `$B^\top y$` (~50px wide, ~25px tall), the chip occupies the top-right ~1/3 of the math while hovered — slightly obscures the top of `B` / superscript while visible, but disappears on click and on mouse-leave. For very short math like `$x$`, the chip mostly covers the math when hovered, but that's acceptable: hovering means the user already wants to copy.

## File-level changes

| File | Change |
|---|---|
| `components/CopyButton.tsx` | Add optional `size?: "sm" \| "md"` prop. `"sm"` → `h-4 w-4` button + `width=10 height=10` SVG icons. `"md"` is current behavior and the default. |
| `components/MathMarkdown.tsx` | Update `COPY_BTN_INLINE_CLS` to `absolute top-0 right-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 bg-white/70 dark:bg-zinc-800/70 backdrop-blur-sm rounded`. In `MathCopyWrapper`'s inline branch, pass `size="sm"` to `CopyButton`. Display-math branch unchanged. |

No new files. No changes to `MermaidDiagram.tsx` or `SvgBlock.tsx`.

## Risks

- **Occlusion on short math**: `$x$` etc. — chip covers most of the rendered glyph on hover. Acceptable: the chip is hover-only, and short inline math has minimal visual content to hide.
- **Superscript collision**: `B^T` extends near the inline-block top edge; the chip at `top-0 right-0` will overlay the top of the superscript while hovered. By design.
- **Heading on first line**: in headings near the top of a message bubble (the case from the screenshot), the chip is now strictly inside the math's bounding box, so it cannot extend above the bubble or get clipped by ancestor `overflow`.

## Verification

Start dev server. In an existing thread (or send a fresh message), include:

```markdown
## 2. Why the perpendicular piece has the form $B^\top y$

Inline math in the middle of a sentence: $E = mc^2$ should also work.

Single-letter case: $x$.
```

Verify:

1. Hovering each inline math reveals a small (~16×16) chip tucked into the math's top-right corner — no protrusion above the line.
2. Click → checkmark flashes for ~1.5s; pasting yields the LaTeX source (`B^\top y`, `E = mc^2`, `x`).
3. The chip disappears on mouse-leave; the math is fully visible again.
4. Display math (`$$…$$`), code blocks, mermaid, and SVG copy buttons are unchanged in size and behavior — no regression.
5. Touch emulation: chip visible without hover (via `[@media(hover:none)]`).

## Critical files

- `/home/ohhara/work/oh-book-reader/components/CopyButton.tsx`
- `/home/ohhara/work/oh-book-reader/components/MathMarkdown.tsx`
