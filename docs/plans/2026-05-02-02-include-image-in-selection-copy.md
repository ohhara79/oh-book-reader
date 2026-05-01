# Include image in Selected-region bubble copy

## Context

Commit `c712137` added a `CopyButton` to each conversation bubble. For the
`PreviewBox` (the "Selected region · page N" bubble at the top of a thread),
the button currently copies only concatenated `selectionText` — the captured
image is intentionally excluded (per that commit's message).

The user now wants the Selected-region copy to include the image too, matching
the format already used by the conversation-thread Markdown download/print
(`Copy thread`, `Download`, `Print` actions in the panel header).

The Markdown export already does this. `selectionSection()` in
`lib/exportConversation.ts:29-45` emits, for each span:

```
## Selected region — page N
![selection page N](data:<media-type>;base64,<base64>)

> selection text…
```

So the right move is to reuse that exact output for the bubble's Copy button,
not to re-derive a new format.

## Approach

1. Export `selectionSection` from `lib/exportConversation.ts` (currently
   module-private) so the UI can call it directly. Keep its signature as-is.
2. In `components/ConversationPanel.tsx`, change `PreviewBox` to compute its
   `CopyButton` payload via `selectionSection(capture)` instead of joining
   `selectionText` values. Update the button `title` from
   `"Copy selection text"` to `"Copy selection (image + text)"` so the change
   in behavior is discoverable on hover.
3. Nothing else needs to change — `CopyButton` already writes whatever string
   it's given to the clipboard via `navigator.clipboard.writeText`, which
   correctly handles long data-URL strings.

## Files modified

- `lib/exportConversation.ts` — add `export` to `selectionSection`.
- `components/ConversationPanel.tsx` — import `selectionSection`, replace the
  `selectedText` computation in `PreviewBox` with a call to it, and update the
  button `title`.

## Notes / tradeoffs

- The copied text includes the `## Selected region — …` heading. That's
  consistent with the .md download and gives the paste a clear label.
- Pasting markdown with a base64 data-URL image works in Markdown viewers
  (Obsidian, GitHub gists rendered locally, VS Code preview) and in tools that
  understand data URLs. Plain text editors will see a long URL — same behavior
  as the .md download, so no new failure mode is introduced.
- Other bubble Copy buttons (memo / ask / claude) are untouched and still copy
  plain markdown+math text only.

## Verification

1. `npm run dev`, open a book, drag-select a region, start a thread (Ask or
   Memo).
2. Click the copy icon on the "Selected region · page N" bubble at the top of
   the thread.
3. Paste into a Markdown-aware viewer; confirm the image renders and the
   selection text appears as a blockquote underneath.
4. Re-open the same thread later and repeat the copy — the existing-capture
   path also flows through `PreviewBox`, so it should behave identically.
5. Confirm the per-message bubble Copy buttons (memo / ask / claude) still
   copy plain markdown+math text only.
6. `npx tsc --noEmit` clean.
