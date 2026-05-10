# Scope the prose-block hover group so it doesn't reveal inner math/code buttons

## Context

The user reports that hovering a paragraph reveals every inline-math copy icon inside it — not just the paragraph's own copy icon. This is a real bug, not intentional.

Cause: Tailwind's `group-hover:` utility (in its anonymous form) translates to `.group:hover .group-hover\:opacity-100`. Every component that wants a hover-revealed copy icon currently uses anonymous `group` on its wrapper and anonymous `group-hover:` on its button:

- prose-block wrappers (`<p>`, `<blockquote>`, `<table>`, `<ul>`, `<ol>` — `components/MathMarkdown.tsx:256,266,276,286,296`): `<div class="relative group">`, button uses `COPY_BTN_PROSE_BLOCK_CLS` (line 144) with `group-hover:opacity-100`.
- `MathCopyWrapper` (display + inline math, `components/MathMarkdown.tsx:161,168`): `group`, button uses `COPY_BTN_BLOCK_CLS` / `COPY_BTN_INLINE_CLS` with `group-hover:opacity-100`.
- code-block wrapper in the `<pre>` override (`components/MathMarkdown.tsx:223`): `group`, button uses `COPY_BTN_BLOCK_CLS`.

When inline math is rendered inside a paragraph, the paragraph wrapper is an *ancestor* of every math copy button. CSS `:hover` is true on every ancestor under the cursor, so hovering anywhere in the paragraph makes the paragraph wrapper match `.group:hover`, and every descendant `.group-hover\:opacity-100` (including all inline-math copy buttons) reveals.

Goal: hovering the paragraph reveals **only** the paragraph's own button. Hovering a specific inline-math reveals that one math's button (and the paragraph's, since the paragraph is under the cursor too — that's fine). Other inline maths in the same paragraph stay hidden until the cursor reaches them.

## Approach

Switch the prose-block wrappers and their copy button from Tailwind's *anonymous* `group` to a *named* group `group/prose`. Named groups generate a different CSS class (`group\/prose`), so an anonymous `group-hover:` on a math/code button won't match the prose wrapper anymore — the cascade is broken.

Concrete changes (all in `components/MathMarkdown.tsx`):

1. In `COPY_BTN_PROSE_BLOCK_CLS` (line 142–144), change `group-hover:opacity-100` → `group-hover/prose:opacity-100`. Keep `focus-within:opacity-100` and `[@media(hover:none)]:opacity-100` as-is.
2. In each of the five prose-block override wrappers (lines 256, 266, 276, 286, 296), change `<div className="relative group">` → `<div className="relative group/prose">`.

Math (`MathCopyWrapper`), code (`<pre>` wrapper), `MermaidDiagram`, and `SvgBlock` keep their existing anonymous `group` / `group-hover:` — they don't need to change because:
- Math and code wrappers are no longer ancestors of *each other* through a prose `group` (the prose `group` is now `group/prose`, which doesn't match anonymous `group-hover:`).
- Math and code don't nest inside each other in practice.
- The user only reported the prose → math cascade, and this minimal change fixes it.

## Files

- **`components/MathMarkdown.tsx`** — sole file to edit. Two text changes:
  1. Constant value at line 142–144.
  2. Six (actually five) wrapper className strings at lines 256, 266, 276, 286, 296.

## Verification

1. `npm run dev`, open a thread containing the paragraph from the user's screenshot (heading "paragraph" then a paragraph with `\varepsilon` and `\mathrm{poly}(\varepsilon^{-1})`).
2. Hover over plain prose text in the paragraph (away from any math). Expect: paragraph copy icon visible at top-right; **no** inline-math copy icons visible.
3. Hover over the `\varepsilon` glyph specifically. Expect: that math's copy icon visible AND paragraph copy icon visible. The other math's icon (`poly(\varepsilon^{-1})`) stays hidden.
4. Hover the second math. Expect: only that math's icon plus paragraph icon. The first math's icon hidden.
5. Regression: code blocks, mermaid, svg, display math — hovering each still reveals its own copy icon as before. Hovering an unrelated paragraph does not reveal a code block / mermaid / svg button (those use anonymous `group-hover:` and the paragraph wrapper is no longer an anonymous `.group`).
6. Keyboard nav: tabbing focus to any copy button still makes it visible (the `focus-within:opacity-100` class is unchanged).
