# Plan: Remove translucent backdrop from all overlay copy buttons

## Context

After commit `d36f849` fixed the inline-math button rendering, the user noticed a styling asymmetry: the message-level copy button (top-right of each message bubble) renders bare — just the two-rectangles outline icon, no chip — while the overlay copy buttons (display math, inline math, code blocks, mermaid, SVG) all render with a translucent `bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm` chip behind the icon. The user prefers the bare style across the board.

User direction: **remove the backdrop from all copy buttons so they all match the bare message-level style.**

Trade-off the user is accepting: in dark mode the copy icon is light-gray and surrounding text is also light-gray, so when the inline-math button overlays mid-paragraph text (or when a button sits over a code block / mermaid / SVG corner that happens to contain content), the icon strokes may visually blend with what's behind them. User accepts this for visual consistency.

## Approach

Drop the `bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded` segment from every overlay copy button class string in three files. The `CopyButton` base already includes `rounded` (`components/CopyButton.tsx:43`), so removing the redundant `rounded` is fine. Other classes (`absolute`, positioning, `opacity-0 group-hover:opacity-100`, `focus-within:opacity-100`, `[@media(hover:none)]:opacity-100`) stay.

## File-level changes

| File | Change |
|---|---|
| `components/MathMarkdown.tsx` | Strip `bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded` from `COPY_BTN_BLOCK_CLS` (line 93-94) and `COPY_BTN_INLINE_CLS` (line 96-97). |
| `components/MermaidDiagram.tsx` | Strip the same trailing `bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded` from its local `COPY_BTN_CLS`. |
| `components/SvgBlock.tsx` | Strip the same trailing background classes from its local `COPY_BTN_CLS`. |

No structural changes. No new files. `CopyButton.tsx` is untouched — its base class already provides `rounded` and the standard hover color (`text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100`), which is what the message-level button has been using all along.

## Risks

- **Icon legibility over content**: the bare icon may blend into busy backgrounds — code-block code, mermaid SVG strokes, or (mid-paragraph) text glyphs in dark mode. User accepted this trade-off in favor of visual consistency.
- **Hover-color contrast**: `CopyButton`'s hover state (`hover:text-zinc-900 dark:hover:text-zinc-100`) provides some contrast feedback — when the user puts the cursor on the icon, it darkens (light mode) or brightens (dark mode), so even without a chip there's a visual cue that it's interactive.

## Verification

Start dev server. In a thread, hover each block type:

1. **Code block** — copy icon appears top-right with no chip; visible against the code background.
2. **Display math `$$…$$`** — copy icon appears top-right with no chip.
3. **Inline math `$x$`** — copy icon appears just to the right of the math, no chip; verify the icon doesn't visually merge with surrounding text glyphs (it might, slightly — that's the accepted trade-off).
4. **Mermaid diagram** — copy icon appears top-right, no chip.
5. **SVG diagram** — copy icon appears top-right, no chip.
6. **Message-level copy button (top-right of bubble)** — unchanged, bare as before.

Also verify in both light and dark mode (system theme switch).

## Critical files

- `/home/ohhara/work/oh-book-reader/components/MathMarkdown.tsx`
- `/home/ohhara/work/oh-book-reader/components/MermaidDiagram.tsx`
- `/home/ohhara/work/oh-book-reader/components/SvgBlock.tsx`
- `/home/ohhara/work/oh-book-reader/components/CopyButton.tsx` (reference only — base classes already correct)
