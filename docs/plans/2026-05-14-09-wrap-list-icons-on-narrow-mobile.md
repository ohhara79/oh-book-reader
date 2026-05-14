# Wrap list-row icons to a new line on narrow mobile

## Context

After the recent change to cluster the three action icons (Delete, Download all threads, Export book data) inside a `gap-1` flex wrapper in `app/page.tsx`, the cluster overflows the viewport on narrow phones. On a 360px-wide screen with the `<main>`'s `p-6` padding (312px content), the timestamp span (~200px, `shrink-0`) plus `gap-3` (12px) plus the three 32px buttons with `gap-1` (104px) is ~316px — already over. On 320px screens the export icon is largely cut off.

Root cause (`app/page.tsx:198–202`): the row-2 inner container is `flex items-center justify-between gap-3 md:contents`. The cluster `<div>` inside has no `shrink-0` and gets `flex-shrink: 1` by default, but its 3 `shrink-0` buttons can't actually shrink — so the buttons overflow the cluster box and the row. Confirmed.

`formatTimestamp` (`lib/formatTimestamp.ts`) returns `YYYY/MM/DD HH:MM:SS` (19 chars, fixed), so there's no headroom from shortening the timestamp.

## Approach

Let the icon cluster wrap to its own line when there isn't room for both. Keep the icons right-aligned whether they wrap or not, so the mental model ("metadata on the left, actions on the right") survives.

Use the standard `flex-wrap + justify-end + mr-auto` idiom: `justify-end` aligns the lone wrapped item to the right; `mr-auto` on the timestamp span eats the leftover horizontal space when both items share one line, putting them at opposite ends like today's `justify-between`.

The wrapper still collapses on md+ via `md:contents`, so desktop layout is unchanged. The `mr-auto` on the span is inert on md+ because the `<li>`'s `flex-1` Link already eats the leftover space.

There is precedent for `flex-wrap` in `components/KeyboardShortcutsDialog.tsx` (`<span className="flex shrink-0 flex-wrap items-center gap-1">`).

## Change

In `app/page.tsx`, two class edits inside the books `.map(...)` row (around lines 198–199):

1. Line 198 — replace
   ```
   <div className="flex items-center justify-between gap-3 md:contents">
   ```
   with
   ```
   <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 md:contents">
   ```
   Notes: `gap-x-3` preserves the existing 12px horizontal spacing; `gap-y-1` (4px) gives a touch of vertical space when the cluster wraps below. `justify-end` keeps the wrapped icon row right-aligned.

2. Line 199 — add `mr-auto` to the timestamp span:
   ```
   <span className="mr-auto shrink-0 text-xs text-zinc-500">
   ```
   When timestamp + cluster fit on one line, `mr-auto` pushes the cluster to the right end (matching today's `justify-between` behavior). When they don't fit, the cluster wraps to the next line and `justify-end` aligns it right.

No changes needed inside the icon cluster (`flex items-center gap-1` stays as-is) or to any button.

## Critical files

- `app/page.tsx` — only file modified, two class strings.

## Verification

1. `npm run dev`, open `/` on a desktop browser at md+ (≥768px) widths — confirm the row layout is unchanged: title left, timestamp + 3 icons on the right separated by `md:gap-4`, icons clustered tight at `gap-1`.
2. Use Chrome/Firefox responsive mode at 360px and 320px viewports — confirm:
   - 360px: timestamp and icons share row 2, icons flush right; no horizontal scroll, export icon fully visible.
   - 320px: icon cluster wraps onto a row 3 below the timestamp, flush to the right edge of the content area; export icon fully visible; no horizontal scroll on the `<main>` or page.
3. Resize between the two widths and watch the wrap transition — no jitter, no overlap between the timestamp and cluster.
4. Click each icon at both widths (Delete / Download all threads / Export book data) — confirm they still fire, the spinner state replaces the icon in place, and the layout doesn't jump.
5. `npx tsc --noEmit` for safety (pure className change, should pass).
