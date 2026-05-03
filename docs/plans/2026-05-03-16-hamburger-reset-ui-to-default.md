# Add hamburger menu in Library header with "Reset UI to default"

## Context

The app currently has no place for global app-level actions. Add a hamburger menu in the chrome with a single action — "Reset UI to default" — that clears the browser's local persistent UI state. Server-side data (uploaded PDFs and conversations under `/data/books/`) is **not** in scope and must be preserved. The label "Reset UI to default" is explicit about this scope.

The menu lives only in the Library page (`/`) header — the conceptual "home" for global actions. The Reader header (`components/Reader.tsx:733`) is already dense with reader-specific controls (back link, title, prev/next, page input, zoom −/+, sidebar toggle), so adding a menu there would crowd it. The dropdown is built as a real menu (not a single button) so future items (theme toggle, about, shortcuts, etc.) drop in cleanly.

Decisions confirmed with the user:

- Placement: Library header only, to the right of "Upload PDF".
- Reset scope: localStorage only; never touch server data.
- Menu items: just "Reset UI to default" for now, structured as a dropdown for future extensibility.
- Label wording: "Reset UI to default" (clearer than "Reset to default").

## What gets cleared

All `localStorage` keys whose name starts with `ohbr.`:

| Key | Set in | Purpose |
|---|---|---|
| `ohbr.sidebarWidth` | `components/Reader.tsx:183` | Sidebar width px |
| `ohbr.sidebarHidden` | `components/Reader.tsx:188` | Sidebar collapse state |
| `ohbr.book.{bookId}` | `components/Reader.tsx:193-195` | Per-book page + scale (one entry per book) |
| `ohbr.threadList` | `components/ThreadList.tsx:86` | Thread filter/sort prefs |

The per-book keys are dynamic, so the implementation iterates `localStorage` and removes any key with the `ohbr.` prefix rather than enumerating a hardcoded list. New `ohbr.*` keys added in the future are cleared automatically.

## Files to change

- `components/AppMenu.tsx` — **new** self-contained client component (button + dropdown + reset action).
- `app/page.tsx` — import `AppMenu`, wrap the header right side in a flex container so Upload PDF and the menu sit side-by-side.

No new dependencies. No util files.

## Implementation

### 1. New `components/AppMenu.tsx`

Self-contained `"use client"` component. Hamburger SVG follows the codebase convention: 16×16 `viewBox="0 0 16 16"`, three stroke paths, `strokeWidth="1.5"`, round caps — matches every other icon in `components/Reader.tsx:754-886`.

Button styling reuses the existing icon-button pattern from `components/Reader.tsx:749`:

```
rounded border px-3 py-2 hover:bg-zinc-100 active:bg-zinc-200
dark:hover:bg-zinc-800 dark:active:bg-zinc-700
```

Behavior:

- Click button → toggles dropdown.
- Dropdown is absolutely positioned, anchored to the button's right edge, below it. Wrapper uses `relative` so the absolute child anchors locally.
- Click outside the menu → closes (uses a `mousedown` listener on `document` while open, gated by a ref to the wrapper).
- Press `Escape` → closes (window `keydown` listener while open).
- Click "Reset UI to default" → calls `window.confirm("Reset UI preferences (sidebar size, zoom, page positions, thread filters) to defaults? Your books and conversations are kept.")`. On confirm: iterate `localStorage` and remove any key starting with `ohbr.`, close the menu, then `window.location.reload()` so any in-memory state derived from the cleared keys is re-derived from defaults.

Accessibility:

- Button: `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-label="Menu"`, `title="Menu"`.
- Dropdown: `role="menu"`.
- Reset item: `role="menuitem"`, rendered as a `<button type="button">` with destructive color (`text-red-600 dark:text-red-400`) to match the existing delete icon at `app/page.tsx:152`.

No external menu library — the codebase doesn't use one and a single-item dropdown doesn't justify pulling one in.

### 2. Update `app/page.tsx`

**Import (after the existing imports near line 4):**

```diff
  import Link from "next/link";
  import { useEffect, useRef, useState } from "react";
+ import AppMenu from "@/components/AppMenu";
  import { formatTimestamp } from "@/lib/formatTimestamp";
  import { triggerBlobDownload } from "@/lib/exportConversation.client";
```

**Wrap the right side of the header (at line 107) so the new menu sits beside Upload PDF:**

```diff
  <header className="mb-8 flex items-center justify-between">
    <h1 className="text-2xl font-semibold">oh-book-reader</h1>
-   <label className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300">
-     {uploading ? "Uploading…" : "Upload PDF"}
-     <input
-       ref={fileRef}
-       type="file"
-       accept="application/pdf"
-       className="hidden"
-       disabled={uploading}
-       onChange={onUpload}
-     />
-   </label>
+   <div className="flex items-center gap-2">
+     <label className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300">
+       {uploading ? "Uploading…" : "Upload PDF"}
+       <input
+         ref={fileRef}
+         type="file"
+         accept="application/pdf"
+         className="hidden"
+         disabled={uploading}
+         onChange={onUpload}
+       />
+     </label>
+     <AppMenu />
+   </div>
  </header>
```

The Library page itself reads no `ohbr.*` keys, so a reload after reset is purely defensive — it ensures other tabs/views derive state from a clean slate.

## Out of scope

- Hamburger in the Reader header — Reader chrome already too dense; revisit if global actions multiply.
- Server-side reset (deleting `/data/books/`) — explicitly excluded; books and conversations must survive a reset.
- A second menu item (theme, about, shortcuts) — structure supports adding them later.
- Replacing `window.confirm` with a custom modal — matches the existing delete pattern at `app/page.tsx:37`.

## Verification

1. `npm run dev` and open `/`.
2. Confirm the hamburger button appears to the right of "Upload PDF" and matches the visual style of the other icon buttons (border, hover, dark mode).
3. Click it → dropdown opens below, anchored to the button's right edge.
4. Click outside → dropdown closes. Press Escape → dropdown closes.
5. Open a book, scroll to a non-default page, change zoom, resize the sidebar, hide/show it. Open DevTools → Application → Local Storage and confirm `ohbr.sidebarWidth`, `ohbr.sidebarHidden`, `ohbr.book.{bookId}` are populated. Visit a thread list and change a filter to populate `ohbr.threadList`.
6. Return to `/`, open the menu, click "Reset UI to default", confirm the dialog. After reload, DevTools should show **no** `ohbr.*` keys.
7. Reopen the same book — page should be back to 1, scale to default, sidebar to default width and visible.
8. Confirm the book itself and its conversations are still present (server-side data untouched).
9. `npx tsc --noEmit` passes.
