# Give the expanded title the full row width on small screens

## Context

In the conversation thread header (`components/ConversationPanel.tsx`), the title sits in a flex row alongside the toolbar (font-size, delete, download, share, close). The toolbar uses `ml-auto`, so it always claims its own width on the right, which leaves the title with only the remaining space to its left.

When the user taps the chevron to expand the title, the title's class flips from `truncate` to `break-words` — but its **width is unchanged**. On a narrow phone screen this leaves only ~150–180px for the title, so the text wraps to one or two words per line (as in the screenshot: "I / appreciat / e you / reaching / out, but ...").

The fix should make "expand" actually give the title room to wrap efficiently on small screens, without disturbing the desktop layout where the title already has plenty of horizontal room.

## Approach

The header container at line 1012 already has `flex flex-wrap`. We can leverage that: when the title is expanded **and** we're on a small screen, give the title's wrapper container `basis-full` so it occupies the entire first row. The toolbar (`ml-auto flex …` at line 1129) then wraps to a second row, where its own `ml-auto` keeps it right-aligned. On `sm` and up, keep the current `flex-1` behavior so nothing changes on desktop, where the title rarely needs to wrap anyway.

This is a one-line className change. No new state, no popover, no new components.

## Change

**File:** `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`

**Location:** lines 1013–1017 (the title container's `className`).

Currently:

```tsx
<div
  className={
    showThreadListControls ? "min-w-0 shrink-0" : "min-w-0 flex-1"
  }
>
```

Change the `else` branch to widen to a full row when `titleExpanded` is true on small screens:

```tsx
<div
  className={
    showThreadListControls
      ? "min-w-0 shrink-0"
      : titleExpanded
        ? "min-w-0 basis-full sm:flex-1 sm:basis-auto"
        : "min-w-0 flex-1"
  }
>
```

Notes:
- `basis-full` forces the title wrapper to take the entire first row, which (combined with the parent's `flex-wrap`) pushes the toolbar to a second row on small screens.
- `sm:basis-auto sm:flex-1` restores the current side-by-side layout from the `sm` breakpoint up, so desktop is unaffected.
- The `showThreadListControls` branch is unchanged — that path doesn't render the chevron or toolbar, so the expanded/collapsed state is irrelevant there.

## Why not other approaches

- **Popover with the full title.** More UI surface, more state, and inconsistent with the in-place expand pattern already in the header.
- **Move the toolbar below the title unconditionally on small screens.** Adds vertical height even when the title is short and a user never expands. The current change only relocates the toolbar when the user has actively asked for more title room.
- **Shrink toolbar icons on small screens.** Doesn't solve the core problem — even with smaller icons, ~5 buttons still consume significant width and the title would still wrap awkwardly.

## Verification

1. `pnpm dev` (or whichever script is set up — check `package.json`) and open the app.
2. Open a conversation thread that has a long auto-generated title (e.g. the "I appreciate you reaching out…" thread from the screenshot).
3. Resize the browser to a narrow width (~400px) or use devtools mobile emulation.
4. Tap the down chevron next to the title.
   - **Expected:** the title now spans the full width of the header row and wraps into long lines (many words per line), and the toolbar (AA / trash / download / share / X) sits on its own row below, right-aligned.
5. Tap the chevron again to collapse.
   - **Expected:** title returns to `truncate`, toolbar returns to the same row as the title.
6. Resize to a wide window (≥ 640px / `sm`).
   - **Expected:** layout matches the current behavior — title and toolbar share one row whether expanded or collapsed.
7. Smoke-check the thread-list view (no active thread, multiple threads): the `ThreadListControls` row should be unaffected.
