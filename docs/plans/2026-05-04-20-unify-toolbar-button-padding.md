# Unify toolbar button padding across mobile and desktop

## Context

In the reader header, the `<` (prev page), `>` (next page), `-` (zoom out), and `+` (zoom in) buttons appear visibly larger on mobile than on desktop. The SVG icons themselves are pixel-identical on both viewports (hardcoded `width="16" height="16"`), so the perceived difference is the **button** size, not the icon size: each of the four buttons uses `px-3 ... md:px-2`, giving 12px horizontal padding on mobile and 8px on desktop.

This was almost certainly intentional (a common mobile-first pattern: roomier tap targets on touch, more compact controls on desktop). The user wants the buttons to look the same on both, and chose to **match desktop** — i.e. shrink mobile to `px-2`. The `h-8` height (32px) is already identical on both viewports, so vertical tap-target size is unchanged.

## Change

In `components/Reader.tsx`, change the className on each of the four toolbar icon buttons from `... px-3 ... md:px-2 ...` to `... px-2 ...` (drop the responsive padding).

### File and exact lines

`components/Reader.tsx`

- Line 926 — Previous page button (`goPrev`)
- Line 984 — Next page button (`goNext`)
- Line 1007 — Zoom out button (`stepScale(-0.2)`)
- Line 1031 — Zoom in button (`stepScale(0.2)`)

### Diff sketch

For each of the four buttons, transform:

```
className="flex h-8 items-center rounded border px-3 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 md:px-2 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

into:

```
className="flex h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

(The zoom buttons don't have `disabled:opacity-50`; otherwise the transform is identical — drop `px-3`, drop `md:px-2`, add `px-2`.)

## Out of scope (deliberately not changing)

- The header gap (`gap-1 ... md:gap-2` at line 922) — affects spacing between buttons, not button size. Not what the user asked about.
- The SVG dimensions — already identical on both viewports.
- The `←` Library link (line 916) — uses no responsive padding, so it's not relevant here.
- The sidebar toggle button (line 1059) — already uses plain `px-2` and is hidden on mobile.

## Verification

1. `npm run dev` (or whichever dev script the project uses) and open the reader for a book.
2. Use the browser devtools device-toolbar to compare a narrow viewport (≤767px) against a desktop viewport (≥768px). The four toolbar buttons (`<`, `>`, `-`, `+`) should now be the same width on both.
3. Confirm on a real touch device that the buttons are still comfortable to tap (they remain 32px tall; only horizontal padding shrinks by 4px per side).
4. Sanity-check that the page-number input + `/ N` span (line 945) still aligns flush against the prev/next buttons — it has no horizontal-padding responsive change so spacing should remain consistent.
