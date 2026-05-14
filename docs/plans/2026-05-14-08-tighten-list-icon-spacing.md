# Tighten icon spacing in PDF list rows

## Context

The library list view (`app/page.tsx`) renders each book as a row with three action icons on the right: Delete, Download all threads, Export book data. The icons currently feel too far apart.

Cause (in `app/page.tsx:198`): the three buttons are siblings of the `pages · timestamp` span inside `<div className="flex items-center justify-between gap-3 md:contents">`.

- On mobile: `justify-between` distributes leftover row width *between every adjacent pair*, so the gaps between the icon buttons balloon well past the nominal `gap-3` (12px) — easily 30–40px on a phone.
- On md+: the wrapper collapses via `md:contents`, so the three buttons become direct children of the `<li>` whose row has `md:gap-4` (16px) between every adjacent item, including between icons.

## Approach

Wrap the three icon buttons in a single flex container with a small internal gap. That way the icons cluster as one toolbar-like unit and stop participating in the `justify-between` / `md:gap-4` distribution.

## Change

In `app/page.tsx`, around lines 198–315 (inside the `books.map` row), replace:

```tsx
<div className="flex items-center justify-between gap-3 md:contents">
  <span ...>pages · timestamp</span>
  <button ...>delete</button>
  <button ...>download</button>
  <button ...>export</button>
</div>
```

with:

```tsx
<div className="flex items-center justify-between gap-3 md:contents">
  <span ...>pages · timestamp</span>
  <div className="flex items-center gap-1">
    <button ...>delete</button>
    <button ...>download</button>
    <button ...>export</button>
  </div>
</div>
```

Notes:

- `gap-1` (4px) inside the cluster — the buttons are already `h-8 w-8` / `md:h-7 md:w-7` with 16px icons, so they have 8px of internal padding on each side. `gap-1` gives roughly 20px between icon glyphs, down from ~32–40px today on mobile and 32px on md+.
- The outer wrapper still uses `md:contents`, so on md+ the cluster sits as one item in the `<li>`'s flex row at `md:gap-4` from the timestamp span — title‑to‑timestamp spacing is preserved.
- On mobile, `justify-between` still pushes the timestamp left and the cluster right; the icons stop being individually spread.
- The new wrapping `<div>` should not get `shrink-0`; the inner buttons already have `shrink-0`.

## Critical files

- `app/page.tsx` — only file modified.

## Verification

1. `npm run dev`, open `/`, confirm a book row shows the three icons tightly grouped on the right.
2. Resize between mobile (<768px) and desktop widths; in both cases icons should sit close to each other while the timestamp stays anchored opposite the title/title-area.
3. Click each icon and confirm Delete / Download all threads / Export book data still trigger and the spinner state (replaces the icon while pending) still renders without layout jump.
4. `npm run lint` and `npx tsc --noEmit` for safety, though this is a pure JSX/className change.
