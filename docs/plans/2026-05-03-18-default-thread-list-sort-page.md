# Change default thread list sort from Date to Page

## Context

The thread list view (sidebar listing conversation threads on a book page) currently defaults to sorting by Date when no sort preference is stored in `localStorage`. The user wants Page to be the default instead — likely because Page sort matches the spatial reading order of the book and is a more useful starting view than recency.

The default only applies on first load (or after `localStorage` is cleared). Users who have already used the app and persisted a sort preference are unaffected.

## Change

**File:** `components/ThreadList.tsx`

1. **Line 82** — change the fallback in the `sort` `useState` initializer from `"date"` to `"page"`:
   ```ts
   return "page";
   ```

2. **Line 232** — update the `IconMenu` `active` prop so the sort icon highlights when the user has picked a *non-default* sort. Today it's `active={sort !== "date"}`; with Page as the new default it should be:
   ```ts
   active={sort !== "page"}
   ```
   The `active` indicator's purpose (per the existing pattern on the filter button at line ~210) is to signal "you've changed this away from the default," so it must track whichever option is now the default.

No other changes are needed:
- The `SortMode` type (line 28) still has both `"date"` and `"page"` — both remain user-selectable.
- The persistence read at lines 77–80 already accepts either value, so users with an existing `ohbr.threadList` localStorage entry keep their preference.
- The menu item ordering (Date first, then Page at lines 236–253) is a UI choice that doesn't need to change just because the default flipped.

## Verification

1. Clear `localStorage` for the dev origin (DevTools → Application → Local Storage → delete `ohbr.threadList`), or use a fresh incognito window.
2. Run `bun dev` (or the project's dev command), open a book that has multiple conversation threads spanning more than one page.
3. Confirm the thread list is sorted by page on first load (threads on the earliest page appear first; ties broken by position-on-page, then recency).
4. Confirm the sort icon button does **not** show the active indicator on first load (since Page is now the default).
5. Open the sort popover, switch to Date — confirm the active indicator now appears, and the order changes to most-recent-first.
6. Reload the page — confirm Date persists (localStorage round-trip still works).
7. Clear `ohbr.threadList` again, reload — confirm it falls back to Page.
