# Syntax highlighting for thread-view code blocks

## Context

In the conversation thread view, fenced code blocks render as plain `<pre>`/`<code>` with no syntax highlighting. `components/MathMarkdown.tsx` (the renderer used by `components/ConversationPanel.tsx`) wires `react-markdown` with `remark-gfm`, `remark-math`, and `rehype-katex`, but no highlighter is in the chain — and no highlighter library is installed (`package.json:11-28`).

The only special-case branches in the existing `pre` override (lines 39–55) detect ```` ```mermaid ```` and ```` ```svg ```` and route them to `MermaidDiagram` / `SvgBlock`. Everything else falls through to a bare `<pre>{children}</pre>` (line 54).

Goal: highlight regular fenced code blocks (js, ts, python, etc.) without disturbing the existing mermaid/svg renderers, math rendering, or streaming behavior.

## Approach

Add `rehype-highlight` (highlight.js-backed) to the existing rehype pipeline. This is the smallest change that fits the pattern already in use — same kind of plugin slot as `rehype-katex`, no component-tree restructuring needed. Pair it with two CSS themes (`github.css` light, `github-dark.css` dark) switched via `prefers-color-scheme`, matching how the rest of the app handles light/dark (`app/globals.css:16-21`, `MermaidDiagram.tsx:10-30`).

## Changes

### 1. `package.json` — add deps

- `rehype-highlight` `^7` (runtime)
- `highlight.js` `^11` (runtime — needed for the CSS theme imports; the JS path goes through `lowlight` which `rehype-highlight` brings in)

### 2. `components/MathMarkdown.tsx` — plug the plugin in

Import and register `rehypeHighlight` **before** `rehypeKatex` in the `rehypePlugins` array (line 13). The two don't conflict — katex transforms math nodes, highlight transforms `<pre><code class="language-*">` — but ordering highlight first is the conventional unified placement.

```ts
import rehypeHighlight from "rehype-highlight";
// ...
const rehypePlugins = [
  [rehypeHighlight, {
    detect: true,                  // auto-detect for fences w/o a lang tag (v7 default)
    plainText: ["mermaid", "svg"], // leave these for our pre override to handle
    ignoreMissing: true,           // unknown lang -> render plain, don't throw
  }],
  rehypeKatex,
];
```

`plainText: ["mermaid", "svg"]` is the load-bearing option: it makes `rehype-highlight` skip those two languages entirely so the inner `<code>` keeps its single string child. The existing source extraction in the `pre` override (`String(childEl?.props?.children ?? "")` at lines 47, 51) keeps working unchanged.

Do **not** gate highlighting on `!streaming`. The mermaid/svg gate exists because those renderers are destructive on partial input; highlighting on incomplete code is purely cosmetic — worst case the auto-detector misclassifies the first few tokens and re-classifies as more arrives. Gating would produce a jarring single repaint at stream end instead of gradual refinement.

Languages: leave at the rehype-highlight default (lowlight `common` ≈ 35 languages — covers js/ts/python/rust/go/java/c/cpp/bash/json/yaml/sql/xml/html/css/markdown/diff). Don't pass a `subset` until/unless we measure a bundle-size problem.

### 3. `app/globals.css` — theme imports

CSS `@import` rules must precede other at-rules, so place these immediately after `@import "tailwindcss";` and before `@plugin "@tailwindcss/typography";`:

```css
@import "tailwindcss";
@import "highlight.js/styles/github.css" (prefers-color-scheme: light);
@import "highlight.js/styles/github-dark.css" (prefers-color-scheme: dark);
@plugin "@tailwindcss/typography";
```

Both themes only emit `.hljs*` selectors and won't collide with Tailwind's `prose` rules. The github theme's `.hljs` background has higher specificity than the prose `pre`/`code` background and will win on the `<code class="hljs language-…">` element that `rehype-highlight` produces. Inline code (single backticks) isn't touched by `rehype-highlight` and keeps its prose styling.

## Critical files

- `components/MathMarkdown.tsx` — add the import and the plugin entry; nothing else changes.
- `app/globals.css` — two CSS imports between the existing tailwindcss/plugin lines.
- `package.json` — two new dependencies.

## Reused pieces

- The existing `rehypePlugins` array in `MathMarkdown.tsx:13` — same slot pattern as `rehype-katex`.
- The existing `pre` override (lines 39–55) — unchanged; `plainText` makes mermaid/svg passthrough seamless.
- The app-wide `prefers-color-scheme` dark-mode convention (`app/globals.css:16-21`) — reused for theme switching.

## Verification

1. **Install + build**: `npm install` then `npm run build`. Should pass with no new TS or lint warnings.
2. **Highlight golden path**: `npm run dev`, open a book, ask Claude something that returns a fenced code block (e.g. "show me a Python factorial"). Confirm tokens get colored (keywords, strings, comments) and that the colors are readable.
3. **Multiple languages**: ask for the same task in JS, TS, Python, Rust, Bash, JSON. Confirm each highlights distinctly.
4. **Unlabeled fences**: ask Claude to emit a fenced block without a language tag and confirm auto-detect produces reasonable highlighting (or at minimum, no throw).
5. **Mermaid still renders**: ask for a flowchart. Confirm the ```` ```mermaid ```` block becomes a rendered diagram, not a highlighted code block.
6. **SVG still renders**: ask for an SVG figure. Confirm the ```` ```svg ```` block becomes an inline SVG.
7. **Math still renders**: confirm `$$...$$` and `$...$` still render via KaTeX (regression check on plugin ordering).
8. **Streaming**: while a long code-bearing response is mid-stream, confirm the in-progress code highlights as it grows (some early-token re-classification is expected and acceptable).
9. **Light/dark switch**: toggle the OS dark-mode preference and confirm code blocks swap to the dark theme without a reload (CSS media-query-conditioned imports handle this automatically).
