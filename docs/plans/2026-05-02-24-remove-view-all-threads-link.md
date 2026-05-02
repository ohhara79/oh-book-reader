# Remove redundant "View all threads" button from empty-page state

## Context

In `components/ThreadList.tsx`, when the user is filtering by "This page" and the current page has no threads, the empty state shows:

```
No threads on page 2.
View all threads
```

The "View all threads" link switches the filter from `"page"` to `"all"`. This duplicates the function of the "All pages" filter button that is always visible directly above the empty-state message (lines 162–167). The user wants to remove the redundant link so only `No threads on page N.` is shown.

## Change

File: `components/ThreadList.tsx` (lines 190–208)

Replace the conditional `<>...</>` fragment (lines 193–204) with just `<p>No threads on page {currentPage}.</p>`. The `allRows.length > 0` guard and the `<button>` that calls `setFilter("all")` are deleted.

After the change, the block becomes:

```tsx
{visibleRows.length === 0 ? (
  <div className="rounded border border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
    {filter === "page" ? (
      <p>No threads on page {currentPage}.</p>
    ) : (
      <p>No threads yet.</p>
    )}
  </div>
) : (
  ...
)}
```

No other files reference this button or the inline `setFilter("all")` call from the empty state, so nothing else needs updating.

## Verification

1. Run the dev server.
2. Open a book/page that has at least one thread overall but none on a specific page.
3. Navigate to that page with the "This page" filter active.
4. Confirm the dashed empty-state box shows only `No threads on page N.` with no "View all threads" link beneath it.
5. Confirm the "All pages" filter button above still works to switch to the full thread list.
6. Also verify the "No threads yet." copy (filter = "all", no threads exist anywhere) is unchanged.
