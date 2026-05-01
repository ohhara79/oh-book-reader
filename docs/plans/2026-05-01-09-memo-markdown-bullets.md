# Restore Markdown List Bullets in Memo/Conversation Threads

## Context

The user types markdown bullets (`- item` or `* item`) in the memo textarea of the conversation panel and expects to see rendered bullets, but no markers appear.

**Root cause:** The memo body is rendered by `components/MathMarkdown.tsx` inside a wrapper with classes `prose prose-sm max-w-none dark:prose-invert`. Those classes belong to the **`@tailwindcss/typography`** plugin — which is **not installed** in this project. As a result:

1. `react-markdown` correctly emits `<ul><li>…</li></ul>` for `- item`.
2. Tailwind v4's preflight reset removes list markers (`list-style: none`, zero padding) from `<ul>`/`<ol>` by default.
3. Because the typography plugin is absent, the `prose` classes are unknown utilities and do nothing — so the reset wins and bullets disappear.

This also silently breaks ordered lists, blockquotes, headings inside memos, etc. — anything `prose` is supposed to restore.

The same `MathMarkdown` component is used for memos and any other markdown rendering it gets reused for, so fixing it here fixes the feature uniformly.

## Recommended approach

Install and activate the official Tailwind v4 typography plugin. This is the idiomatic fix because the code already opts into `prose` styling — we just need to make those classes real.

### Steps

1. **Install the plugin** as a dev dependency:
   ```
   npm install -D @tailwindcss/typography
   ```

2. **Activate it in `app/globals.css`** by adding a `@plugin` directive directly under the existing `@import "tailwindcss";` line (Tailwind v4 plugin-loading syntax):
   ```css
   @import "tailwindcss";
   @plugin "@tailwindcss/typography";
   ```

No changes are needed to `components/MathMarkdown.tsx` — the existing `prose prose-sm max-w-none dark:prose-invert` classes will start applying once the plugin is registered.

### Critical files

- `app/globals.css` — add the `@plugin` directive (1 line).
- `package.json` / `package-lock.json` — updated by npm install.
- `components/MathMarkdown.tsx` — **no edit**, referenced for context (line 12 wrapper).

### Why not the alternatives

- **Hand-rolled CSS to restore `list-style: disc` on `MathMarkdown` `<ul>`** — works, but reinvents a slice of the typography plugin and leaves headings/blockquotes/code-blocks still unstyled inside memos.
- **Removing the `prose` classes** — would lose the intended typographic treatment entirely.

## Verification

1. `npm run dev` and open a PDF in the reader.
2. Make a text selection to open the conversation panel, then in the memo textarea type:
   ```
   - first
   - second

   1. one
   2. two
   ```
   and submit.
3. Confirm that:
   - The submitted memo bubble shows disc bullets for the unordered list and `1.`/`2.` for the ordered list.
   - The live preview area above the textarea (also rendered by `MathMarkdown`) shows the same bullets while typing.
   - Inline math (`$e^{i\pi}=-1$`) still renders via KaTeX — confirming the `react-markdown` + `remark-math` + `rehype-katex` pipeline is unaffected.
4. Reload the page and reopen the same conversation; bullets should persist (storage stores raw markdown, so this just re-checks the render path).
5. `npm run build` to confirm the Tailwind v4 build picks up the plugin without errors.
