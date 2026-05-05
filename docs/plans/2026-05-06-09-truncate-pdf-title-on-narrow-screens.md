# Truncate PDF title on small screens & drop "Library" text

## Context

On narrow viewports the PDF reader header sometimes spills onto a second
row, eating vertical space. Root cause: the header is `flex flex-wrap`,
so when the right-hand control cluster (page nav + zoom + sidebar
toggle) plus the title can't all fit on one line, the controls wrap
below. The title `<span>` already has `truncate min-w-0`, but
`flex-wrap` short-circuits that — it prefers wrapping over shrinking.

The user wants:
1. The title to truncate (with ellipsis) when space is tight, so the
   header stays a single row.
2. The " Library" text removed entirely (the back-arrow `←` stays) to
   recover horizontal space on every screen size — even though the
   text is already hidden below `md`, removing it everywhere is the
   ask.

## Changes

File: `components/Reader.tsx`

### 1. Header — disable wrap (line 969)

Drop `flex-wrap` and the now-unused `gap-y-1`. Keep `justify-between`
so the title group and controls cluster sit at opposite ends.

Before:
```tsx
<header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-200 bg-white px-4 py-2 print:hidden dark:border-zinc-800 dark:bg-black">
```

After:
```tsx
<header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 print:hidden dark:border-zinc-800 dark:bg-black">
```

The left group already has `flex min-w-0 flex-1 items-center gap-3`
and the title has `truncate min-w-0` (lines 970, 977), so once wrapping
is off the title naturally ellipsizes when the controls claim more
room.

### 2. Back link — drop "Library" text (line 975)

Before:
```tsx
←<span className="hidden md:inline"> Library</span>
```

After:
```tsx
←
```

This removes the text on `md+` screens (small screens already had it
hidden) and saves horizontal space the title can claim.

## Verification

1. `npm run dev` and open a PDF book.
2. Resize the browser narrow (≤ 400px) — confirm the header stays one
   line and the title shows an ellipsis when it's too long. Confirm no
   "Library" text appears.
3. Widen to desktop — confirm "Library" text is gone there too, the
   `←` remains clickable, and the layout otherwise looks unchanged.
4. Click `←` to confirm it still navigates back to `/`.
5. Sanity-check the right-side controls (prev/next, page input, zoom
   popover, sidebar toggle) still render and work at narrow widths;
   the title is what shrinks, not the controls.
