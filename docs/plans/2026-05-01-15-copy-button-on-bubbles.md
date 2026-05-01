# Add a copy button to each conversation bubble

## Context

Threads in the conversation panel render four kinds of "bubbles": the
**Selected region** preview box at the top, **memo** notes, **user**
questions, and **assistant** replies. Users currently have no way to
grab the underlying markdown+math source out of a bubble — they can
only select rendered text, which loses LaTeX delimiters, code fences,
list markers, etc., and copies KaTeX-rendered DOM noise instead of
clean source.

We want a small copy button on every bubble that writes the original
markdown+math source to the clipboard so users can paste it elsewhere
(notes app, another LLM, a doc) without rebuilding it. The Selected
region box is special: it contains an image + extracted OCR/selection
text, and only the text is copied — images are intentionally
excluded.

## Approach

Add one small reusable `CopyButton` component, then wire it into the
header row of each bubble in `components/ConversationPanel.tsx`. Copy
uses `navigator.clipboard.writeText()`. After a successful copy, the
icon swaps to a checkmark for ~1.5s, then reverts.

### 1. New component: `components/CopyButton.tsx`

A small `"use client"` button:

- Props: `{ text: string; title?: string; className?: string }`.
- Renders a 14px inline SVG copy icon (no icon library is installed —
  a minimal SVG path matches the project's existing style).
- On click: `await navigator.clipboard.writeText(text)`, set local
  `copied` state to `true`, clear via `setTimeout(..., 1500)`. Cleanup
  the timer on unmount.
- While `copied`, swap the SVG path to a checkmark.
- Disabled when `text` is empty.
- Tailwind classes consistent with the existing close/delete buttons
  in `ConversationPanel.tsx`: `text-zinc-500 hover:text-zinc-900
  active:opacity-70 disabled:opacity-40
  dark:hover:text-zinc-100`, plus padding sized for a small icon
  button.
- `title` prop becomes the `title=` attribute (browser tooltip),
  defaulting to `"Copy"` and `"Copied!"` when active. `aria-label`
  mirrors the same.

### 2. Wire into `MessageBubble`

The bubble already has a header line with the role label + timestamp
(`memo · …`, `ask · …`, `claude · …`). Wrap that line in a `flex
items-center justify-between` row so the copy button sits on the
right.

- **Memo branch:** wrap the `memo · {formatTimestamp}` `<p>` in a flex
  row, append `<CopyButton text={m.text} />`.
- **User/assistant branch:** same pattern around the existing
  timestamp `<p>`. Pass `m.text` as the source.
  - Edge case: assistant text may be empty during streaming — the
    button is disabled in that state via the empty-text check inside
    `CopyButton`.
  - Edge case: when `m.created_at == null` the timestamp `<p>` is
    skipped. Keep the flex row regardless and render an empty `<span
    />` placeholder so the button stays right-aligned.

`m.text` is the right source: `turnsToDisplay()` already strips
images and the `Question:` prompt prefix, so what's stored on the
display message is exactly the original markdown+math.

### 3. Wire into `PreviewBox`

Add a copy button to the `Selected region · {label}` header row. Wrap
it in `flex items-center justify-between` and append `<CopyButton
text={selectedText} title="Copy selection text" />` where:

```ts
const selectedText = capture.spans
  .map((s) => s.selectionText)
  .filter((t) => t && t.length > 0)
  .join("\n\n");
```

This concatenates per-span `selectionText` (defined in
`components/SelectionOverlay.tsx`) with blank lines between spans.
Images (`imageBase64`) are intentionally not included. If every
span's `selectionText` is empty, `selectedText` is `""` and
`CopyButton` disables itself.

## Files modified

- **New:** `components/CopyButton.tsx` — reusable copy button with
  checkmark feedback.
- **Edit:** `components/ConversationPanel.tsx` — add header flex row
  + `<CopyButton>` to `MessageBubble` (memo, user, assistant) and
  `PreviewBox`. Import `CopyButton` at the top.

No changes to data shape, API, or storage. The text source for
messages (`DisplayMessage.text`) and selection
(`CapturedSpan.selectionText`) already exists.

## Verification

1. `npm run dev`, open a book, open or create a thread.
2. **Selected region:** click copy on the preview box at the top of
   the thread → paste in a text editor → expect concatenated
   `selectionText` from each span, no image, no base64. If the
   selection produced no text, the button is disabled.
3. **User bubble:** click copy on a question that contains LaTeX,
   e.g. `What is $\int_0^1 x^2 \, dx$?` → paste → expect the literal
   `$...$` source, not a rendered formula.
4. **Assistant bubble:** click copy on a Claude reply containing
   markdown headings, lists, code fences, and `$$...$$` blocks →
   paste → expect raw markdown+math identical to what Claude
   streamed.
5. **Memo bubble:** click copy on a memo with markdown → paste →
   expect the original markdown source.
6. **Feedback:** after each click, the icon visibly swaps to a
   checkmark for ~1.5s and then reverts. Clicking again works.
7. **Streaming:** while an assistant reply is streaming, the copy
   button on that bubble is disabled until non-empty text exists;
   once text arrives it becomes enabled and copies whatever has
   streamed so far.
8. **Dark mode:** confirm hover/disabled colors look right against
   both `bg-zinc-100`/`bg-blue-50` and their dark counterparts.
9. `npx tsc --noEmit` clean.
