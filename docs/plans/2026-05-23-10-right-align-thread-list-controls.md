# Right-align the thread-list controls in the conversation panel header

## Context

In conversation list view, the font-zoom / filter / sort icons appear centered in the panel header instead of hugging the right edge. This regressed when the mobile "Hide panel" button was added (commit `f5beab4`).

The panel header is `flex flex-wrap items-center` (`ConversationPanel.tsx:1266`). When threads exist and we're on mobile in list view, three items live on the row:

1. Title div — `min-w-0 shrink-0`, renders an empty `<span>` in list view (the span only outputs text when `active?.kind` is set), so it has effectively zero content width.
2. Controls block — `ml-auto flex items-center gap-1` containing `FontZoomMenu` + `ThreadListControls` (`ConversationPanel.tsx:1377-1392`).
3. New Hide-panel button — `ml-auto inline-flex … md:hidden` (`ConversationPanel.tsx:1539-1562`).

Per CSS flexbox: when multiple items on the same line have an `auto` margin in the same direction, the available free space is split **equally** among those `auto` margins. Two `ml-auto`s here means each consumes half of the free space, so the Controls block ends up roughly in the middle (free-space/2 from the empty title), while the Hide-panel button is pushed to the right edge. The Controls block looks "centered."

Goal: Controls should sit immediately to the left of the Hide-panel button at the right edge.

## Approach

Remove `ml-auto` from the Hide-panel button so only the Controls block claims the free space. The Controls block's `ml-auto` then pushes Controls all the way right; the Hide-panel button sits next to it (separated by the header's `gap-x-2`).

This is correct in both branches where the Hide-panel button renders (`!active && onHidePanel`):

- **Threads exist (`showThreadListControls === true`)**: Controls's `ml-auto` consumes the free space; Hide-panel trails it at the right.
- **No threads (`showThreadListControls === false`)**: no Controls block renders; the title div uses `min-w-0 flex-1` (`ConversationPanel.tsx:1274`) and grows to fill, pushing the Hide-panel button to the right naturally.

On desktop the button is `md:hidden` and doesn't render, so this is a no-op there. The Controls block keeps its existing `ml-auto` and behaves exactly as before.

## Changes

### `components/ConversationPanel.tsx`

- Drop `ml-auto` from the Hide-panel button's className (`ConversationPanel.tsx:1545`). The remaining classes (`inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 md:hidden dark:hover:bg-zinc-800 dark:active:bg-zinc-700`) are unchanged.

That's the whole change — one class removal.

## Verification

1. `npm run dev` and open a book on a mobile-width viewport (devtools device mode or resize to ≤ 700px).
2. Open the conversation list view (tap the sidebar-toggle in the PDF header).
3. **With threads present**: confirm the font-zoom / filter / sort icons cluster at the right edge of the header, immediately to the left of the Hide-panel button.
4. **With no threads**: confirm the Hide-panel button still sits at the right edge of the header on its own.
5. Open an existing thread, then close back to the list view — the active-thread controls (delete / font / download / share / close) still right-align as before; the change is scoped to the Hide-panel button.
6. Desktop (≥ 768px): nothing should change — Hide-panel button doesn't render, Controls keeps its existing `ml-auto` right-alignment.

## Files touched

- `components/ConversationPanel.tsx` — drop one class from one button.
