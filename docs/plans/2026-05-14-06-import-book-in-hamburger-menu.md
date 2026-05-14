# Move "Import book" into the hamburger menu

## Context

In the PDF list view (`app/page.tsx`), the header currently shows three controls: a filled **Upload PDF** button, an outlined **Import book** button, and the hamburger `AppMenu`. The two text buttons together are wide and crowd the header.

The fix should preserve discoverability of the primary onboarding action (Upload PDF) for new users — turning it into an icon would hurt that. Instead, demote **Import book** (a power-user "restore from backup" feature) into the hamburger menu, where it sits next to the other rarely-used actions. Upload PDF stays untouched.

## Changes

### 1. `components/AppMenu.tsx` — accept import as a prop and render it as a menu item

Add props so the parent can wire up its existing import handler without `AppMenu` knowing about the books API:

```ts
type AppMenuProps = {
  importing: boolean;
  onImportFile: (file: File) => Promise<void> | void;
};
```

Inside the component:
- Add a `useRef<HTMLInputElement>(null)` for a hidden file input local to the menu.
- Render the menu item as a `<label>` (not a `<button>`) with `role="menuitem"` so clicking it opens the OS file picker via the nested `<input type="file" accept=".zip,application/zip">`. This mirrors the existing pattern in `app/page.tsx:177-187`.
- The label's `onChange` handler: read `e.target.files?.[0]`, close the menu (`setOpen(false)`), call `await onImportFile(file)`, then clear `inputRef.current.value`. Disable the input while `importing` is true.
- Match the existing menu-item styling (`block w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-100 ...`) and add `cursor-pointer`. When `importing`, show the label text as `"Importing…"` and apply `cursor-not-allowed opacity-60`.
- Place the new "Import book" item **above** "Keyboard shortcuts" (action grouped first, info/destructive below).

### 2. `app/page.tsx` — remove the standalone Import button, pass handler to `AppMenu`

- Delete the `<label>…Import book…</label>` block at lines 177-187.
- Delete the `importRef` declaration (line 27) — the ref moves into `AppMenu`.
- Change `onImport` (lines 134-159) from a `React.ChangeEventHandler<HTMLInputElement>` to `async function onImport(file: File)`. Drop the `e.target.files?.[0]` lookup and the `importRef.current.value` reset (the latter now lives in `AppMenu`). Keep all other logic — `setImporting`, the FormData POST to `/api/books/import`, the JSON error parsing, the `refresh()` call, the `finally` reset.
- Update the `<AppMenu />` call (line 188) to `<AppMenu importing={importing} onImportFile={onImport} />`.

The `importing` state declaration at `app/page.tsx:22` stays in the page (the page still needs it to drive `onImport`).

## Critical files

- `app/page.tsx` (header at lines 161-190; handler at lines 134-159)
- `components/AppMenu.tsx` (whole file)

## Verification

1. `npm run dev`, open the library page.
2. Header should show **Upload PDF** + the hamburger button only — Import book is gone from the header.
3. Open the hamburger menu → "Import book" appears as the first item.
4. Click it → OS file picker opens, filtered to `.zip`.
5. Select a valid backup zip → menu closes, label flips to "Importing…" briefly, book list refreshes with the imported book.
6. Try a non-zip file → existing error alert path still fires (`import failed: …`).
7. While an import is in flight, reopening the menu should show the item disabled / "Importing…".
8. Confirm Upload PDF still works unchanged.
9. `npm run lint` and `npm run typecheck` (or `tsc --noEmit`) pass.
