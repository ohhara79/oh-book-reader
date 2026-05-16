# Add copy icon to markdown headings in conversation thread view

## Context

In the conversation/thread view, markdown blocks (`p`, `blockquote`, `table`, `ul`, `ol`) render a hover-revealed copy icon that copies the block's markdown source. Headings (`h1`–`h6`) do **not** — they render as bare `<hN>` with no wrapper. The user pointed out that `## Why we need a pseudoinverse` in an assistant message has no copy icon while the surrounding paragraphs/lists do. The fix is to extend the existing copy-icon mechanism to cover all six heading levels, matching the look and behavior of the other prose blocks.

The whole change lives in **`components/MathMarkdown.tsx`** — the markdown renderer used by `components/ConversationPanel.tsx` for every user/assistant/memo message.

## Implementation

### 1. Add headings to the rehype tag-marking set

`components/MathMarkdown.tsx:120` — extend the set used by `rehypeMarkCopyableBlocks` to also tag heading elements with `dataCopyable`:

```ts
const COPYABLE_BLOCK_TAGS = new Set([
  "p", "blockquote", "table", "ul", "ol",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);
```

The existing `rehypeMarkCopyableBlocks` walker and the `copyableSource` helper already use the tag name generically, so no other change is required there. Headings only contain inline content (text, `em`, `strong`, inline `code`, inline math), none of which are in `COPYABLE_BLOCK_TAGS` — so the "skip descendants of a copyable ancestor" guard already prevents any nesting issues.

### 2. Add `h1`–`h6` component overrides

Inside the `components` object, add six entries modeled on the existing `ul`/`ol`/`blockquote` overrides (no `BlockScrollWrapper` — matches `blockquote`/`ul`/`ol`; heading text is unlikely to overflow, and adding scroll on headings would be a behavior change beyond the bug fix):

```tsx
h1({ node, children, ...rest }) {
  const src = copyableSource(node, "h1");
  if (!src) return <h1 {...rest}>{children}</h1>;
  return (
    <div className="relative group/prose">
      <h1 {...rest}>{children}</h1>
      <CopyButton text={src} title="Copy heading" className={COPY_BTN_PROSE_BLOCK_CLS} />
    </div>
  );
},
// ...identical bodies for h2, h3, h4, h5, h6, each passing its own tag name to copyableSource
```

All six are nearly identical — same pattern as the existing duplicated `ul`/`ol` pair, kept duplicated for consistency with surrounding code style.

The button reuses `COPY_BTN_PROSE_BLOCK_CLS`: top-right corner, anchored at `top-0 -translate-y-1/2` so it overlays the heading's top edge half above / half over the first line, hover-revealed via `group/prose`, and forced visible on touch devices. Same affordance as paragraphs.

### What gets copied

`copyableSource` slices `normalizedText` between the heading node's `position.start.offset` and `position.end.offset` — for `## Why we need a pseudoinverse` that's the literal `## Why we need a pseudoinverse` substring, including the `##` markers. This matches how paragraph/list copy already works (full markdown source, not rendered text).

## Files modified

- `components/MathMarkdown.tsx` — the only file that changes.

## Verification

1. `npm run dev`, open a book that has a conversation containing markdown headings.
2. Hover each heading level present (`#`, `##`, `###`, etc.) — a copy icon should appear at the top-right, vertically centered on the heading's top edge.
3. Click the icon — clipboard should contain the heading's markdown source including the `#` markers (e.g. `## Why we need a pseudoinverse`). The icon should briefly switch to the check mark for ~1.5s.
4. Headings with inline math (e.g. `# Understanding $A^+ = (A^\top A)^{-1} A^\top$`) should still render the math correctly and also expose a copy icon — verify the math-inline copy button still works on the formula inside the heading (no collision: math button anchors to the math span, heading button anchors to the heading's top-right).
5. On a touch device / `[@media(hover:none)]`, the icon should be permanently visible (per `COPY_BTN_PROSE_BLOCK_CLS`).
6. `npm run build` should still pass.
