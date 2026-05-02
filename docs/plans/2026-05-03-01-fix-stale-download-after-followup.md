# Fix: Download misses last Q&A when invoked right after a follow-up question

## Context

Reported bug: in an open thread, asking a follow-up question and then immediately clicking the download icon yields a markdown file that omits the most recent question/answer. Closing and reopening the thread, then downloading, includes everything. The user wants a fix.

The download must reflect the conversation the user just saw, regardless of whether they reopen the thread first.

## Root cause

In `components/ConversationPanel.tsx`, the download is built from `rawConversation` state (the server-shaped conversation), not from the live `messages` array used for rendering:

- `exportMarkdown` is memoized on `rawConversation` (lines 396–402).
- `onDownloadThread` reads that memo (lines 404–411).
- `rawConversation` is only refreshed via `loadConversation(cid)` (line 363), which fetches `/api/conversations/[id]`.

Three of the four message-mutation paths refresh `rawConversation` after the server commits:

- `startNewConversationAsk` — `await loadConversation(createdId)` at line 499.
- `startNewConversationMemo` — `await loadConversation(j.conversationId)` at line 554.
- `appendMemoToExisting` (line 563) — does **not** reload (parallel issue, see below).
- **`sendFollowup` (line 605) — does not reload.** After `consumeSseInto(...)` finishes streaming (line 639), it calls `onCreated()` and returns. The streamed text is appended to in-memory `messages` only. `rawConversation` still holds the pre-followup snapshot, so `exportMarkdown` is stale until the thread is reopened (which re-runs the effect at line 322 and refetches).

Reopening the thread works because the mount effect calls `loadConversation`, which now reads the persisted state appended server-side by `/api/conversations/[id]/messages`.

## Fix

In `components/ConversationPanel.tsx`, refresh `rawConversation` after each "append to existing thread" path completes server-side, mirroring the pattern already used by `startNewConversationAsk` (line 499) and `startNewConversationMemo` (line 554).

### 1. `sendFollowup` (lines 605–670) — Q&A follow-up

After `consumeSseInto(...)` resolves, before `onCreated()`:

```ts
await consumeSseInto(r, { /* ... */ });
await loadConversation(conversationId);   // <-- add (~664)
onCreated();
```

### 2. `appendMemoToExisting` (lines 563–603) — memo append

Same root cause: the memo is persisted server-side via `POST /api/conversations/:id/memos`, but `rawConversation` is never refreshed, so a download taken before reopening the thread will omit the just-added memo. After the `r.ok` check, before `onCreated()`:

```ts
if (!r.ok) {
  setError(`failed to save memo: ${r.status}`);
  return;
}
await loadConversation(conversationId);   // <-- add (~597)
onCreated();
```

Two added lines total. No new helpers, no refactor.

### Critical file

- `components/ConversationPanel.tsx` — add `await loadConversation(conversationId);` in `sendFollowup` (between current lines 663 and 664) and in `appendMemoToExisting` (between current lines 596 and 597).

## Verification

1. `npm run dev` (Next.js dev server).
2. Open a book, open an existing thread from the conversations panel.
3. **Q&A path**: ask a follow-up question that includes a referenced thread link; wait for the streaming reply to finish. Click download **without closing the thread**. Open the `.md` — confirm the last user question and assistant answer (including the reference link block) are present.
4. **Memo path**: in the same open thread, append a memo. Click download **without closing the thread**. Confirm the memo appears in the `.md`.
5. Repeat both flows but close and reopen the thread before downloading — confirm the markdown still matches (regression check).
6. Run the project's typecheck (e.g. `npm run typecheck`) to make sure the edits compile.
