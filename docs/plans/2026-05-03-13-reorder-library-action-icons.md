# Reorder library row action icons

## Context

Each book row in the library page currently renders action icons in the order **download, delete**. Putting the destructive **delete** button at the far right means it sits closest to the cursor's natural resting place after scanning the row's title and metadata — easy to misclick for a destructive action.

This mirrors the recent change in `2026-05-03-12-reorder-thread-action-icons.md`, which moved delete away from a neighbor it shouldn't be adjacent to. Apply the same principle here: lead with **delete** so it is visually distinct (red, leftmost) and not the rightmost click target.

## Approach

Pure JSX sibling swap — no handler, prop, style, or condition change. The parent `<div className="flex items-center justify-between gap-3 md:contents">` lays out children purely by source order, so reordering the JSX is sufficient on both mobile (flex) and desktop (`md:contents`).

### Critical file

- `app/page.tsx` — only file touched (book row action buttons at lines 146–229).

### Change

Inside the row's action `<div>` (line 142), swap the two `<button>` blocks so delete renders first:

```jsx
<div className="flex items-center justify-between gap-3 md:contents">
  <span /* page count + timestamp — unchanged */ />
  <button /* delete   — was lines 190–229 */ />
  <button /* download — was lines 146–189 */ />
</div>
```

## Verification

1. `npm run dev` and open `/`.
2. Confirm each book row shows the trash icon (red) immediately before the download icon (zinc).
3. Click each — delete still confirms and removes the book, download still exports all threads.
4. Check both mobile (single-column flex) and desktop (`md:contents` flattened row) layouts.
5. Sanity-check dark mode — delete keeps its red tint, download keeps zinc.
