# Replace "Delete" text with trash icon in library list

## Context

On the library page (`/`), each book row has a `Delete` button rendered as plain text (with a `Deleting…` text variant during the in-flight delete). The user wants this swapped for a trash icon, matching the icon style used elsewhere in the app.

The `ConversationPanel` component already has the exact pattern we want — a trash SVG for the idle state and a spinner SVG for the in-flight state, both inline (no icon library is used in this project). We will reuse those SVGs verbatim so the library button matches the existing visual language.

## Files to modify

- `app/page.tsx` (lines 118–125) — only this file changes.

## Change

Replace the current button body:

```tsx
<button
  type="button"
  onClick={() => onDelete(b)}
  disabled={isDeleting}
  className="shrink-0 rounded px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-600 active:bg-zinc-200 disabled:opacity-50 md:px-2 md:py-1 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
>
  {isDeleting ? "Deleting…" : "Delete"}
</button>
```

with an icon-only button:

- Use the same trash SVG from `components/ConversationPanel.tsx:995-1009` for idle.
- Use the same spinning SVG from `components/ConversationPanel.tsx:981-993` for the deleting state.
- Switch the button to a square icon container (`inline-flex h-8 w-8 items-center justify-center` plus `md:h-7 md:w-7`) so padding makes sense without text — this matches the icon-button sizing already used in `ConversationPanel.tsx:1014-1019`.
- Add `aria-label` and `title` (`"Deleting…"` / `"Delete"`) so the button stays accessible and tooltipped now that the visible label is gone.
- Match the always-red color treatment used by the conversation panel's trash button (`ConversationPanel.tsx:978`): `text-red-600 hover:text-red-800 active:opacity-70 dark:text-red-400 dark:hover:text-red-300`. No hover background — the icon itself signals affordance.

No other behavior changes: `onDelete(b)` and the `isDeleting` flag continue to drive the click and disabled state.

## Verification

- `npm run lint` and `npm run build` (or `npx tsc --noEmit`) to confirm no type/lint regressions.
- `npm run dev`, open `/`, confirm:
  - The book row shows a red trash icon in place of the word "Delete"; tooltip reads "Delete".
  - Hover darkens the icon (red-800 in light, red-300 in dark) — same treatment as the conversation panel trash button.
  - Clicking it triggers the existing confirm flow; while deleting, the icon swaps to the spinner and the button is disabled.
