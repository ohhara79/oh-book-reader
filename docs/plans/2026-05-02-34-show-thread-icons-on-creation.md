# Show thread title and action icons immediately after creation

## Context

When the user creates a new conversation thread (memo or ask), the conversation
panel's header is missing the thread title text and the download / share /
delete icons. They appear only after the user closes the panel and reopens the
same thread. The expected behavior is that they show up as soon as the thread
is created — at that point the conversation already exists on the server and
all of those actions are functional.

## Root cause

`components/ConversationPanel.tsx` gates the title editor (line 781) and the
download/share/delete icons (line 863) on `active.kind === "existing"`. The
parent (`Reader.tsx`) sets `active = { kind: "new", capture }` when a selection
is made, and only flips `active.kind` to `"existing"` when the thread is
re-opened from the thread list (`Reader.tsx:837`). So during the post-creation
moment — when `conversationId` has been received from the server but
`active.kind` is still `"new"` — the header shows the "New entry" fallback span
and skips the icons.

`active.kind === "existing"` is being used as a proxy for "this thread is
saved." The proxy is wrong on the create→saved transition.

## Why we can't just flip `active` to `"existing"` after creation

`Reader.tsx` keys the panel as
`key={active.kind === "new" ? "new" : active.conversationId}`
(`Reader.tsx:824-830`), so swapping `active` from `"new"` to `"existing"` would
remount the panel and wipe streaming state mid-response. The panel's reset
`useEffect` (`ConversationPanel.tsx:310-359`) is also keyed on `active`, which
would clobber the locally streamed messages by re-fetching. So `active` must
stay `"new"` for the lifetime of this panel instance.

## Approach

Use `rawConversation` as the saved-state signal instead. After the server
confirms creation, populate `rawConversation` (and `existingCapture`) by
fetching the new conversation — the same way the existing-open path already
does at `ConversationPanel.tsx:341-357` — and gate the header on
`rawConversation`.

### 1. Extract a `loadConversation` helper

Inside `ConversationPanel`, near the reset `useEffect` on line 310. It takes a
`conversationId`, GETs `/api/conversations/{id}`, and calls `setRawConversation`
+ `setExistingCapture`. Replace the inline fetch in the reset effect (lines
341–357) with a call to this helper — the existing path additionally calls
`setConversationId` and `setMessages(turnsToDisplay(...))`, which stays in the
caller (the helper deliberately does not touch `messages`, so the create paths
can keep their locally streamed turns).

### 2. Load `rawConversation` after ask creation

In `startNewConversationAsk` (`ConversationPanel.tsx:411-475`): capture the new
id inside the `onMeta` callback into a local `createdId`, and after
`consumeSseInto` resolves call `await loadConversation(createdId)` before
`onCreated()`. Doing it after the stream completes ensures `exportMarkdown`
reflects the full assistant turn. Capturing the id locally avoids a stale
closure over the `conversationId` state.

### 3. Load `rawConversation` after memo creation

In `startNewConversationMemo` (`ConversationPanel.tsx:477-529`): after
`setConversationId(j.conversationId)` and before `onCreated()`, call
`await loadConversation(j.conversationId)`.

### 4. Loosen the header gates

- Line 781: `active?.kind === "existing" && rawConversation` → `rawConversation`.
  Once the conversation is loaded, the editable title shows whether it was
  opened from the list or just created. The reset `useEffect` clears
  `rawConversation` on every `active` change, so this gate cannot fire
  spuriously while the panel is closed or while a fresh thread is starting.
- Line 863: `active.kind === "existing" && conversationId` →
  `conversationId && rawConversation`. The download/share/delete handlers
  already require `rawConversation` (`exportMarkdown` at line 380,
  `onDownloadThread` at line 388), so this gate matches what they actually
  need.

### 5. Leave other `active.kind` checks alone

`submitAsk` / `submitMemo` (`ConversationPanel.tsx:725, 743`) use
`active?.kind === "new"` to choose between the create path and the follow-up
path; the `newConvSentRef` guard already prevents a second create call, so
follow-up submits correctly route through `sendFollowup` /
`appendMemoToExisting`. The `PreviewBox` for new captures
(`ConversationPanel.tsx:1042`) is also unrelated. Only the two header gates
change.

## Files modified

- `components/ConversationPanel.tsx` — only file to change
  - Lines 310-359 (reset/load `useEffect`): extract `loadConversation` helper,
    inline fetch becomes helper call
  - Lines 411-475 (`startNewConversationAsk`): capture id in `onMeta`, call
    helper after stream
  - Lines 477-529 (`startNewConversationMemo`): call helper after POST
  - Line 781 (title gate): drop `active?.kind === "existing"` clause
  - Line 863 (icons gate): replace `active.kind === "existing"` with
    `rawConversation`

## Verification

1. Open a book, select text, click the Ask action. Verify the header shows the
   title (first 80 chars of the question) and the download / share / delete
   icons as soon as the assistant response starts streaming, not only after
   closing and reopening.
2. Same for the Memo action: after submitting, verify the header immediately
   shows the memo title and the three icons.
3. Click each of download / share / delete on the just-created thread to
   confirm they work (download produces an .md, share copies a link, delete
   removes the thread and closes the panel).
4. Submit a follow-up question on the just-created ask thread; verify it goes
   through the follow-up path (no duplicate thread created in the list).
5. Open an existing thread from the list — confirm the original
   reopen-from-list flow still works (title + icons present, capture loaded).
6. Trigger a creation error (e.g., kill the network mid-POST): confirm the
   header falls back to "New entry" / "Ask AI" with no icons, as today.
