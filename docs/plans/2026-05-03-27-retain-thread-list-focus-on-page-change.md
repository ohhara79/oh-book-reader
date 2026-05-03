# Keep focus on a thread list item across page changes

## Context

In the conversation thread list view, ArrowUp/ArrowDown navigate between thread items (handled inside `ThreadList`), while Left/Right/PageUp/PageDown/Space change the PDF page (handled by a `window` keydown listener in `Reader`). When the filter is "page" (the default), changing pages recomputes `visibleRows` and the focused `<button>` unmounts, so focus drops to `document.body` and the user must press Tab to recover it.

The fix should: (a) detect that focus was inside the thread list immediately before a page change, (b) after the re-render, restore focus to a sensible item — same `convId` if still present, else the same index clamped to the new list's length, (c) not steal focus when the user wasn't actually in the list, (d) leave the existing "return-from-opened-thread" focus restoration (`focusAppliedRef` / `focusConvId`) untouched.

Filter "all" is unaffected (the buttons stay mounted), so no change is needed there — but the new logic is harmless in that case (it would refocus the already-focused button).

## Approach

All changes live in `components/ThreadList.tsx`. No changes to `Reader.tsx` or `ConversationPanel.tsx` — `currentPage` is already passed in and is the trigger we need.

Use container-level focus tracking on the `<ul>` (React's `onFocus`/`onBlur` bubble from the buttons via `focusin`/`focusout`). A `relatedTarget` containment check distinguishes "focus moved to another row" (stay tracked) from "focus left the list" (untrack). Per-button `onFocus` records the current row's `convId` and index. A `useEffect` keyed on `[currentPage, visibleRows]` with a `prevPageRef` guard refocuses only when `currentPage` actually changed AND focus was inside the list at that moment.

## Critical files

- `components/ThreadList.tsx` — all edits land here.

## Edits in `components/ThreadList.tsx`

### 1. Add refs near `focusAppliedRef` (around line 279)

```ts
const wasFocusedRef = useRef(false);
const listRef = useRef<HTMLUListElement>(null);
const prevPageRef = useRef(currentPage);
const focusedConvIdRef = useRef<string | null>(null);
const focusedIdxRef = useRef(-1);
```

### 2. Add the page-change refocus effect (immediately after the existing `focusAppliedRef` effect, after line 289)

```ts
useEffect(() => {
  const prevPage = prevPageRef.current;
  prevPageRef.current = currentPage;
  if (prevPage === currentPage) return;
  if (!wasFocusedRef.current) return;
  if (visibleRows.length === 0) return;
  const prevConvId = focusedConvIdRef.current;
  let idx = prevConvId
    ? visibleRows.findIndex((r) => r.conv.id === prevConvId)
    : -1;
  if (idx < 0) {
    idx = Math.min(focusedIdxRef.current, visibleRows.length - 1);
    if (idx < 0) idx = 0;
  }
  buttonRefs.current[idx]?.focus();
}, [currentPage, visibleRows]);
```

The `prevPageRef` guard ensures the effect is a no-op for non-page-change re-renders (e.g., a new conversation appears on the current page) and avoids fighting with the existing `focusAppliedRef` flow.

### 3. Wire focus tracking on `<ul>` (line 303)

```tsx
<ul
  ref={listRef}
  className="space-y-1.5"
  onFocus={() => { wasFocusedRef.current = true; }}
  onBlur={(e) => {
    if (!listRef.current?.contains(e.relatedTarget as Node | null)) {
      wasFocusedRef.current = false;
    }
  }}
>
```

No `tabIndex` needed — React's `onFocus`/`onBlur` map to `focusin`/`focusout`, which bubble from the child `<button>`s.

### 4. Extend the existing button `onFocus` (line 314)

```tsx
onFocus={() => {
  focusedConvIdRef.current = r.conv.id;
  focusedIdxRef.current = idx;
  onHover?.(r.selectionId, r.pages);
}}
```

## Coordination with existing focus restoration

The existing `focusAppliedRef` effect (lines 280–289) handles "user closed an opened thread → return focus to its row." It is keyed on `[focusConvId, visibleRows]` and gated by a one-shot ref. The new effect is keyed on `[currentPage, visibleRows]` and gated by `wasFocusedRef`. They don't interfere:

- After a return-from-thread restoration, the button gains focus, the container `onFocus` flips `wasFocusedRef` to true, and subsequent page navigation works.
- A page change without prior focus inside the list (`wasFocusedRef === false`) does not steal focus.
- Filter "all" → buttons don't unmount, focus is preserved naturally; the new effect's `.focus()` call on the still-focused button is a harmless no-op.

## Verification (manual, in browser)

1. Click a thread row on a page that has multiple threads; press `ArrowRight` repeatedly. Focus should follow to a row on each new page (same convId if present, else clamped index).
2. With filter "page" and a row on page N but none on N+1: focus the row, press `ArrowRight`. The list becomes empty, focus is left alone (no snap).
3. Click somewhere in the PDF area, press `ArrowRight`. Focus must NOT jump into the thread list.
4. Open a thread, close it (existing behavior re-focuses originating row), then press `ArrowRight` — focus follows to the next page's thread.
5. Switch filter to "all" with a row focused, press `ArrowRight`. Focus stays on the same row (rows don't unmount).
6. Press `Home` / `End` while a row is focused — focus lands on a row in page 1 / last page.
7. Press `Space` while a row is focused — page advances; verify Space does not also activate the button (Reader's `e.preventDefault()` at `Reader.tsx:472` prevents it).
8. With a row focused, press `ArrowUp`/`ArrowDown` — intra-list nav still works; pressing `ArrowRight` after moving to a new row uses the new row as the "previous" position for the page-change refocus.
