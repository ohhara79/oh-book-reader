# Default question for empty Ask on new threads

## Context

In the conversation panel, the Ask button is disabled while the textarea is empty, so users who select a region of a page must type something before they can ask. For the common case of "I selected this passage and just want help understanding it," typing a question every time is friction.

We want: when the user grabs an area and hits Ask with an empty textarea, send a default question so Claude can respond. The default text should appear in the user message bubble exactly as if the user had typed it. Scope is **initial ask only** (creating a new thread from a fresh selection); follow-ups inside an existing thread still require typed input.

Default question text (decided): `Help me understand this.`

Memo button is unaffected — memos remain disabled on empty input.

## Change summary

All edits are in `components/ConversationPanel.tsx`. No API/server changes; the existing `POST /api/conversations` flow already accepts an arbitrary `question` string.

### 1. Add the default constant

Near the top of `components/ConversationPanel.tsx` (alongside `ATTACHMENT_ACCEPT`):

```ts
const DEFAULT_NEW_THREAD_QUESTION = "Help me understand this.";
```

### 2. Use the default inside `submitAsk`

Current logic returns early when the trimmed question is empty. Change it so that on a new-thread submission an empty input falls back to the default. Follow-up submissions keep the existing behavior (return on empty).

```ts
function submitAsk() {
  if (streaming || posting) return;
  const trimmed = question.trim();
  const isNewThread = active?.kind === "new" && !newConvSentRef.current;
  const q = trimmed || (isNewThread ? DEFAULT_NEW_THREAD_QUESTION : "");
  if (!q) return;
  const atts = attachments;
  const refIds = referencedThreads.map((r) => r.conversationId);
  setQuestion("");
  setAttachments([]);
  setReferencedThreads([]);
  setRefInputOpen(false);
  setRefInputValue("");
  refocusComposerRef.current = true;
  if (active?.kind === "new" && !newConvSentRef.current) {
    newConvSentRef.current = true;
    void startNewConversationAsk(active.capture, q, atts, refIds);
  } else if (conversationId) {
    void sendFollowup(q, atts, refIds);
  }
}
```

The new-thread predicate is captured in `isNewThread` for the default-substitution decision, then re-tested inline at the dispatch site so TypeScript can narrow the `active` discriminated union to extract `active.capture`. (Capturing the result into a boolean alias loses the narrowing.)

The default is only substituted when `isNewThread` is true, so empty follow-ups still no-op. Because `q` is passed unchanged into `startNewConversationAsk`, the default text flows into the persisted user message and into the user-bubble render at lines 1822–1902 with no further work.

### 3. Enable the Ask button on empty input for new threads

Relax the Ask button's `disabled` to allow the empty case when starting a new thread:

```tsx
<button
  type="submit"
  disabled={busy || (!trimmed && active?.kind !== "new")}
  ...
>
  {streaming ? "Asking…" : "Ask"}
</button>
```

The Memo button keeps `disabled={busy || !trimmed}` — memos do not get a default.

### Why these three edits are sufficient

- The Enter key handler already routes through `submitAsk`, so pressing Enter in an empty textarea on a new thread will correctly send the default — no separate change needed.
- The user bubble pulls its text from the message that's persisted via the API, which receives `q`. Substituting the default inside `submitAsk` means the bubble shows `Help me understand this.` automatically.
- `active?.kind === "new"` is the same predicate already used to distinguish initial-ask from follow-up, so we're reusing an existing concept rather than introducing a new one.

## Critical files

- `components/ConversationPanel.tsx` — only file modified
  - Module-level constants area (top of file): add `DEFAULT_NEW_THREAD_QUESTION`
  - `submitAsk`: substitute default when new-thread + empty
  - Ask `<button>`: relax `disabled` for new-thread case

No changes needed in:
- `app/api/conversations/route.ts` (server already accepts arbitrary question strings)
- `app/api/conversations/[id]/messages/route.ts` (follow-ups unchanged)
- `lib/promptParts.ts`
- `components/ThreadList.tsx`, `components/ThreadHeadingRow.tsx`

## Verification

Manual end-to-end (run the dev server, open the reader):

1. **Default fires on empty new-thread Ask.** Open a book page, select a region to start a new thread, leave the textarea empty, click **Ask**. Expect: a user bubble appears showing `Help me understand this.`, then Claude streams a response.
2. **Default fires via Enter key.** Repeat step 1 but press Enter in the empty textarea instead of clicking Ask. Same result.
3. **Typed input still wins.** Select a region, type a real question, click Ask. Expect: the typed text is sent, default is not substituted.
4. **Follow-ups still require input.** In an existing thread, clear the textarea. Expect: Ask button is disabled, Enter does nothing.
5. **Memo unaffected.** With an empty textarea on a new thread, the Memo button remains disabled; clicking it does nothing; Cmd/Ctrl+Enter on empty does nothing.
6. **Attachments + empty text on new thread.** Attach an image, leave text empty, click Ask. Expect: default question is sent along with the attachment.

Type-check (`npx tsc --noEmit`) to catch any regressions.
