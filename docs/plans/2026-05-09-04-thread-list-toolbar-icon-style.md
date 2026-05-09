# Match filter/sort icons to font-zoom icon style in thread list toolbar

## Context

In the conversation panel's thread list view, three buttons sit in the right-side toolbar: font-zoom (`aA`), filter, and sort. Today they use two different visual styles:

- **Font-zoom** (`components/ConversationPanel.tsx:139`, inside the `FontZoomMenu` subcomponent): ghost — `text-zinc-500 hover:text-zinc-900`, no border, no background.
- **Filter / Sort** (`components/ThreadList.tsx:515-519`, the shared `IconMenu` component): outlined — `border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100`, plus an inverse "active" style (`bg-zinc-900 text-white`) when the filter/sort is set away from default.

The font-zoom button intentionally matches its neighbors in the conversation header (delete, download, share, close — all ghost). To make the thread-list toolbar internally consistent without disturbing the conversation header, **convert filter and sort to ghost style** and drop their bordered active-state inverse coloring. The user explicitly accepted that the active filter/sort will no longer pop out via inverse colors; the popover checkmark and `title` attribute still convey current selection.

The font-zoom button stays as-is.

## Plan

### `components/ThreadList.tsx`

1. **Strip the `active` prop from `IconMenu`** (currently `active: boolean`).
   - Remove the `active` field from the destructure (line 496) and from the typed props block (line 504).
   - Replace the conditional `active ? "..." : "..."` className expression at lines 515–519 with a single ghost className matching `FontZoomMenu`'s button:
     ```tsx
     className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 dark:hover:text-zinc-100"
     ```
     Note: the `active:opacity-70` here is Tailwind's `:active` pseudo-class (pressed state), unrelated to the just-removed `active` prop.

2. **Drop the `active={…}` arguments at the two `IconMenu` call sites** in `ThreadListControls` (lines 218 and 244). They become unused after step 1.

No new files. No other components are touched — the conversation-view toolbar is unaffected.

## Critical files

- `components/ThreadList.tsx` — `IconMenu` (lines 493–550) and `ThreadListControls` (lines 215–274).

## Verification

- `npx tsc --noEmit` — type check passes (the removed prop must not be referenced anywhere else).
- `npx next build` — compiles cleanly.
- Manual:
  - Open the conversation panel without an active thread (list view visible). Confirm font/filter/sort buttons share the same ghost style: no border, no fill, hover changes text color from zinc-500 to zinc-900.
  - Toggle filter to "All pages" and sort to "Newest first". Confirm the buttons stay ghost-style (no inverse fill); the popover menu still shows a checkmark on the active option.
  - Open a conversation. Confirm the conversation-view toolbar (delete / font / download / share / close) is unchanged.
