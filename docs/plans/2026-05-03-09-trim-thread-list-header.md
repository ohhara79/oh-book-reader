# Trim "Ask AI" label and thread count from thread-list header

## Context

The conversation thread list view's header bar showed two pieces of low-value chrome:

1. **"Ask AI"** — a static label rendered on the left side of the header whenever no conversation is active. It's just a label; the panel is self-evidently the AI panel.
2. **"5 threads" / "1 thread"** — a count rendered on the right side of `ThreadListControls`, redundant with the visible list below.

Removing both reclaims horizontal space in the header (which is tight on narrow screens — the bar is `flex-wrap` and currently wraps to two rows easily). Left side of the header is intentionally empty in thread-list mode.

## Changes

### 1. Remove "Ask AI" fallback label

**File:** `components/ConversationPanel.tsx`

Drop the `"Ask AI"` branch from the title fallback `<span>`. Keep `"New entry"` and `"Thread"` since those still apply when an active conversation has no `rawConversation` yet (e.g., still loading).

```tsx
<span className="font-medium">
  {active?.kind === "new"
    ? "New entry"
    : active?.kind === "existing"
      ? "Thread"
      : null}
</span>
```

The wrapper `<div>`'s conditional classes (`min-w-0 shrink-0` vs `min-w-0 flex-1`) keep the layout sane whether or not it has content; when empty in thread-list mode, the controls `<div className="ml-auto">` still anchors right correctly.

### 2. Remove thread count display

**File:** `components/ThreadList.tsx`

- Delete the `<span>` that renders `{count} {count === 1 ? "thread" : "threads"}`.
- Remove `count: number;` from `ThreadListControlsProps`.
- Remove `count` from the destructured props.

**File:** `components/ConversationPanel.tsx`

- Remove `count={threadListState.visibleRows.length}` from the `<ThreadListControls>` usage.

## Critical files

- `components/ConversationPanel.tsx` — header rendering
- `components/ThreadList.tsx` — `ThreadListControls` component

## Verification

1. `npm run dev` and open a book with at least one thread.
2. Thread-list mode (no conversation selected): confirm the header shows only the filter and sort toggles on the right, with no "Ask AI" label and no thread count.
3. Open an existing thread: header should show the thread title on the left and action buttons on the right — unchanged.
4. Start a new entry: header should show "New entry" on the left — unchanged.
5. Empty state (zero threads): header bar should still render its border and padding, just with no inner content on the left.
6. `npx tsc --noEmit` passes.
