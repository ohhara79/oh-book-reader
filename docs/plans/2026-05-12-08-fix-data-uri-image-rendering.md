# Fix: composer preview drops `data:` URI images

## Context

In the conversation thread view, the composer has a "Preview" toggle
(`components/ConversationPanel.tsx:1862`) that live-renders whatever the user
has typed via `<MathMarkdown>`. When the markdown contains a `data:` URI image
— e.g. `![selection page 30](data:image/png;base64,iVBO…)` — the image is
silently dropped from the preview, even though the surrounding text renders
normally.

This isn't a hypothetical case: `lib/exportConversation.ts:39` produces exactly
that form for selected-region screenshots, and the "Copy selection (image +
text)" button on `PreviewBox` (`components/ConversationPanel.tsx:2090,2101`)
puts it on the clipboard. The intended workflow — copy a selection's markdown,
paste it into the composer, see it rendered before sending — breaks because the
image disappears.

### Root cause

`react-markdown@10` runs every URL through `urlTransform`, defaulting to
`defaultUrlTransform` (`node_modules/react-markdown/lib/index.js:421`), which
allows only `http`, `https`, `ircs?`, `mailto`, `xmpp`. `data:` is stripped to
`""`. The `img` component override in
`components/MathMarkdown.tsx:266-284` then short-circuits on
`if (typeof src !== "string" || !src) return null;` (line 267) and the image
disappears with no visible error.

This affects every consumer of `<MathMarkdown>`, not just the composer preview
— any rendered turn or memo that happens to embed a `data:` URI image would
also be silently stripped. The composer preview is just where the user noticed
it first.

## Fix

Override `urlTransform` on the single `<ReactMarkdown>` instance in
`components/MathMarkdown.tsx`:

- Pass through unchanged any URL matching `^data:image/[\w.+-]+;base64,` (case
  insensitive).
- Delegate every other URL to `defaultUrlTransform`, preserving existing XSS
  guarantees (`javascript:` and `data:text/html,…` remain blocked, link
  hrefs are untouched).

The base64 anchor matters: it rules out `data:image/svg+xml,<script>…` raw-SVG
smuggling. (Modern browsers don't execute scripts inside `<img src>` SVGs
anyway, but defense in depth is cheap here.) `data:image/*` in an `<img src>`
cannot execute scripts, so loosening this restriction is safe.

## Critical files

- `components/MathMarkdown.tsx` — add `defaultUrlTransform` and the
  `UrlTransform` type to the `react-markdown` import, define a module-level
  `allowDataImageUrl` transform that returns `value` when the data-image regex
  matches and otherwise delegates to `defaultUrlTransform`, and pass
  `urlTransform={allowDataImageUrl}` to `<ReactMarkdown>`.

No other call sites need to change — `<MathMarkdown>` is the single rendering
path for markdown in this app.

## Verification

1. `npm run dev`, open a book, make a region selection, click "Copy selection
   (image + text)" on the `PreviewBox` (the copy button at
   `components/ConversationPanel.tsx:2101`), paste into the composer, and
   toggle on the preview via the eye icon at line 1952. The embedded image
   should now appear in the preview pane.
2. Re-verify with a text-only selection (the textOnly branch of
   `selectionSection`, `lib/exportConversation.ts:37`): markdown without an
   image still renders fine.
3. XSS regression check: type
   `[click](data:text/html,<script>alert(1)</script>)` into the composer.
   With preview on, the anchor's `href` should be empty (the
   `data:text/html` URI is still filtered by `defaultUrlTransform`).
4. Try a couple of common image media types: `data:image/png;base64,…` and
   `data:image/jpeg;base64,…` — both should render via the existing
   `ZoomableBlock` wrapper at `components/MathMarkdown.tsx:269-282`.
