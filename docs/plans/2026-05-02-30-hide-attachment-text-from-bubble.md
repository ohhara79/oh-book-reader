# Hide attached-text content from rendered chat bubbles

## Context

The previous plan (`2026-05-02-29-attach-text-documents-to-ask-and-memo.md`)
shipped support for attaching `text/*` files to Ask and Memo messages. On the
wire each text attachment is wrapped as a `<document name="…">…</document>`
text block so Claude can read it as context alongside the user's question.

Reported issue: in the chat history the attachment's full text body is also
rendered inside the user's bubble — visible right after their typed question.
The attachment chip ("voice.txt") is already shown at the bottom of the same
bubble, so the inline content is pure duplication and clutters the
conversation. The user's intent: "if I wanted that text in the bubble, I'd
have pasted it into the input." The same redundancy affects the markdown
export, which renders each text attachment twice (once inline as the
`<document>` block, once via the dedicated `#### Attachment: …` fenced code
block from `attachmentMarkdown`).

Desired outcome: attachment text continues to be sent to the LLM as context,
but the chat bubble (and export) shows only what the user typed plus the
attachment chip.

## Root cause

`attachmentBlocks()` in `lib/promptParts.ts` emits each text attachment as a
separate `{ type: "text", text: '<document name="…">\n…\n</document>' }`
content block. `buildFirstUserContent` (same file) appends those blocks after
the `Question:` block.

When the UI reconstructs the visible text it concatenates every text block in
`turn.content`, then runs `extractUserQuestion(text)` to keep only what
follows `"Question:"`. That regex (`/Question:\s*([\s\S]*)$/` in
`lib/exportConversation.ts`) is greedy to end-of-string, so the appended
`<document>` blocks are captured into the "question" and rendered as part of
it.

The same concatenate-then-extract logic was duplicated in two places:

- `components/ConversationPanel.tsx` `turnsToDisplay()` — chat bubble
- `lib/exportConversation.ts` `turnText()` — markdown export

## Approach

Filter out attachment-derived `<document>` text blocks at the block level
before concatenating the user-visible text. `turn.content` itself is left
unchanged so subsequent regenerations still send full context to Claude.

To keep bubble and export from drifting, the duplicated extraction logic is
centralized into a single shared helper.

### Why a structural skip, not a regex strip

Skipping at the block level (whole-block predicate) cannot accidentally munge
user content that happens to contain `<document …>` literal text — only
blocks produced by `attachmentBlocks` match. The predicate lives next to
`attachmentBlocks` so the producer and recognizer of the wrapper format stay
in one file.

## Changes

### `lib/promptParts.ts`

Add a small predicate next to `attachmentBlocks`:

```ts
const DOCUMENT_BLOCK_RE = /^<document name="[^"]*">[\s\S]*<\/document>$/;

export function isAttachmentDocumentBlock(block: ContentBlock): boolean {
  return block.type === "text" && DOCUMENT_BLOCK_RE.test(block.text);
}
```

### `lib/exportConversation.ts`

Promote the local `turnText` helper to an exported `userVisibleTurnText` and
have it skip attachment-document blocks:

```ts
import { isAttachmentDocumentBlock } from "./promptParts";

export function userVisibleTurnText(t: Turn): string {
  if (t.role === "memo") return t.text;
  let text = "";
  for (const block of t.content) {
    if (block.type !== "text") continue;
    if (isAttachmentDocumentBlock(block)) continue;
    text += (text ? "\n" : "") + block.text;
  }
  if (t.role === "user") text = extractUserQuestion(text);
  return text;
}
```

Update `turnSection` to call `userVisibleTurnText(t)` instead of the local
`turnText(t)` (the local helper is removed).

### `components/ConversationPanel.tsx`

In `turnsToDisplay`, replace the inline block-text concatenation +
`extractUserQuestion(text)` with a single call to `userVisibleTurnText(t)`.
Drop the now-unused `extractUserQuestion` import; add `userVisibleTurnText`
to the existing `@/lib/exportConversation` import group.

No changes to `lib/store.ts`, the messages/memos API routes, the prompt
builders, or the `Attachment`/`Turn` shapes. The on-disk message format and
the LLM payload are unchanged, so existing conversations render correctly
with the new code.

## Critical files

- `/home/ohhara/work/oh-book-reader/lib/promptParts.ts`
- `/home/ohhara/work/oh-book-reader/lib/exportConversation.ts`
- `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`

## Verification

1. `npx tsc --noEmit` clean.
2. `npm run dev`, then exercise the flow shown in the bug report:
   - Open a book, ask a question with a `.txt` attachment (e.g. `voice.txt`).
     The user bubble should show only the typed question and the attachment
     chip — no `<document name="voice.txt">…</document>` body.
   - The assistant should still answer using the file's content, proving the
     LLM payload is unchanged.
3. Repeat with multiple text attachments in one Ask, and with a Memo that
   carries a text attachment — both render chip-only.
4. Sanity-check unaffected flows:
   - Ask with only a selection, no attachment — unchanged.
   - Ask with an image attachment — unchanged (images are stored as `image`
     blocks, already skipped by the text-only loop).
5. Export the conversation to markdown (download button) and confirm each
   text attachment appears once — only as the `#### Attachment: …` fenced
   code block, not inline as `<document>` text.
6. Re-ask in an existing conversation that has a prior text-attachment turn:
   the new turn still carries the prior turn's full content via the stored
   `turn.content` blocks (LLM context preserved across regenerations).
