# Arrow-key navigation in the thread list

## Context

Conversation thread items in the Library sidebar (`components/ThreadList.tsx`) are rendered as native `<button>` elements, so they are reachable via Tab but stepping through a long list one Tab at a time is awkward. Add ArrowUp / ArrowDown to move focus among the items while focus is already inside the list.

`ArrowUp` / `ArrowDown` are not bound by any global handler. The Reader's window-level keyboard handler in `components/Reader.tsx` only consumes `ArrowLeft` / `ArrowRight` (page navigation), `PageUp` / `PageDown`, `Home`, `End`, `+`, `-`, `0`, and `\` — see `2026-05-03-10-keyboard-shortcuts.md`. So this change is purely additive.

## Behavior

- `ArrowDown` → focus the next thread button; clamp at the last item (no wrap).
- `ArrowUp` → focus the previous thread button; clamp at the first item (no wrap).
- Both call `preventDefault()` so the page itself does not scroll while navigating the list.
- Tab focus, Enter / Space activation (native `<button>`), and the existing `onFocus` → `onHover` highlight all keep working unchanged.

The shortcut is scoped to "focus is already on a thread button" by attaching the handler to each button rather than to a window listener — this matches the existing pattern in this codebase where list-local shortcuts live on the elements they act on.

## Implementation

In `components/ThreadList.tsx`, inside the default-export `ThreadList` component:

1. Add a `buttonRefs` array of `HTMLButtonElement` refs and keep its length synced to `visibleRows.length` on each render.
2. Wire each button's `ref` into the array, and attach an `onKeyDown` that handles `ArrowDown` / `ArrowUp` by focusing `buttonRefs.current[idx ± 1]` (clamped).

`useRef` is already imported. The map callback gains an `idx` second arg.

## Files modified

- `components/ThreadList.tsx` — `buttonRefs` ref, `ref` callback on each button, `onKeyDown` for ArrowUp / ArrowDown.

## Out of scope

- `Home` / `End` / `PageUp` / `PageDown` bindings on the list (not requested).
- Wrapping at the ends — clamp matches the standard listbox-style "moves focus among the items" expectation.
- Auto-focusing the first item on mount or page change — only navigation while focus is already inside the list was requested.

## Verification

1. `npm run dev`, open a book with multiple threads on the current page, open the Library sidebar.
2. Tab into the thread list until one item is focused.
3. Press `ArrowDown` repeatedly: focus moves down one item per press, the focus ring follows, the page itself does not scroll. On the last item, focus stays put.
4. Press `ArrowUp` repeatedly: focus moves up; on the first item it stays put.
5. With a thread item focused, press `Enter` → the conversation opens (existing `onClick`).
6. With a thread item focused, press `ArrowLeft` / `ArrowRight` → book pages still flip (Reader's global handler is untouched).
7. Filter the list down to zero items → empty-state message renders without errors.
8. `npx tsc --noEmit` passes.
