# Restore focus to the just-closed thread when returning to the list

## Context

Pressing Enter on a thread in the conversation thread list opens that thread. Pressing Esc inside the thread closes it and the list reappears — but no item has focus, so ArrowUp / ArrowDown (added in `2026-05-03-21-thread-list-arrow-navigation.md`) don't work until the user re-Tabs into the list. Make the just-closed item receive focus so keyboard navigation continues uninterrupted.

## Approach

Each row is already a native `<button>` with its ref stored in `buttonRefs` (`components/ThreadList.tsx`). The piece that's missing is "remember which conversation was opened, and focus its button after the list remounts."

`<ConversationPanel>` is keyed on `active` in `Reader.tsx`, so it unmounts/remounts on every open/close — any state local to the panel is wiped. The codebase already solves this for scroll position with `threadListScrollTopRef` in `Reader.tsx` plumbed through `initialListScrollTop` / `onListScrollSave`. Mirror that pattern for the focus target.

Only the list-driven open path sets the ref. Selection-driven `kind: "new"` opens, post-create opens, and shared-link loads deliberately don't write it — there's no list item to return focus to in those cases, and we don't want to focus a stale id after closing one of those.

## Implementation

### `components/Reader.tsx`

- Add `const threadListFocusConvIdRef = useRef<string | null>(null);` next to `threadListScrollTopRef`.
- In the `<ConversationPanel>` props, wrap `onOpenConversation` so it records the id, and pass the ref's current value as `initialFocusConvId`.

### `components/ConversationPanel.tsx`

- Extend `Props` with `initialFocusConvId?: string | null;`, destructure with default `null`.
- Forward it to `<ThreadList focusConvId={initialFocusConvId} />`. No internal state — pure plumbing.

### `components/ThreadList.tsx`

- Extend `Props` with `focusConvId?: string | null;`.
- Add a one-shot effect: if `focusConvId` matches a row in `visibleRows`, focus that button and set a guard ref so it only fires once per mount.
- Deps `[focusConvId, visibleRows]` — on first render the ref array can be empty before refs attach; re-running once `visibleRows` populates lets us focus on the next paint.

The native `<button>` focus also fires the existing `onFocus` handler, which re-triggers the page-pin highlight — the right behavior.

## Files modified

- `components/Reader.tsx` — new ref, two prop wires.
- `components/ConversationPanel.tsx` — new prop, plumbed through.
- `components/ThreadList.tsx` — new prop, one-shot focus effect.

## Out of scope

- Tracking ArrowUp / ArrowDown movements within the list to update the "last focused" target. The ref only changes on open.
- Focus restoration for `kind: "new"` and shared-link opens (no list item to focus).
- Scrolling the focused button into view — `<button>.focus()` does this by default.

## Verification

1. `npm run dev`, open a book with at least two threads on the current page.
2. Tab into the thread list, ArrowDown to the second item, press Enter — thread view opens.
3. Press Esc — list reappears with the second item focus-ringed.
4. Press ArrowDown — focus moves to the third item (keyboard nav resumes without re-tabbing).
5. Open a thread, switch the page filter so the thread is hidden, press Esc — list shows with no item focused, no console error.
6. Drag a new selection on the page (active becomes `kind: "new"`), press Esc — list shows; focus does not jump to a stale thread.
7. Mouse-click a thread, press Esc — clicked thread receives focus.
8. `npx tsc --noEmit` passes.
