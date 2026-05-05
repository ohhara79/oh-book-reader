# Move delete icon to leftmost position in conversation thread toolbar

## Context

The conversation thread view toolbar (top-right of the active thread) currently has icons in this order, left-to-right:

1. Font size (Aa)
2. Delete (red trash)
3. Download
4. Share

The user wants the delete icon moved to the **leftmost** position to reduce the chance of an accidental tap when reaching for the other toolbar icons. This is a small, low-risk reorder of JSX inside one component — no new behavior, no styling changes.

## File to modify

- `components/ConversationPanel.tsx` — toolbar lives at lines 1132–1214 (font menu wrapper) and 1215–1258 (delete button, inside the `{conversationId && rawConversation && (...)}` fragment that also wraps download + share).

## Change

In `components/ConversationPanel.tsx`, inside the `{active && (...)}` toolbar container starting at line 1133:

1. Lift the **delete button** (currently lines 1217–1258) out of the shared `{conversationId && rawConversation && (<>...</>)}` fragment.
2. Render it as the **first** child of the toolbar `<div className="ml-auto flex items-center gap-1">`, wrapped in its own `{conversationId && rawConversation && (...)}` guard so it preserves the existing visibility condition.
3. Leave the font menu wrapper (`<div ref={fontMenuWrapperRef} ...>`) unchanged — it now becomes the second item.
4. The remaining fragment keeps **only** download and share buttons under the same `{conversationId && rawConversation && (<>...</>)}` guard.

Resulting toolbar order, left-to-right: **Delete → Font size → Download → Share**.

### Notes

- No changes to `onClick`, `aria-label`, `title`, classNames, SVGs, keyboard shortcuts (`Del`), or the deleting-spinner state — the delete button moves verbatim.
- The font popover uses `right-0 top-full` for its absolute positioning (line 1165), so it anchors to the right edge of the font button regardless of the button's horizontal position in the toolbar — no popover positioning changes needed.
- The `gap-1` on the flex container handles spacing automatically between the relocated button and its new neighbor.

## Verification

1. `npm run dev` (or the project's dev command) and open a conversation thread.
2. Confirm toolbar order at the top-right is: Delete (red trash) → Aa → Download → Share.
3. Click the font icon — popover still opens and aligns to the right edge of the Aa button.
4. Click delete — confirms and deletes the thread; spinner shows in the same leftmost slot while `deleting` is true.
5. Open a non-saved / new thread state where `conversationId && rawConversation` is false: verify the delete button is hidden and the font icon appears as the only toolbar control (matching previous behavior).
6. Press the `Del` keyboard shortcut — still triggers delete.
7. Resize to a narrow viewport — toolbar still wraps/aligns correctly with `ml-auto`.
