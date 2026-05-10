# Lift prose-block copy buttons above the first line of text

## Context

Commit `751e072` added copy buttons for `<p>`, `<blockquote>`, `<table>`, `<ul>`, `<ol>` in the thread view. Each is absolutely positioned at `top-1 right-1` inside a wrapping `<div class="relative group">`. Unlike `<pre>` (code blocks), which have internal padding that gives the button room, these prose blocks have no top padding — so the icon visually overlaps the first line of text. The user reported this for paragraphs in particular (screenshot: copy icon covers "(like" at the right edge of the first line).

Goal: lift the icon clear of the block's text, matching the pattern recently established for the inline-math copy button (commits `ff3684b` "Lift inline-math copy button above the surrounding line", `d3bbd5b` "Lower inline-math copy button to math's top edge", `5ba361d` "Close the gap between inline math and its copy button").

## Approach

Add a new `COPY_BTN_PROSE_BLOCK_CLS` constant alongside the existing `COPY_BTN_BLOCK_CLS` / `COPY_BTN_INLINE_CLS` (in `components/MathMarkdown.tsx:132-136`). The new class anchors the icon so its bottom edge sits at the wrapper's top edge:

```
absolute right-1 bottom-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100
```

`bottom-full` puts the icon entirely above the prose-block content, removing the overlap with first-line text. The icon will extend roughly 16px into the prose-margin gap above (8px from `prose-p:my-2` etc.) plus a few px into the previous block — that's hover-only, rendered with low-contrast `text-zinc-500`, and matches how the inline-math button overlaps the line above its formula.

Apply the new class to **all five prose-block overrides**: `<p>`, `<blockquote>`, `<table>`, `<ul>`, `<ol>`. They share the same geometry (text reaches the top edge of the wrapper), so the same lift fixes all of them in one shot.

The `<pre>` (code block), Mermaid, and SVG copy buttons keep the existing `COPY_BTN_BLOCK_CLS` — their content has internal padding, so the icon doesn't sit on text and the current `top-1 right-1` placement still reads cleanly.

## Files

- **`components/MathMarkdown.tsx`** — sole file to edit.
  1. Add `COPY_BTN_PROSE_BLOCK_CLS` constant after the existing `COPY_BTN_INLINE_CLS` (around line 135–136).
  2. In each of the five prose-block overrides (`p`, `blockquote`, `table`, `ul`, `ol`, around line 244–293), change `className={COPY_BTN_BLOCK_CLS}` → `className={COPY_BTN_PROSE_BLOCK_CLS}`.

No other files change.

## Reused utilities

- `CopyButton` (`components/CopyButton.tsx`) — unchanged.
- `COPY_BTN_INLINE_CLS` (`components/MathMarkdown.tsx:135-136`) — template for the new class (same opacity / group-hover / focus / hover-none modifiers).

## Verification

1. `npm run dev`, open the thread from the user's screenshot (paragraph response with bolded terms and inline math `\varepsilon`, `\mathrm{poly}(\varepsilon^{-1})`).
2. Hover the paragraph → copy icon appears **above** the first line, no longer covering "(like" or any other text. Click → markdown source on clipboard.
3. Spot-check a blockquote, a markdown table, an ordered list, an unordered list (a one-shot prompt: "Reply with a paragraph, a blockquote, a 2x2 markdown table, a numbered list of 3, and a bulleted list of 3"). Each copy icon should sit above its block, not over its first line / header row / first item.
4. Regression check: code-block (`<pre>`), mermaid, svg, display-math, inline-math, and full-message copy buttons all keep their current placement.
5. Visual: brief overlap of the lifted icon with the previous block on hover is expected and acceptable, mirroring inline-math's overlap with the line above its formula. If the user wants something subtler later, swap `bottom-full` for a smaller offset like `-top-3`.
