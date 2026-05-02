# Wrap long thread titles instead of truncating with `…`

## Context

Conversation thread titles currently get clipped with an ellipsis when they
overflow their container. The user wants the full title to remain visible by
wrapping onto multiple lines instead.

The truncation is produced by the Tailwind `truncate` utility
(`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) applied in two
places that render a thread title. A third occurrence (the print-only `<h1>`)
already wraps naturally and needs no change.

## Changes

### 1. `components/ThreadList.tsx` — sidebar list row (line 215)

Replace the `truncate` class on the title `<span>` so the title wraps:

```tsx
// before
<span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
// after
<span className="break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
```

The surrounding row is `flex items-baseline justify-between gap-2` and the
right-hand page badge has `shrink-0`, so when the title wraps:
- the badge stays aligned with the first line of the title (because of
  `items-baseline`),
- the row grows downward to fit the wrapped title.

`break-words` (`overflow-wrap: break-word`) is added so an unusually long
unbroken token (e.g. a URL-like title) still breaks rather than overflowing the
button horizontally.

### 2. `components/ConversationPanel.tsx` — panel header rename button (line 479)

Same swap on the header button that displays the active thread's title:

```tsx
// before
className="block w-full truncate rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
// after
className="block w-full break-words rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
```

The parent header row is `flex items-center justify-between gap-2` with the
title in a `min-w-0 flex-1` cell, so the right-hand controls re-center
vertically as the title grows to multiple lines. The clickable rename target
also becomes the full multi-line title, which is the existing behaviour just
expanded vertically.

### 3. Print `<h1>` (`components/ConversationPanel.tsx` line 632)

No change — this heading has no truncation classes and already wraps.

## Files to modify

- `components/ThreadList.tsx` (1 class change, line 215)
- `components/ConversationPanel.tsx` (1 class change, line 479)

## Verification

1. `npm run dev` (or whatever dev script the project uses) and open the app.
2. Create or pick a thread and rename it to something very long (e.g.
   "A very long thread title that would previously have been truncated with an
   ellipsis on smaller widths"). Confirm:
   - In the sidebar `ThreadList`, the title wraps onto multiple lines and the
     page-range badge stays on the first line, right-aligned.
   - In the conversation panel header, the title wraps onto multiple lines and
     the header grows vertically; right-side controls remain visible and
     vertically centred.
3. Try an unbroken long token (e.g. a long URL with no spaces) as the title to
   confirm `break-words` prevents horizontal overflow.
4. Narrow the window to a small width and confirm both views still wrap
   cleanly with no clipping.
