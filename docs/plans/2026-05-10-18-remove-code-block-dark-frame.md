# Remove dark frame around code blocks

## Context

Code blocks render with a jarring dark navy frame around the white code area in light mode (see screenshot). The user confirmed it is unintentional and asked it be removed in both modes.

The frame is not an explicit border. It's the `<pre>` element's own background showing through its padding, while the inner `<code class="hljs">` paints itself with a different color from the highlight.js theme:

| Mode  | `<pre>` bg (Tailwind Typography `--tw-prose-pre-bg`) | `.hljs` bg (highlight.js theme) | Visual effect                          |
|-------|------------------------------------------------------|---------------------------------|----------------------------------------|
| Light | `#1e2939` (dark navy)                                | `#ffffff` (white, `github.css`) | Strong dark frame around white code    |
| Dark  | `#00000080` (50% black)                              | `#0d1117` (`github-dark.css`)   | Close shades — reads as one block      |

Goal: make the `<pre>` background match the highlight.js `.hljs` background in each mode so the frame disappears entirely. No padding/border changes needed — once the two backgrounds match, the seam vanishes.

## Change

**File:** `components/MathMarkdown.tsx:337-340` — the prose wrapper `<div>`.

Add `prose-pre` background overrides to the existing className:

```diff
- className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-snug prose-headings:my-2 prose-headings:leading-snug prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-snug"
+ className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-snug prose-headings:my-2 prose-headings:leading-snug prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-snug prose-pre:bg-white dark:prose-pre:bg-[#0d1117]"
```

- `prose-pre:bg-white` → light-mode `<pre>` becomes `#ffffff`, matching `github.css`'s `.hljs` background.
- `dark:prose-pre:bg-[#0d1117]` → dark-mode `<pre>` becomes `#0d1117`, matching `github-dark.css`'s `.hljs` background.

Both overrides take precedence over Typography's `--tw-prose-pre-bg` / `--tw-prose-invert-pre-bg` defaults. Dark mode is already media-query-driven (Tailwind v4 default + the `prefers-color-scheme` imports in `app/globals.css:2-3`), so the two stay in sync automatically.

Why edit the wrapper instead of the `<pre>` override at `components/MathMarkdown.tsx:216-238`? The wrapper already collects all prose-tuning modifiers (`prose-p:my-2`, `prose-headings:my-2`, etc.) — adding the bg override there keeps every prose-style decision in one place and avoids touching the `<pre>` component's logic, which is busy handling mermaid/svg routing and the copy button.

No changes to `app/globals.css` or to the highlight.js imports are needed.

## Verification

1. Restart the dev server (`npm run dev`) if running.
2. Open a thread containing a fenced code block (e.g. the Python `gradient_descent` example from the screenshot).
3. **Light mode** (`prefers-color-scheme: light` in OS or DevTools → Rendering → Emulate CSS): the dark navy frame should be gone; the code block should be a uniform white panel with the copy button at the top-right.
4. **Dark mode**: switch the OS / DevTools emulation. The block should still look like one cohesive dark panel — visually unchanged or very nearly so (going from `#00000080` over the page bg to a flat `#0d1117` is a small shift that aligns with the `.hljs` color).
5. Confirm syntax-highlight token colors are unaffected and the copy button still sits flush at the corner with no new gap.
6. Spot-check a code block inside a streaming response to make sure the `<pre>` override doesn't interfere with the streaming path (the `pre` component override at line 216 only special-cases mermaid/svg when `!streaming`; plain code blocks always render through the same `<pre>` element, so the bg class applies in both states).
