# Reorder sort menu items: Page before Date

## Context

The sort icon menu in the thread list controls currently lists "Date" first and "Page" second. Since "Page" is the default sort order, it should appear first in the menu so the default option leads. This is a simple reordering of two menu items — no logic or behavior changes.

## File to modify

- `components/ThreadList.tsx` (lines 237–254)

## Change

In the `items` array passed to the sort `IconMenu`, swap the two item objects so "Page" comes before "Date". Each item object's contents (`label`, `selected`, `onSelect`) stay exactly as-is — only their order in the array changes.

After the change, the array should be:

```tsx
items={[
  {
    label: "Page",
    selected: sort === "page",
    onSelect: () => {
      setSort("page");
      setOpenMenu(null);
    },
  },
  {
    label: "Date",
    selected: sort === "date",
    onSelect: () => {
      setSort("date");
      setOpenMenu(null);
    },
  },
]}
```

Nothing else needs to change:
- `sortLabel` (line 197), the `SortIcon` (lines 513–531), and the `active` / `title` props are all derived from the `sort` state, not from menu order.
- Default sort state is unchanged.

## Verification

- Open the app, click the sort icon in the thread list controls, and confirm the menu shows "Page" on top and "Date" below.
- Confirm selecting either entry still toggles the sort and closes the menu as before.
