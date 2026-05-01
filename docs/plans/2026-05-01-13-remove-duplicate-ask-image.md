# Remove duplicate captured image from the ask message bubble

## Context

After `2026-05-01-12-preview-on-existing-threads.md`, the `PreviewBox`
(captured image + extracted selection text) renders at the top of the
conversation panel for both new selections and reopened existing threads.
That plan explicitly deferred deduplication: "the user's first message
bubble still shows the image thumbnail underneath the new `PreviewBox`.
Acceptable… Out of scope to deduplicate."

In practice the result looks redundant — the same PNG appears twice in
close succession (once in `PreviewBox`, once inside the first "ask · …"
bubble). This plan finishes the cleanup by removing the bubble's copy so
`PreviewBox` is the single place the captured image is shown in the panel.

## Approach

All edits are in `components/ConversationPanel.tsx`. The
`imagePreviewDataUrls` field on `DisplayMessage` is only consumed by
`MessageBubble`, so it can be removed end-to-end (type field, both
producers, and the render block) rather than just hidden.

No backend, API, or storage changes. Image data still flows to Claude via
the API request body in `startNewConversationAsk` and is still stored in
each conversation's content blocks — only the duplicate *display* in the
user bubble is removed.

## Changes

### `components/ConversationPanel.tsx`

- Drop `imagePreviewDataUrls?: string[]` from the `DisplayMessage` `user |
  assistant` variant.
- In `startNewConversationAsk`, remove the `imagePreviewDataUrls:
  cap.spans.map(...)` field from the optimistic user message.
- In `turnsToDisplay`, remove the `imagePreviewDataUrls` accumulator, the
  `block.type === "image"` branch, and the field on the returned object.
  The text-extraction loop and `Question:` strip stay unchanged.
- In `MessageBubble`, delete the `const images = m.imagePreviewDataUrls
  ?? []` line and the `{images.length > 0 && (...)}` JSX block.

`PreviewBox` (and its render at `active?.kind === "new"` / `kind ===
"existing" && existingCapture`) is untouched and continues to display the
captured PNG + selection text for both flows.

## Verification

1. `npx tsc --noEmit` clean — no remaining references to
   `imagePreviewDataUrls` (`grep -r imagePreviewDataUrls` returns nothing).
2. `npm run dev`, then exercise:
   - **New Ask**: drag-select, type a question, click **Ask**. Image shows
     once in the top `PreviewBox`; the user bubble shows only "ask ·
     timestamp" + the question text.
   - **Reopen existing thread**: click an amber pin on a prior Ask. Same —
     image only at the top, no thumbnail in the first bubble.
   - **Multi-page selection**: drag across a page boundary. `PreviewBox`
     shows all spans; user bubble shows none.
   - **Memo flow**: start a Memo, then reopen. Memo entries never had an
     image; behavior unchanged.
   - **Follow-up Ask**: send a second question in an existing thread.
     Follow-up bubbles are unchanged (they never carried images).
