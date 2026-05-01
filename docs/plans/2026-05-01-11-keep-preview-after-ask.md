# Keep captured image + extracted text visible after Ask

## Context

When the user drags a region on a PDF page, `ConversationPanel` shows a `PreviewBox` containing the captured image and the OCR/text-layer extraction for that region. As soon as the user submits an Ask (or Memo), the `PreviewBox` disappears.

The extracted **text** is the most affected: the user message bubble does carry the captured image (via `imagePreviewDataUrls`), but the selection text is only displayed in `PreviewBox` — once `PreviewBox` unmounts, the text is gone from the UI for the rest of the session. This makes follow-up questions awkward because the user loses the very context they were asking about.

The fix should keep the captured image and extracted text visible throughout the new-thread session.

## Root cause

`components/ConversationPanel.tsx:375`

```tsx
{active?.kind === "new" && messages.length === 0 && (
  <PreviewBox capture={active.capture} />
)}
```

`messages.length === 0` is the gate. The first call to `startNewConversationAsk` (line 105) or `startNewConversationMemo` (line 164) appends to `messages` synchronously, flipping the condition to false on the very same render. `active.capture` is still in scope and unchanged — only the render condition hides it.

## Change

Drop the `messages.length === 0` guard so `PreviewBox` stays mounted for the lifetime of a `kind: "new"` active conversation.

**File:** `components/ConversationPanel.tsx:375-377`

Before:
```tsx
{active?.kind === "new" && messages.length === 0 && (
  <PreviewBox capture={active.capture} />
)}
```

After:
```tsx
{active?.kind === "new" && <PreviewBox capture={active.capture} />}
```

That is the entire code change. No new state, no API changes, no type changes. `PreviewBox` already renders above the message list, so it naturally becomes a sticky-feeling header for the thread as messages stream in below it.

### Note on duplication

The user's first Ask message bubble already echoes the captured image thumbnails (`MessageBubble` lines 518–529). After this fix, the same image appears twice on screen: once in `PreviewBox` at the top, once inside the user bubble. This is intentional and acceptable — the `PreviewBox` is the persistent "what we're looking at" reference; the bubble is a record of "what I asked." The duplicate confirms to the user that the image was indeed sent with the question. Out of scope to deduplicate.

## Out of scope

- **Existing conversations** (`active.kind === "existing"`): when the user reopens a thread by clicking an amber pin, `PreviewBox` is not rendered at all — the captured image still shows inside each user message bubble, but the extracted selection text is not surfaced (it's stripped from the user turn by the `Question:` regex in `turnsToDisplay`, line 567). The user's complaint is specifically about losing the preview after asking a question on a new selection; persisting/reconstructing the preview for reopened threads would require carrying selection metadata through the GET conversation API and is a larger change. Flagging as a possible follow-up, not part of this fix.
- No backend changes. `app/api/conversations/route.ts` already persists spans correctly.

## Verification

1. `npm run dev` and open a PDF in the reader.
2. Drag a rectangle over a region with text. Confirm `PreviewBox` appears in the right panel showing the captured image and extracted text.
3. Type a question and click **Ask**. While the response streams: confirm `PreviewBox` stays visible at the top of the panel; the user bubble + streaming assistant bubble appear below it.
4. After the response completes, type a follow-up and click **Ask** again. Confirm `PreviewBox` is still visible.
5. Click **Memo** instead on a fresh selection. Confirm `PreviewBox` stays visible after the memo entry appears.
6. Close the panel, reopen the thread by clicking the pin. Confirm behavior matches existing — no regression (PreviewBox does not appear for existing threads, as before; out of scope).
7. `npx tsc --noEmit` to confirm no type regressions.
