# Open conversations as fullscreen overlay on desktop when sidebar is hidden

## Context

In desktop mode with the right-side conversation pane hidden (the `‹/›` toggle in the header), clicking an amber pin currently sets `active` state and loads the conversation into the sidebar — but the sidebar is `md:hidden`, so the user sees nothing happen. The conversation loads invisibly.

The user wants: when the sidebar is hidden on desktop and they click an amber pin (or drag a new selection), the conversation should appear as a fullscreen overlay — the same way mobile already shows it. Closing it returns to the hidden-sidebar state. This also gives a visible affordance that the click did something.

## Root cause

In `components/Reader.tsx` (lines 148–156), the `asideClass` composes layout classes such that when `active && sidebarHidden`:

```
fixed inset-0 z-50 md:static md:z-auto   ← from `active`
md:hidden                                  ← from `sidebarHidden`
md:shrink-0 md:w-[var(--sidebar-w)]        ← base
```

On desktop (`md:`), `md:hidden` wins → the panel never appears even though it has loaded.

## Change

Modify only the `asideClass` logic in `components/Reader.tsx` so that when `active && sidebarHidden`, the panel uses the mobile-style fullscreen overlay on every breakpoint (no `md:static`, no `md:hidden`, no `md:w-[...]`). All other states are unchanged.

### Files to modify

- `components/Reader.tsx` — `asideClass` block at lines 148–156.

### Replacement logic (Reader.tsx lines 148–156)

```tsx
const overlayOnDesktop = !!active && sidebarHidden;
const layoutClass = active
  ? overlayOnDesktop
    ? "fixed inset-0 z-50"
    : "fixed inset-0 z-50 md:static md:z-auto md:shrink-0 md:w-[var(--sidebar-w)]"
  : sidebarHidden
    ? "hidden"
    : "hidden md:block md:shrink-0 md:w-[var(--sidebar-w)]";
const asideClass = `${layoutClass} w-full overflow-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black`;
```

Notes:
- `md:shrink-0 md:w-[var(--sidebar-w)]` is moved into the docked branches only. In overlay mode `fixed inset-0` would otherwise conflict with an explicit width, leaving a 448px-wide strip pinned to the left edge instead of a true fullscreen overlay.
- `asideStyle` (the `--sidebar-w` CSS var) can stay — it is harmless when unused in overlay mode.
- The `Splitter` render condition (`!sidebarHidden`, line 277) is already correct: in overlay mode `sidebarHidden` is true, so no splitter.
- `ConversationPanel`'s existing close button (lines 235–242 of `ConversationPanel.tsx`) calls `onClose` → `setActive(null)` (Reader.tsx line 290). With `active` cleared, `asideClass` returns to `hidden`, restoring the hidden-sidebar state. No changes needed there.
- The `onPinClick` handler (Reader.tsx lines 263–271) and `onCapture` (line 128) are unchanged — both set `active` and benefit from the new overlay behavior automatically (so dragging a new selection while the sidebar is hidden also opens as overlay).

## Verification

1. Run the dev server (`npm run dev`) and open a book.
2. **Desktop, sidebar visible** (default): click an amber pin → conversation opens in the right sidebar, as before. Drag a new selection → new-conversation pane opens in the sidebar.
3. **Desktop, sidebar hidden** (click `‹` in header to hide): click an amber pin → conversation opens as a fullscreen overlay. Click `Close` → overlay dismisses, sidebar remains hidden. Drag a new selection → new-conversation pane opens as overlay; closing it dismisses.
4. **Desktop, sidebar visible → hide while a conversation is active**: clicking `‹` should hide the sidebar but, because `active` is set, the overlay should appear. Clicking `Close` returns to hidden state. (Verify this transition feels acceptable; if not, that is a follow-up, not part of this change.)
5. **Mobile** (resize below 768px): existing behavior unchanged — fullscreen overlay on pin click and selection.
6. Confirm no console errors and that `localStorage` `ohbr.sidebarHidden` still persists across reloads.
