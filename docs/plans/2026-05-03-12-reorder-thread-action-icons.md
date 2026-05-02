# Reorder conversation thread action icons

## Context

The conversation thread header currently renders action icons in the order **download, share, delete, close**. This places the destructive **delete** button immediately adjacent to the **close** button. Both sit at the right edge of the header, so a misclick on close can hit delete instead — a bad failure mode for a destructive action.

Well-designed apps (Gmail, Linear, Slack, Notion) keep destructive actions visually separated from dismissive ones. Move **delete** to the far left of the icon group so the order becomes **delete, download, share, close**: destructive on one end, dismissive on the other, related export actions grouped in the middle.

## Approach

Pure JSX sibling reorder — no logic, props, handlers, styles, or conditional gating change. Delete stays inside the same `{conversationId && rawConversation && (...)}` fragment, so its visibility behavior is unchanged. The parent flex container's `gap-1` keeps spacing uniform after the move.

### Critical file

- `components/ConversationPanel.tsx` — only file touched (header icon flex container at lines 958–1093).

### Change

Inside the fragment at lines 961–1068, move the **delete** `<button>` block (currently lines 1028–1067) to be the first child of the fragment, ahead of the **download** `<button>` (lines 962–985).

Resulting JSX order inside `<div className="ml-auto flex items-center gap-1">`:

```jsx
{conversationId && rawConversation && (
  <>
    <button /* delete   — was lines 1028–1067 */ />
    <button /* download — was lines 962–985  */ />
    <button /* share    — was lines 986–1027 */ />
  </>
)}
<button /* close — unchanged, lines 1070–1091 */ />
```

## Verification

1. `npm run dev` and open a book with at least one saved conversation thread.
2. Open the conversation panel and confirm the icon order in the header reads left-to-right: **delete, download, share, close**.
3. Click each icon and confirm behavior is unchanged:
   - Delete → confirms and removes the thread (red icon, spinner while `deleting`).
   - Download → exports markdown.
   - Share → copies share link (checkmark on `copied`).
   - Close → closes the panel.
4. Confirm the icons are still hidden / shown by the same conditions: download/share/delete only when `conversationId && rawConversation`; close always when `active`.
5. Sanity-check dark mode — delete keeps its red tint, others keep zinc tint.
