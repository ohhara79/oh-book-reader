# Disable monospace font ligatures globally

## Context

In the conversation thread view, SQL code blocks render `>=` as the single ligature glyph `≥` (and similarly `<=`, `!=`, `->`, `=>` get visually transformed). The user noticed this and asked whether it's intentional or a bug.

**Diagnosis:** the underlying text is unchanged — it's purely a font ligature. Geist Mono (loaded via `next/font/google` in `app/layout.tsx:12-15` and exposed as Tailwind's `font-mono` via `app/globals.css:15`) ships with OpenType `liga` and `calt` features enabled by default. Nothing in the app explicitly enables or disables them, so the browser applies the font's defaults. Copy-paste is unaffected — only the rendered glyph is replaced.

**User's call:** disable ligatures everywhere monospace text appears (code blocks, text-attachment previews, any `font-mono` element). This makes code read as written, which is preferred for SQL/code that gets discussed and quoted across contexts.

## Change

Add one CSS rule to `app/globals.css` that disables ligatures on the standard monospace elements and on Tailwind's `.font-mono` utility. Use `font-variant-ligatures: none` (modern, fully supported) as the primary property and pair it with `font-feature-settings: "liga" 0, "calt" 0` for belt-and-suspenders coverage of older WebKit text engines.

### File: `app/globals.css`

Append after the existing `body { … }` block (around line 29), before the `.react-pdf__Page__textContent` rule:

```css
/* Geist Mono enables `liga`/`calt` by default, which renders `>=` as `≥`,
   `!=` as `≠`, `->` as `→`, etc. We want code to read literally. */
code, pre, kbd, samp, .font-mono {
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
}
```

That's it. No component changes — the rule applies wherever monospace text is rendered:

- Markdown code blocks via `rehype-highlight` in `components/MathMarkdown.tsx:24` (these are `<pre><code>` elements, covered by the `code, pre` selectors).
- Text-attachment preview `<pre>` blocks in `components/ConversationPanel.tsx`.
- Any future `font-mono` usage.

## Verification

1. Run the dev server: `npm run dev`.
2. Open a conversation thread containing a SQL code block (or any code with `>=`, `<=`, `!=`, `->`, `=>`, `==`).
3. Confirm the operators now render as their literal two-character forms, not as ligature glyphs.
4. Sanity-check both light and dark modes (the rule is theme-agnostic, but eyeball it).
5. Spot-check a text attachment preview if one is available — confirm same behavior.
6. Copy a snippet from a code block and paste into a plain-text editor — text should be unchanged (this was already true; just confirming nothing broke).

## Critical files

- `app/globals.css` — only file modified.
- `app/layout.tsx:12-15` — reference, no change (font loading).
- `components/MathMarkdown.tsx:24,234,338` — reference, no change (markdown/code renderer).
