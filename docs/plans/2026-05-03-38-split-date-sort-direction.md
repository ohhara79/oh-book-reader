# Split "Date" sort into ascending and descending menu items

## Context

Today the thread-list sort menu has two items: **Page** and **Date**. The Date option always sorts descending (newest first, `components/ThreadList.tsx:131–137`) and gives the user no way to flip the direction.

We're splitting Date into two explicit menu items so the user can pick either direction. The labels describe the *outcome* rather than the field — the menu sits behind a sort icon, so saying "Date" twice adds no information, while "Newest first" / "Oldest first" is unambiguous (the arrow convention for time is easy to misread):

- **Newest first** — descending by `updated_at` (preserves today's behavior, listed first since it's the more common action for an activity list)
- **Oldest first** — ascending by `updated_at`

The default sort stays `page` (no change to the app's initial sort). Existing users whose persisted sort is `"date"` continue to see newest-first after the upgrade — `"date"` migrates to `"date-desc"`.

## Critical file

- `components/ThreadList.tsx` — single file, all changes live here.

## Changes

### 1. Extend the `SortMode` type — line 28

```ts
type SortMode = "date-desc" | "date-asc" | "page";
```

### 2. Migrate persisted state — `useState<SortMode>` initializer at lines 78–84

Accept the two new values, and migrate the legacy `"date"` value to `"date-desc"` (matches the prior behavior, so no user-visible change on upgrade):

```ts
const [sort, setSort] = useState<SortMode>(() => {
  const stored = readThreadListState();
  if (stored?.sort === "date-desc" || stored?.sort === "date-asc" || stored?.sort === "page") {
    return stored.sort;
  }
  if (stored?.sort === "date") return "date-desc";
  return "page";
});
```

`StoredThreadListState` (line 32) keeps `sort?: SortMode` — TypeScript will narrow legacy values away on read; the explicit `=== "date"` check above handles the migration. No need to widen the stored type.

### 3. Sort logic — lines 129–152

Replace the single `if (sort === "date")` branch with one that handles both directions. Page sort is unchanged.

```ts
if (sort === "date-desc" || sort === "date-asc") {
  const dir = sort === "date-desc" ? -1 : 1;
  rows.sort((a, b) => {
    if (a.conv.updated_at !== b.conv.updated_at) {
      return dir * (a.conv.updated_at - b.conv.updated_at);
    }
    return a.conv.id < b.conv.id ? -1 : 1;
  });
} else {
  // existing page-sort branch unchanged
}
```

The id tiebreaker stays ascending in both directions — it's just a deterministic stable-sort key, not a user-visible ordering.

### 4. Label for the trigger button's `title` tooltip — line 197

```ts
const sortLabel =
  sort === "date-desc" ? "Newest first" :
  sort === "date-asc"  ? "Oldest first" :
  "Page";
```

This feeds into `title={`Sort: ${sortLabel}`}` on line 236, so hovering the sort button will show e.g. `Sort: Newest first`.

### 5. Menu items — lines 237–254

Replace the two items with three, in this order (Page first as today, then newest-first, then oldest-first):

```tsx
items={[
  {
    label: "Page",
    selected: sort === "page",
    onSelect: () => { setSort("page"); setOpenMenu(null); },
  },
  {
    label: "Newest first",
    selected: sort === "date-desc",
    onSelect: () => { setSort("date-desc"); setOpenMenu(null); },
  },
  {
    label: "Oldest first",
    selected: sort === "date-asc",
    onSelect: () => { setSort("date-asc"); setOpenMenu(null); },
  },
]}
```

No changes to `IconMenu` (lines 436–493), no new icons. The persisted state keys stay `"date-desc"` / `"date-asc"` — they don't need to match the user-visible labels.

### 6. `active` prop on the sort `IconMenu` — line 233

`active={sort !== "page"}` already handles the new states correctly (any non-page sort is "active"). No change.

## Out of scope

- No change to the default sort (stays `"page"`).
- No change to the page-sort branch's internal date tiebreaker (line 145–147) — it remains descending, since that's an internal disambiguation, not a user-chosen direction.
- No changes to `IconMenu` itself or any new icon assets.

## Verification

1. **Cold start with no localStorage**: open a book, click the sort menu → see `Page`, `Newest first`, `Oldest first` in that order, with `Page` checkmarked.
2. **Pick `Newest first`**: list reorders newest-first; checkmark moves; reload the page → `Newest first` is still selected (persisted as `"date-desc"`).
3. **Pick `Oldest first`**: list reorders oldest-first; reload → `Oldest first` is still selected.
4. **Migration**: in DevTools, set `localStorage` key `ohbr.threadList` to `{"filter":"page","sort":"date"}` and reload → menu shows `Newest first` selected and list is newest-first (no surprise change for existing users).
5. **Trigger tooltip**: hover the sort button — `title` reads `Sort: Newest first`, `Sort: Oldest first`, or `Sort: Page` accordingly.
6. **Type check / build**: `npm run build` (or whatever the project uses) — `SortMode` is referenced by `setSort` consumers via `UseThreadListRowsResult` (line 56); the wider union still satisfies all callers since they only ever call `setSort(literal)`.
