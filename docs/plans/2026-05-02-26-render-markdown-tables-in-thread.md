# Fix: Markdown tables not rendering in conversation thread

## Context

In the conversation thread panel, markdown tables produced by the AI render as raw `| col | col |` text inline instead of as actual tables (visible in the screenshot — the "Icon | Section | Purpose | …" row is unstyled pipe-separated text).

Root cause: `components/MathMarkdown.tsx` configures `react-markdown` with `remark-math` + `rehype-katex` only. GitHub-flavored markdown features (tables, strikethrough, task lists, autolinks) require the `remark-gfm` plugin, which is neither installed nor configured.

The Tailwind `@tailwindcss/typography` plugin is already active and `MathMarkdown` already wraps content in `prose prose-sm dark:prose-invert`, so once the parser emits `<table>` elements they will be styled correctly with no CSS work needed.

## Changes

### 1. Add `remark-gfm` dependency

`package.json` — add to `dependencies`:

```
"remark-gfm": "^4.0.1"
```

(v4 is the line compatible with `react-markdown` v10, which is what this project uses.)

Then run `npm install` to update `package-lock.json` / `node_modules`.

### 2. Wire the plugin into the markdown renderer

`components/MathMarkdown.tsx` — two edits:

- Add import at the top:
  ```ts
  import remarkGfm from "remark-gfm";
  ```
- Include it in the plugin array (kept module-scoped so the array reference stays stable across renders, matching the existing pattern):
  ```ts
  const remarkPlugins = [remarkGfm, remarkMath];
  ```

That's the entire code change. `MathMarkdown` is already used by every assistant/memo/user message in `ConversationPanel.tsx` (`MessageBubble`, lines 1118 & 1123), so the fix applies everywhere thread messages are shown.

## Verification

1. `npm run dev` and open the reader on a book.
2. Open the existing thread shown in the screenshot (the "test" thread on *Algorithms for Convex Optimization*). The "Icon | Section | Purpose" content should now render as a real HTML table with header row and borders, instead of raw pipes.
3. Send a new Ask whose response is likely to include a table (e.g. "Give me a comparison table of three convex optimization algorithms"). Confirm the response renders as a table.
4. Sanity-check that existing features still work in the same thread: math (inline `$…$` and display `$$…$$`), code fences, lists, and bold/italic — i.e. that adding `remark-gfm` did not regress `remark-math` or the prose styling.
5. Optional: verify GFM extras now work — a strikethrough `~~foo~~`, a task list `- [x] done`, and a bare URL autolink should all render.

## Critical files

- `components/MathMarkdown.tsx` — add import + plugin (the only code edit)
- `package.json` — add `remark-gfm` dependency
- `components/ConversationPanel.tsx` — no edit; just the consumer (`MessageBubble` at lines ~1118, 1123) that benefits from the fix
