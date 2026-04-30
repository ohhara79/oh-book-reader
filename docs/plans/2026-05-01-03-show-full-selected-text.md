# Show full selected-region text in conversation preview

## Context

When the user selects a region on the PDF, the conversation panel shows a "Selected region" preview box containing a snapshot image of the selection plus the extracted text from the PDF's text layer. Today that text is visually clamped to 3 lines with a CSS ellipsis, so longer selections are truncated. The user wants to see the entire selected text without truncation.

The truncation is purely visual (CSS `line-clamp-3`). The full string is already captured and passed into the component, so this is a one-class change.

## Change

**File:** `components/ConversationPanel.tsx`
**Line:** 322 — `PreviewBox` component

Remove the `line-clamp-3` Tailwind class so the entire `capture.selectionText` renders. Default `<p>` wrapping is fine here since the extraction step at `components/SelectionOverlay.tsx:255` already collapses whitespace via `.replace(/\s+/g, " ").trim()`.

Before:
```tsx
<p className="mt-2 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
  {capture.selectionText}
</p>
```

After:
```tsx
<p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
  {capture.selectionText}
</p>
```

That's the entire change. The conversation panel already scrolls vertically (it's the same scroll container that holds messages), so a long preview will simply make the preview box taller and the user can scroll to the input field below.

## Why nothing else needs to change

- **Extraction** (`SelectionOverlay.tsx:255`) — captures the full text, only normalizes whitespace. No length cap.
- **Data flow** (`ConversationPanel.tsx:256-257`) — passes `capture.selectionText` straight through to `PreviewBox`.
- **Server-side title slice** (`app/api/conversations/route.ts:70`) — slices the user's *question* (not the selection text) to 80 chars for the conversation list title. Unrelated, leave as-is.
- **Image height cap** (`ConversationPanel.tsx:319`, `max-h-40`) — limits the snapshot image height, not text. Leave as-is.

## Verification

1. `npm run dev` and open the reader on a PDF.
2. Select a region containing more than ~3 lines of text (e.g. a long paragraph).
3. Confirm: the conversation panel's "Selected region" preview now shows the full text — no `…` at the end, no clipping.
4. Select a short region (1 line) and confirm it still renders fine without odd spacing.
5. Submit a question and confirm the message thread renders normally afterward (the preview only shows in the `kind === "new" && messages.length === 0` state per `ConversationPanel.tsx:256`, so it should disappear once the conversation has messages — unchanged behavior).
6. Test on the mobile/narrow layout too, since the preview width is constrained there — confirm long text wraps and scrolls cleanly inside the panel.
