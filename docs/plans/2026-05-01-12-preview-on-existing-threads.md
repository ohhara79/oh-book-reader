# Show captured image + extracted text when reopening a thread

## Context

After the previous fix (`2026-05-01-11-keep-preview-after-ask.md`) the `PreviewBox` (captured image + extracted text) stays visible while a *new* selection is being asked about. But once the user closes the panel and reopens the same thread by clicking its amber pin, `active` transitions from `{ kind: "new", capture }` to `{ kind: "existing", conversationId }`. The existing-conversation render path never showed `PreviewBox`, so:

- The captured image still appears as a thumbnail inside the first user message bubble (via `imagePreviewDataUrls`).
- The extracted selection text disappears entirely — it's persisted in the user turn as a "Selected text from page N: ..." text block, but `turnsToDisplay()` (line 567) strips everything before `Question:` to keep the bubble clean.

The user's complaint: a thread looks "different from the original" after coming back to it — the original image+text panel is gone.

## Approach

Restore the same `PreviewBox` for existing threads by having the GET conversation endpoint also return the linked `Selection` (with images base64-encoded), and rendering `PreviewBox` from that data on the client.

Selection data is already persisted on disk:
- `data/books/{bookId}/selections/{selectionId}.json` — `Selection` with `spans: { page, bbox, extracted_text, surrounding_text }[]`
- `data/books/{bookId}/selections/{selectionId}_{i}.png` — span images

The follow-up message route already does this reconstruction (`loadSelectionAsPromptSpans` in `app/api/conversations/[id]/messages/route.ts:41-57`), but for prompt-building only. We just need the same data shipped to the client.

## Changes

### 1. `app/api/conversations/[id]/route.ts`

`GET` now also loads the conversation's `Selection`, reads each span's PNG, and returns:

```ts
{ bookId, conversation, capture: { spans: [{ page, bbox, imageBase64, imageMediaType, selectionText, surroundingText }] } | null }
```

Wrapped in try/catch — if the selection JSON or PNGs are missing/unreadable (e.g. legacy data, manual deletion), `capture` is `null` and the conversation still loads.

### 2. `components/ConversationPanel.tsx`

- Added `existingCapture: CapturedSelection | null` state.
- In the `kind: "existing"` load branch, parse `capture` from the response and store it.
- Reset to `null` on every `active` change alongside the other state resets.
- Render `<PreviewBox capture={existingCapture} />` whenever `active.kind === "existing" && existingCapture` — directly below the existing `kind: "new"` `PreviewBox` line, so the layout matches.

No type changes elsewhere. The existing `CapturedSelection` shape (from `SelectionOverlay.tsx`) is reused as the response type for `capture`.

## Note on duplication

As with the previous fix, the user's first message bubble still shows the image thumbnail underneath the new `PreviewBox`. Acceptable: `PreviewBox` is the persistent "what we're looking at" reference; the bubble is the "what I asked" record. Out of scope to deduplicate.

## Verification

1. `npm run dev`, open a PDF, drag a selection, click **Ask**, wait for response.
2. Click another pin (or close the panel), then click the original pin again.
3. Confirm the original captured image and extracted text appear at the top of the panel, identical to when the thread was first created.
4. Confirm follow-up Ask and Memo still work for the reopened thread.
5. Open a thread whose selection.json is missing (simulate by deleting the file): conversation still loads, just without `PreviewBox`.
6. `npx tsc --noEmit` clean.
