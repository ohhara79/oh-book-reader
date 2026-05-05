# Expose conversation thread list on small screens

## Context

On screens narrower than Tailwind's `md` breakpoint (768px), the thread list sidebar is `hidden` whenever no conversation is active, and the existing toggle button in the header is gated behind `md:inline-flex` — so mobile users have no way to reach the thread list view at all. The only mobile entry point today is tapping a pin in the PDF, which opens *that specific* conversation full-screen but never the list. We want small-screen users to be able to switch from the PDF view to the thread list view as easily as desktop users.

## Approach

Reuse the existing header toggle button by making it visible at all widths, and let the aside slide over the PDF area (below the header) on small screens so the same toggle button can dismiss it. This mirrors the desktop behavior, the existing `\` keyboard shortcut, and the full-screen overlay pattern already used for active conversations on small screens — no new icon, drawer, or tab chrome to design.

Behavior summary:
- **md+ screens**: unchanged — sidebar is an inline flex column with a draggable splitter.
- **Small screen, sidebar shown, no active conversation**: aside covers the PDF area (header stays visible) so the toggle in the header can close it. Splitter is hidden.
- **Small screen, active conversation**: unchanged — `fixed inset-0 z-50` full-screen overlay with `ConversationPanel`'s own close button.

## Changes

All edits are in `components/Reader.tsx`.

### 1. Make the header toggle button visible on small screens — `Reader.tsx:1051-1077`

Drop the `md:` gate so the button is always rendered. Keep the existing icon, `aria-label`, `title`, and click handler.

- Line 1059: change `className` from `"ml-3 hidden h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 md:inline-flex dark:hover:bg-zinc-800 dark:active:bg-zinc-700"` to `"ml-1 inline-flex h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 md:ml-3 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"`.
  - Removes `hidden` and `md:inline-flex`.
  - Tightens left margin on small screens (`ml-1`) and keeps `md:ml-3` to match current desktop spacing, since the existing header is already busy on narrow viewports (line 922 uses `gap-1 text-sm md:gap-2`).
- The existing handler (lines 1053-1057) already calls `setSidebarHidden((h) => !h)` and clears `active`; no change needed.

### 2. Let the aside overlay the content area (not the header) on small screens — `Reader.tsx:889-897`

Today `layoutClass` produces `"hidden md:block …"` when sidebar is shown with no active conversation. Make that case overlay the inner content container on small screens instead of being hidden.

Replace the `layoutClass` definition with:

```ts
const overlayOnDesktop = !!active && sidebarHidden;
const layoutClass = active
  ? overlayOnDesktop
    ? "fixed inset-0 z-50"
    : "fixed inset-0 z-50 md:static md:z-auto md:shrink-0 md:w-[var(--sidebar-w)]"
  : sidebarHidden
    ? "hidden"
    : "absolute inset-0 z-30 md:static md:z-auto md:block md:shrink-0 md:w-[var(--sidebar-w)]";
```

Only the last branch changes: `"hidden md:block …"` → `"absolute inset-0 z-30 md:static md:z-auto md:block …"`.

Add `relative` to the inner flex container so the absolute positioning is scoped to the area below the header — `Reader.tsx:1081`:

- From: `<div className="flex flex-1 overflow-hidden print:block print:overflow-visible">`
- To:   `<div className="relative flex flex-1 overflow-hidden print:block print:overflow-visible">`

### 3. Hide the splitter on small screens — `Reader.tsx:1149`

Dragging a splitter is meaningless when the aside is an absolute overlay, and the splitter would otherwise consume horizontal space in the flex flow. Render it only at md+:

- From: `{!sidebarHidden && <Splitter onDrag={onSplitterDrag} />}`
- To:   `{!sidebarHidden && <div className="hidden md:contents"><Splitter onDrag={onSplitterDrag} /></div>}`

`md:contents` lets the existing splitter behave exactly as today on md+; the wrapper collapses to nothing on small screens. (Alternative: pass a `className` to `Splitter` if it forwards one, but a wrapper avoids touching that component.)

## Files touched

- `components/Reader.tsx` — three small edits described above. No other files require changes; `ConversationPanel` and `ThreadList` already render correctly at any width and the active-conversation overlay path is untouched.

## Verification

1. Start the dev server (`npm run dev` or whatever script is configured) and open a book.
2. **Desktop (≥768px wide)**: confirm sidebar still shows alongside PDF, splitter still drags, the header toggle button still hides/shows the panel exactly as before, and `\` still works.
3. **Small screen (<768px wide — resize the browser or use devtools device mode)**:
   - With no active conversation, the header toggle button is visible. Tap it: thread list slides over the PDF (header still visible). Tap again: returns to PDF.
   - Tap a thread row to open it: panel switches to the active-conversation full-screen overlay (covers header), and `ConversationPanel`'s close button returns to the thread list state.
   - Tap a pin in the PDF directly (sidebar hidden): still opens that conversation as a full-screen overlay, unchanged.
   - Press `\` on a connected keyboard: behaves the same as the toggle button.
4. **Print preview**: confirm `print:!static print:!z-auto print:!block …` on the aside (line 897) still wins — the absolute positioning shouldn't affect print since the print overrides remain.
