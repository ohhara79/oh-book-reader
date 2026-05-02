# Preserve thread-list scroll position across open/close

## Context

In the conversation panel's thread list view, clicking a thread to open it and
then closing the detail view causes the list to reappear scrolled to its
**bottom**, regardless of where the user had been scrolled when they clicked.
The user expects the list's scroll position to be preserved across the
open/close round-trip — i.e. they should be returned to roughly where they
clicked.

## Root cause

Three interacting issues:

1. **Forced remount on every list ↔ detail transition.** `Reader.tsx:822-829`
   keys `<ConversationPanel>` by the active conversation id (or `"empty"` /
   `"new"`), so React unmounts and remounts the entire panel each time `active`
   changes. The internal `scrollerRef` (`ConversationPanel.tsx:196`) is a fresh
   DOM node on each mount, so any scroll position is lost.

2. **Auto-scroll-to-bottom fires on every mount, including the empty/list
   state.** `ConversationPanel.tsx:348-353` runs:

   ```ts
   useEffect(() => {
     scrollerRef.current?.scrollTo({
       top: scrollerRef.current.scrollHeight,
       behavior: "smooth",
     });
   }, [messages, streaming]);
   ```

   On mount, `messages = []` so the dependency triggers, and `scrollerRef`
   points at the same shared `<div>` that holds the thread list when
   `isEmpty === true` (`ConversationPanel.tsx:976-998`). Result: the list view
   is animated to its bottom every time the panel remounts in empty state.

3. **`useThreadListRows` hydrates filter/sort from localStorage in a
   post-paint `useEffect`** (`ThreadList.tsx:65-80` originally). On the first
   render of a fresh ConversationPanel mount, filter defaults to `"page"`, so
   `visibleRows` is short (only threads on the current page) and
   `scrollHeight` is small. Any layout-effect-based scroll restoration runs
   against that short list, and the browser clamps the requested `scrollTop`
   to ~0. After paint, the hydration effect switches filter to the persisted
   value (e.g. `"all"`), the list grows tall — but it's too late, the
   restoration window has passed.

So closing a thread doesn't merely fail to restore position — it actively
scrolls the user to the end of the list. And a naive `useLayoutEffect` fix
lands at the top because the list isn't its full height yet.

## Approach

Three small, surgical changes:

### A) Stop the bottom-scroll effect from firing in list view

In `components/ConversationPanel.tsx:348-353`, gate the effect on having an
active thread (or, equivalently, on `messages.length > 0`). Cleanest:

```ts
useEffect(() => {
  if (!active) return;
  scrollerRef.current?.scrollTo({
    top: scrollerRef.current.scrollHeight,
    behavior: "smooth",
  });
}, [messages, streaming, active]);
```

This alone fixes the "scrolls to bottom" symptom. On its own it leaves the
list at scroll-top after a remount, which is better than the current behavior
but still not what the user asked for.

### B) Preserve the list scroll position across the panel's remount

The remount means we cannot keep state inside `ConversationPanel`. Instead,
hold the scroll position in a ref on the parent, which survives the remount.

**`components/Reader.tsx`:**
- Add `const threadListScrollTopRef = useRef(0);` near the other refs
  (around `Reader.tsx:122-123`).
- Pass two new props to `<ConversationPanel>` at `Reader.tsx:822`:
  - `initialListScrollTop={threadListScrollTopRef.current}` — read on mount.
  - `onListScrollSave={(top) => { threadListScrollTopRef.current = top; }}`.

**`components/ConversationPanel.tsx`:**
- Add the two props to the props type and destructure them.
- Wrap the `onOpen` passed to `<ThreadList>` (currently
  `ConversationPanel.tsx:991`, `onOpen={onOpenConversation}`) so it captures
  `scrollerRef.current?.scrollTop` and calls `onListScrollSave(top)`
  immediately before `onOpenConversation(id)`. This is the only moment that
  matters — no scroll listener needed.
- Add a `useLayoutEffect` that runs once on mount and, only when `isEmpty`,
  sets `scrollerRef.current.scrollTop = initialListScrollTop`. Use a layout
  effect (not a regular effect) so the restoration happens before paint and
  the user never sees a flash at top. Guard with a `restoredRef` so it runs
  exactly once per mount.

The capture point (just before opening a thread) and the restore point (mount
in empty state) line up exactly with the open/close round-trip the user
described.

### C) Hydrate `useThreadListRows` synchronously

In `components/ThreadList.tsx`, switch the filter/sort initialization from
post-paint `useEffect` to lazy `useState` initializers that read
`localStorage` directly. The book page is rendered with `ssr: false`
(`app/books/[bookId]/page.tsx:6`), so `window` / `localStorage` are available
during the initial render — no SSR/hydration mismatch risk.

```ts
const [filter, setFilter] = useState<FilterMode>(() => {
  const stored = readThreadListState();
  if (stored?.filter === "all" || stored?.filter === "page") {
    return stored.filter;
  }
  return "page";
});
const [sort, setSort] = useState<SortMode>(() => {
  const stored = readThreadListState();
  if (stored?.sort === "date" || stored?.sort === "page") {
    return stored.sort;
  }
  return "date";
});

useEffect(() => {
  localStorage.setItem(THREAD_LIST_KEY, JSON.stringify({ filter, sort }));
}, [filter, sort]);
```

The previous `hydrated` flag becomes unnecessary — the very first run of the
write effect now persists the just-read values (idempotent for an existing
user; for a brand-new user it persists the defaults, which is harmless).

This makes `visibleRows` stable from render #1, so the layout effect in (B)
runs against the full-height list and the requested `scrollTop` is no longer
clamped to 0.

## Files modified

- `components/Reader.tsx` — add `threadListScrollTopRef`; pass two new props
  to `<ConversationPanel>` at line 822.
- `components/ConversationPanel.tsx` — accept two new props; gate the
  bottom-scroll effect on `!isEmpty`; capture `scrollTop` in the `onOpen`
  wrapper passed to `<ThreadList>`; add a one-shot `useLayoutEffect` to
  restore scroll on mount when in list view.
- `components/ThreadList.tsx` — hydrate filter/sort synchronously via lazy
  `useState` initializers; drop the `hydrated` flag.

## Scope notes

- **In-memory only.** The position lives in a ref in `Reader`, so it survives
  ConversationPanel remounts during a session but resets on page reload. This
  matches the user's stated request and keeps the diff minimal. Persisting
  across reloads (e.g. `sessionStorage`) is a trivial follow-up if wanted.
- **Click-time capture, not scroll-time.** Reading `scrollerRef.scrollTop` at
  the moment of click is sufficient and avoids attaching a scroll listener.
- **No change to `ThreadList.tsx`.** Its `onOpen(id)` contract is untouched;
  the wrapping happens in `ConversationPanel`.

## Verification

Manual, in a book with enough threads to make the list scroll:

1. Scroll the thread list partway down. Click a thread in the middle. Close
   it with the header X button (`onClose` at `Reader.tsx:839`). The list
   should reappear at the position where the click happened (within a row's
   height — the clicked button is what's restored, not the exact pixel).
2. Click a thread near the top; close — list should be at/near top.
3. Click the very last thread; close — list should be near the bottom.
4. Change the filter or sort in the pinned controls (`Reader.tsx:825-829`
   indirectly, controls live in the panel header) and confirm the list still
   behaves correctly. Note that the saved scrollTop may no longer match a
   meaningful row after a filter change, which is acceptable — the row count
   has changed.

Regressions to watch for:

- Open an existing thread with multiple messages: messages should still
  scroll to the bottom on open and as new tokens stream in (the gate on
  `!isEmpty` should leave detail-view behavior untouched).
- Drag-select a region on the page to start a new Ask: the empty-form view
  should appear normally; closing it should still return to the list at its
  prior position.
- Cold load with `?c=<id>` in the URL (`active` already set on first render):
  the panel mounts directly in detail view, so the new layout effect should
  short-circuit on `isEmpty === false`.

Type/lint: run the project's typecheck / build to confirm the new prop type
on `ConversationPanel` propagates cleanly.
