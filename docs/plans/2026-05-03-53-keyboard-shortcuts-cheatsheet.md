# Surface keyboard shortcuts to users

## Context

`docs/plans/2026-05-03-10-keyboard-shortcuts.md` added a coherent set of
shortcuts (page nav, zoom, sidebar toggle, conversation close/delete,
composer hotkeys), but nothing in the UI tells users they exist — the
`AppMenu` had only one item ("Reset UI preferences") and there was no help
surface anywhere. This change adds three complementary discovery paths
without touching the shortcut handlers themselves.

Discovery paths:

1. **Hamburger menu item on the library page** — opens a cheatsheet modal.
   Intentionally **not** added to the reader; the reader header stays as it
   was, and the discoverability gap there is filled by the next two paths.
2. **Global `?` (Shift+/) shortcut** — opens the same cheatsheet from
   anywhere (library or reader), mirroring the GitHub/Slack/Linear
   convention.
3. **Inline tooltip hints** on icon buttons whose action has a shortcut —
   e.g. "Previous page (←)", "Hide panel (\\)", "Close (Esc)".

The cheatsheet is grouped by area (Reader / Threads / Composer / Global) so
users can scan to the section they care about.

## Files added

- `components/KeyboardShortcutsDialog.tsx` — pure dialog UI. Reuses the
  existing modal pattern from the image / text-attachment preview modals in
  `components/ConversationPanel.tsx`: `fixed inset-0 z-50 bg-black/80
  backdrop-blur-sm`, click-outside to close, capture-phase Escape listener,
  body-scroll lock. Shortcut data lives in a module-scoped `GROUPS` const
  inside this file. Each row renders chord(s) as styled `<kbd>` chips and
  joins multiple chords with "or", multiple keys within a chord with "+".
- `components/ShortcutsDialogProvider.tsx` — tiny context provider that
  owns the dialog's `open` state, mounts `<KeyboardShortcutsDialog>` once,
  and installs the global `?` keydown listener with the same
  input-focus guard pattern used in `Reader.tsx` (skip if `e.target` is
  `INPUT` / `TEXTAREA` / `contentEditable`, skip if any modifier is held).
  Exposes `useShortcutsDialog()` returning `{ open }`.

## Files modified

- `app/layout.tsx` — wraps `{children}` in `<ShortcutsDialogProvider>` so
  the global `?` listener and the single dialog instance work on both
  library (`/`) and reader (`/books/[bookId]`) routes.

- `components/AppMenu.tsx` — adds a "Keyboard shortcuts" `<button
  role="menuitem">` above the existing "Reset UI preferences" item. Click
  closes the menu and calls `useShortcutsDialog().open()`. `AppMenu`
  remains rendered only on the library page (`app/page.tsx`); the reader
  intentionally has no hamburger.

- `components/Reader.tsx` — appends shortcut hints to existing button
  `title` attributes (no behavior changes, no new buttons):
    - Previous page button → `"Previous page (←)"`
    - Next page button → `"Next page (→)"`
    - Zoom out button → `"Zoom out (-)"`
    - Zoom in button → `"Zoom in (+)"`
    - Sidebar toggle → `"Show panel (\\)"` / `"Hide panel (\\)"`
  `aria-label`s are left unchanged — screen readers don't need shortcut
  hints there.

- `components/ConversationPanel.tsx` — appends shortcut hints to:
    - Delete button → `"Delete (Del)"` (was `"Delete"`)
    - Close button → `"Close (Esc)"` (was `"Close"`)

## Cheatsheet content

Mirrors the handlers in `Reader.tsx`, `ConversationPanel.tsx`, and
`ThreadList.tsx`:

- **Reader** — `←` / `PageUp` previous page · `→` / `PageDown` / `Space`
  next page · `Home` first · `End` last · `+` / `=` zoom in · `-` zoom out ·
  `0` reset zoom · `\` toggle conversation panel
- **Threads** — `↑` / `↓` move (jumps across pages at boundary) ·
  `Delete` delete current conversation · `Esc` close conversation panel
- **Composer** — `Enter` send · `Shift+Enter` newline · `⌘`/`Ctrl+Enter`
  save memo · `Esc` clear draft and unfocus
- **Global** — `?` open this cheatsheet · `Esc` close menus and dialogs

## Verification

1. `npm run build` — passes (TypeScript + Next.js production build).
2. `npm run dev`, library page (`/`): click hamburger → "Keyboard
   shortcuts" → dialog appears, all four groups legible in light and dark
   mode. Click backdrop / press `Esc` / click `×` → dialog closes.
3. Press `?` on the library page and inside a book — dialog opens both
   places.
4. Open a book, click into the composer textarea, press `?` — character
   `?` is typed into the textarea; dialog does **not** open (focus guard).
5. Hover the reader header buttons (prev / next / zoom -/+ / sidebar
   toggle) — tooltips show the shortcut hint. Hover the conversation panel
   close and delete buttons — same.
6. Each shortcut listed in the dialog still works: arrows / Space / Home /
   End for navigation, `+` / `-` / `0` for zoom, `\` for sidebar, `↑` /
   `↓` for thread navigation, `Esc` / `Delete` in the conversation panel,
   `Enter` / `Shift+Enter` / `⌘`+`Enter` in the composer.
