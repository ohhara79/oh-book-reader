# Reverse-direction hover highlight: amber box → thread item

## Context

Today, hovering or focusing a thread item in the conversation thread list highlights the corresponding amber box on the PDF (the box's background opacity bumps from `bg-amber-500/10` to `bg-amber-500/25`). The user wants the symmetric behavior added: hovering or focusing an amber box in the PDF view should produce a slight color change on every thread item that maps to that selection.

The existing one-direction wiring is small and clean (`Reader.tsx` owns `hoveredSelectionId`, threads call `onHover(selectionId)`, `SelectionOverlay` reads `highlightedSelectionId`). The reverse direction is mechanically the same shape, just flipped, so it's worth doing.

## Approach

Add a second piece of lifted state in `Reader.tsx` for the pin-hovered selection, push it down through `ConversationPanel` → `ThreadList`, and apply a faint amber background tint on thread item buttons whose `selectionId` matches. Wire the amber box's existing `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` handlers in `SelectionOverlay.tsx` to a new `onPinHover` callback prop. The two highlight states (thread→pin and pin→thread) are independent and don't interfere — both can be active without conflict.

## Files to modify

### 1. `components/Reader.tsx`
- Add state next to `hoveredSelectionId` (line 113):
  ```tsx
  const [hoveredPinSelectionId, setHoveredPinSelectionId] =
    useState<string | null>(null);
  ```
- Add a `useCallback` `handlePinHover(selectionId: string | null)` that just calls `setHoveredPinSelectionId`. (No scroll side effect — only the thread→pin direction auto-scrolls; reversing that would be jarring.)
- Pass `onPinHover={handlePinHover}` to `<SelectionOverlay>` at line 948.
- Pass `highlightedSelectionId={hoveredPinSelectionId}` to `<ConversationPanel>` at line 966.

### 2. `components/SelectionOverlay.tsx`
- Add `onPinHover?: (selectionId: string | null) => void;` to `Props` (around line 51) and destructure it in the function signature.
- On the pin `<button>` at line 680, augment the existing handlers (do not replace — they manage `hoverTip` and `pinNavActiveRef`):
  - `onMouseEnter`: also call `onPinHover?.(p.selectionId)`.
  - `onMouseLeave`: also call `onPinHover?.(null)`.
  - `onFocus`: also call `onPinHover?.(p.selectionId)`.
  - `onBlur`: also call `onPinHover?.(null)`.

### 3. `components/ConversationPanel.tsx`
- Add `highlightedSelectionId?: string | null;` to `Props` (line 146 area) and destructure in the function signature (line 185 area).
- Pass `highlightedSelectionId={highlightedSelectionId}` to `<ThreadList>` at line 1159.

### 4. `components/ThreadList.tsx`
- Add `highlightedSelectionId?: string | null;` to `Props` (line 260) and destructure it (line 271 area).
- On the thread item `<button>` className at line 408, switch backgrounds when `r.selectionId === highlightedSelectionId`. Reuse the thread item's own pointer-hover styling (gray) for the highlighted state — keeps the panel's visual vocabulary consistent rather than introducing a new amber accent borrowed from the PDF pane:
  ```tsx
  className={`block w-full rounded border px-3 py-2 text-left active:bg-zinc-100 dark:active:bg-zinc-800 ${
    r.selectionId === highlightedSelectionId
      ? "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900"
      : "border-zinc-200 bg-white hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
  }`}
  ```
  The only structural change to the existing class string is splitting the bg/border styles into the two branches — everything else (rounded, padding, active state) stays in the static prefix.

## Notes / non-goals

- One amber box can correspond to multiple thread items (one selection → many conversations via `convsBySelection`). All matching items will tint, which is the intended behavior — same as how multiple amber boxes for one selection all tint when one thread is hovered.
- No scroll side effect on the reverse direction: `handleThreadHover` in Reader auto-scrolls the PDF to the selection, which makes sense (the user wants to see what they're pointing at). Auto-scrolling the thread list when an amber box is hovered would feel intrusive and is intentionally omitted unless the user asks.
- The amber box's existing `hover:bg-amber-500/25` Tailwind class (line 689) keeps working — pointer hover continues to give the box itself a stronger highlight than keyboard focus.

## Verification

1. `bun dev` and open a book that has at least two distinct selections, each with at least one thread.
2. Mouse hover an amber box on the PDF → the corresponding thread item(s) in the right panel should pick up a faint amber tint; leaving cancels it.
3. Tab into the PDF area until an amber box is keyboard-focused (use the existing pin-nav behavior) → same tint should appear; tabbing away clears it.
4. Confirm the existing thread→pin direction still works unchanged: hover/focus a thread item, the amber box brightens.
5. Confirm both directions can coexist: hover a thread item (pin brightens) while another amber box is keyboard-focused (its thread items stay tinted).
6. Sanity-check dark mode: the tint should still be visible against `dark:bg-zinc-950`.
