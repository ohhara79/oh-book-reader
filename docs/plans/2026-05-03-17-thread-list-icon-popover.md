# Replace text toggles with icon + popover in ThreadListControls

## Context

In the conversation thread list view, the filter (`This page` / `All pages`) and sort (`Date` / `Page`) toggles render as four side-by-side text buttons in the panel header (`components/ThreadList.tsx:168-210`). They take up significant horizontal space — especially noticeable when the conversation panel is narrow — and dominate a header that should be quiet.

Replace each pair with a single icon button (funnel for filter, sort-bars for sort). Clicking the icon opens a small popover menu with both options; the current one is checkmarked. The icon button itself uses the existing active-style background when its value is non-default (`All pages` for filter, `Page` for sort), so the user can see at a glance whether the list is in its default view.

Decisions confirmed with the user:

- Interaction: click opens a popover menu (not a click-to-toggle), reusing the AppMenu pattern. More discoverable than a binary toggle.
- State hint: re-use the existing `FilterButton` active styling on the icon button when the value is non-default. No second icon glyph per state.

## Scope

- One file changes: `components/ThreadList.tsx`.
- Public API of `ThreadListControls` (`filter`, `setFilter`, `sort`, `setSort`) is unchanged. The caller in `components/ConversationPanel.tsx:950` does not change.
- localStorage key `ohbr.threadList`, persisted shape, and `useThreadListRows` hook — all unchanged.
- No new dependencies. Icons are inline SVG matching the existing `viewBox="0 0 16 16"` / `stroke="currentColor"` / `strokeWidth="1.5"` convention used in `components/Reader.tsx` and `components/AppMenu.tsx`.

## Design

### Layout

Inside `ThreadListControls`, replace the two `inline-flex` text-button groups with two icon-button popovers, side by side:

```
[funnel-icon-btn]  [sort-icon-btn]
```

The wrapper keeps the same `flex flex-wrap items-center gap-x-2 gap-y-1.5` row.

### Popover anchoring

`ThreadListControls` is rendered inside `<div className="ml-auto">` in `ConversationPanel.tsx:949`, so it sits at the right edge of the panel header. Anchor each popover with `absolute right-0 top-full z-10 mt-1` — same pattern as `components/AppMenu.tsx:75`. Right-anchoring keeps the menu inside the panel even when the panel is narrow.

### Outside-click + Escape handling

One menu can be open at a time. State is `openMenu: "filter" | "sort" | null`, with a single `wrapperRef` covering both buttons. The `mousedown` / `keydown` effect — copied from `components/AppMenu.tsx:22-36` — closes whichever menu is open.

Clicking the other icon button while one menu is open switches `openMenu` directly: the outside-click handler ignores the click (target is inside `wrapperRef`) and the button's `onClick` flips `openMenu` to the new section. No close-then-open flicker.

### Icon-button styling and state hint

Reuse the same active/inactive Tailwind colors used by the current `FilterButton` (`components/ThreadList.tsx:281-285`) so the visual language is consistent:

- Default value (filter `page`, sort `date`): inactive style — `bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800`, with `border border-zinc-300 dark:border-zinc-700` so the button reads as a control rather than floating.
- Non-default value (filter `all`, sort `page`): active style — `bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black`, with a matching border (`border-zinc-900` / `dark:border-zinc-100`) to keep box-sizing consistent.
- Sizing: `inline-flex h-7 w-7 items-center justify-center rounded` (matches the height of the existing text buttons: `py-1` + `text-xs` ≈ 26–28px).
- `aria-haspopup="menu"`, `aria-expanded`, `aria-label`, and a `title` tooltip showing the current value (e.g. `Filter: This page`, `Sort: Date`) — same pattern as `components/AppMenu.tsx:51-54`.

### Icons (inline SVG, 16×16 viewBox, stroke="currentColor", strokeWidth="1.5")

- **Filter (funnel)** — top edge across, sides converging to a narrow stem: `M2 3 L14 3 L9.5 8 L9.5 13 L6.5 13 L6.5 8 Z`.
- **Sort (bars of decreasing length)** — three horizontal lines: `M3 4 L13 4`, `M3 8 L11 8`, `M3 12 L9 12`. Visual weight matches the hamburger icon in `components/AppMenu.tsx`.

Both icons use `strokeLinecap="round"` / `strokeLinejoin="round"` / `aria-hidden="true"` like every other icon in the codebase.

### Popover menu

Same shell as `components/AppMenu.tsx:73-86` — `role="menu"`, `absolute right-0 top-full z-10 mt-1 min-w-40 rounded border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950`.

Each menu has two `role="menuitem"` buttons. Selecting an item calls `setFilter` / `setSort` and closes the menu. The currently-active option gets a leading `✓`; the other gets a transparent leading slot of the same width to keep labels aligned. Hover/active styles mirror the existing menu item: `hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700`.

```
+-----------------+
| ✓ This page     |
|   All pages     |
+-----------------+
```

### Component shape

Introduce one local component, `IconMenu`, that takes:

- `open: boolean`, `onOpenChange: (b: boolean) => void`
- `active: boolean` (drives the icon-button background)
- `icon: ReactNode`
- `ariaLabel: string`, `title: string`
- `items: { label: string; selected: boolean; onSelect: () => void }[]`

`ThreadListControls` owns the `wrapperRef` and the `openMenu` state, and renders two `IconMenu`s. The existing `FilterButton` helper (lines 265–289) is removed — it is defined and used only inside `ThreadList.tsx`.

## Files to change

- `components/ThreadList.tsx`:
  - Add `useRef` to the React import.
  - Replace the body of `ThreadListControls` (lines 168–210).
  - Remove `FilterButton` (lines 265–290).
  - Add `IconMenu`, `FilterIcon`, `SortIcon` plus the `OpenMenu` and `IconMenuItem` types.

No other files change.

## Verification

1. `npm run dev`. Open a book with at least one thread on the current page and one on another page.
2. With the conversation panel showing the thread list (no active conversation), confirm the header shows two compact icon buttons at the right edge instead of the four text toggles.
3. Click the funnel icon — popover opens, shows `This page` (checked) and `All pages`. Pick `All pages`. Menu closes; thread list updates; funnel icon now shows the active (filled) style.
4. Click the sort icon — popover opens, shows `Date` (checked) and `Page`. Pick `Page`. Menu closes; threads reorder by page; sort icon now shows the active style.
5. With a menu open, click outside → menu closes. Re-open and press `Escape` → menu closes.
6. With the filter menu open, click the sort icon → filter menu closes and sort menu opens, no flicker.
7. Hover each icon button — tooltip reads e.g. `Filter: All pages`, `Sort: Page`.
8. Reload the page — selected filter/sort persists (same `ohbr.threadList` localStorage key as before).
9. Toggle dark mode — both icon buttons and popover menus render correctly in both themes.
10. Narrow the conversation panel until the header is tight — icon buttons stay on one line and popovers stay anchored to the right edge inside the panel.
11. `npx tsc --noEmit` passes.
