# Show thread list in the empty conversation panel

## Context

When `ConversationPanel` had no `active` thread, it wasted the entire sidebar on a single instructional paragraph telling users how to drag a rectangle and use Memo / Ask. Threads were only reachable by finding the right pin on the page.

Selections and conversations were already loaded eagerly in the parent `Reader` (`selections`, `convsBySelection` from `/api/books/[id]/selections`) and used to render pins, so a thread list could be shown in the empty panel without any new fetch. Clicking a list item should reuse the same `setActive({ kind: "existing", conversationId })` path that pin clicks already take in `Reader.onPinClick`, so URL/share-link behavior stays consistent.

## Files changed

- `components/ThreadList.tsx` — **new**. Segmented filter ("This page" / "All pages") plus the list itself.
- `components/ConversationPanel.tsx` — extended `Props` with `selections`, `convsBySelection`, `onOpenConversation`. Replaced the `isEmpty` branch to render `ThreadList` when the book has any threads, and fall back to the original onboarding paragraph only when the book has zero threads.
- `components/Reader.tsx` — passes `selections`, `convsBySelection`, and a one-line opener that calls `setActive({ kind: "existing", conversationId })` to `<ConversationPanel />`.

## Implementation

### `ThreadList`

- Local state `useState<"page" | "all">("page")`. Defaults to "This page" so the user sees threads tied to where they are reading.
- `allRows` is built once per `selections` / `convsBySelection` change: a `Map<selectionId, number[]>` of de-duplicated, sorted span pages, then a flat `Row[]` of `{ conv, selectionId, pages }`. Sort by `updated_at` desc with a stable `id` tiebreak.
- `visibleRows` is `allRows` for "all", or `allRows.filter((r) => r.pages.includes(currentPage))` for "page".
- Each row is a single `<button>` showing title (truncated), a page badge (`p.12` or `p.12–14` from min/max of the spans), and a timestamp via the existing `formatTimestamp` helper.
- "This page" empty state shows "No threads on page N" with a "View all threads" button that flips the filter — only rendered if `allRows.length > 0`.
- Types `ThreadListSelection` and `ThreadListConv` are declared and exported from `ThreadList.tsx`. They are structurally compatible with Reader's local `Sel` / `ConvSummary` so no shared types module was needed (matching the existing pattern of redeclaring small shapes locally, e.g. `Turn` / `ContentBlock` in `ConversationPanel.tsx`).

### `ConversationPanel`

- New prop `onOpenConversation: (conversationId: string) => void`.
- Computed `totalThreadCount` (memoized over `convsBySelection`) drives the empty-state branching:
  - `totalThreadCount === 0` → original instructional paragraph (correct onboarding when nothing exists yet).
  - Otherwise → `<ThreadList />` plus a one-line "Drag a rectangle on the page to start a new thread." hint underneath, preserving discoverability of the create-flow.
- The existing `isEmpty = !active` and the surrounding `scrollerRef` / `error` block are unchanged.

### `Reader`

- The `<ConversationPanel />` call site now passes `selections={selections}`, `convsBySelection={convsBySelection}`, and `onOpenConversation={(id) => setActive({ kind: "existing", conversationId: id })}`. The `key` prop logic is unchanged, so opening a thread from the list re-mounts the panel exactly like opening from a pin.

## Edge cases

- **Multi-page selection** (spans cover pages 12–14): included in "This page" if any span matches `currentPage`; badge displays the range.
- **Selection with no spans** (shouldn't happen, but defensive): `pages = []`, badge is empty, never matches the per-page filter.
- **Zero threads in the whole book** → original onboarding paragraph; the list never shows.
- **Zero threads on the current page but threads elsewhere** → "No threads on page N" with a "View all threads" link that flips the filter.
- **Newly-created thread** → after `onCreated()` triggers `refreshSelections()` in `Reader`, the new conversation appears in the list on the next empty render.
- **Filter resets on remount**: the filter is local state in `ThreadList`, which is mounted inside the `key="empty"` instance of `ConversationPanel`. Switching to a thread and back re-mounts and resets the filter to "This page" — desirable, since the user's reading context may have moved.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run dev`, open a book that already has several threads spread across multiple pages.
3. Close any open thread (X button); the panel shows the thread list with "This page" selected.
4. Scroll between pages; the list re-filters automatically as `pageNum` changes.
5. Toggle "All pages"; every thread appears, sorted newest-first, each with its page badge.
6. Click a row; the panel switches to the existing-thread view (same as clicking the pin).
7. Open a fresh book with zero threads; the original onboarding paragraph still shows.
8. On a page with no threads while others exist, the "No threads on page N" + "View all threads" link works.
