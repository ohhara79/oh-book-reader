# Hide image/text-only toggle after first question is asked

## Context

When a user selects a region in the PDF view, the composer shows an icon that toggles whether the captured image is sent with the question (vs. text-only). That icon is meaningful only *before* the first question is asked — once "Ask" is clicked, the `textOnly` value is captured into the API request body and the conversation is created with that flag baked in. Toggling afterwards has no effect on the conversation.

Today the icon stays visible after the first question, giving the false impression that the option is still adjustable. The user wants the icon to disappear once it's no longer functional.

Why hide vs. disable: the toggle is a *pre-submission* affordance. Once the conversation exists, the option no longer applies (there's no "switch this thread's first turn to text-only"). A greyed-out button still invites clicks and explanation; removing it is cleaner.

## Files to modify

- `components/ConversationPanel.tsx` (one conditional, line 2010)

## Change

Tighten the existing visibility gate on the toggle button so it also requires that no message has been sent yet.

`components/ConversationPanel.tsx:2010`

```tsx
// before
{active?.kind === "new" && (

// after
{active?.kind === "new" && messages.length === 0 && (
```

### Why `messages.length === 0` is the right signal

- `messages` is reset to `[]` whenever `active` changes (`ConversationPanel.tsx:616`), so a fresh region selection always starts with `messages.length === 0`.
- For a new-conversation flow, the first state change after the user clicks "Ask" is an optimistic append of the user turn + empty assistant turn (`ConversationPanel.tsx:821`). This happens *before* the network request, so the icon hides immediately on click — no flicker, no race with `onMeta`/`conversationId`.
- `active.kind` is *not* a usable signal here: the parent `Reader` never flips `active` from `"new"` to `"existing"` for this flow (verified — `setActive(...existing...)` is only invoked by pin / thread-list flows). So relying on `active.kind` alone is what causes the current bug.
- Alternatives considered and rejected:
  - `!conversationId` — set later (in the `onMeta` callback, `ConversationPanel.tsx:855-857`), so there'd be a brief window after "Ask" where the icon is still visible.
  - `newConvSentRef.current` — a ref; doesn't trigger re-render.
  - `busy` flag — only true during streaming, not after.

## Out of scope

The underlying behavior (that toggling after submission silently does nothing) is fixed implicitly by hiding the control. The user did not ask to add a separate "edit textOnly on existing turn" feature, and the conversation has already been created with the chosen value, so this is the correct minimal change.

## Verification

1. `npm run dev` and open a book.
2. Select a region in the PDF — confirm both the eye (preview) icon and the image/text-only icon are visible in the composer toolbar.
3. Click the image/text-only icon a few times — confirm it toggles between the two SVG variants and that the preview reflects the change.
4. Type a question and click "Ask":
   - Confirm the image/text-only icon disappears immediately (as the optimistic user message appears).
   - Confirm the eye/preview icon, attach button, and reference-thread button all remain visible.
5. While the answer streams and after it completes, confirm the image/text-only icon stays hidden.
6. Open an existing thread from the thread list (a thread that was created from a region) — confirm the image/text-only icon is not shown there either (existing behavior, unchanged).
7. Start a *new* region selection on the same book — confirm the icon reappears for the fresh capture.
