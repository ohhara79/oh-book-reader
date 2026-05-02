# Conditional auto-scroll in conversation thread view

## Context

While the AI is streaming an answer in `ConversationPanel`, the thread view
auto-scrolls to the bottom on every new chunk. This makes it impossible to
scroll up and re-read earlier parts of the conversation while the response is
in flight — the user is yanked back to the bottom on the next chunk.

The desired behavior is the same one ChatGPT/Claude.ai use: **auto-scroll only
when the user is already at (or very near) the bottom**. If the user has
scrolled up, leave them where they are.

## Current behavior

`components/ConversationPanel.tsx:359-365`:

```ts
useEffect(() => {
  if (!active) return;
  scrollerRef.current?.scrollTo({
    top: scrollerRef.current.scrollHeight,
    behavior: "smooth",
  });
}, [messages, streaming, active]);
```

This unconditionally scrolls to the bottom whenever `messages` changes (every
streaming chunk appends to the last assistant message), or when
`streaming`/`active` change.

The scroller container is `components/ConversationPanel.tsx:997`.

## Approach

Track a "stick to bottom" ref that reflects whether the user is at the bottom
of the scroller. Update it on user scroll events. Make the auto-scroll effect
honor it.

### 1. Add a ref to track stickiness

Near `scrollerRef` (`ConversationPanel.tsx:207`):

```ts
const stickToBottomRef = useRef(true);
```

Default `true` so the first paint of an existing thread still scrolls to the
bottom (preserves today's open-thread behavior).

### 2. Update the ref from a scroll handler

Add `onScroll` to the scroller `<div>` at line 997:

```tsx
<div
  ref={scrollerRef}
  onScroll={(e) => {
    const el = e.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 32;
  }}
  className="flex-1 overflow-auto px-4 py-3 print:overflow-visible"
>
```

Threshold: 32px — small enough that the user has to deliberately scroll up to
break stickiness, large enough to absorb sub-pixel rounding and tiny content
shifts.

### 3. Make auto-scroll conditional

Replace `ConversationPanel.tsx:359-365` with:

```ts
useEffect(() => {
  if (!active) return;
  if (!stickToBottomRef.current) return;
  scrollerRef.current?.scrollTo({
    top: scrollerRef.current.scrollHeight,
    behavior: "smooth",
  });
}, [messages, streaming, active]);
```

### 4. Re-stick on user submit

When the user submits a new question (Ask or follow-up), they clearly want to
see the response — even if they had scrolled up before submitting. Force-stick
at the top of `startNewConversationAsk` (line 408) and `sendFollowup`
(line 567):

```ts
stickToBottomRef.current = true;
```

Memo paths (`startNewConversationMemo`, `appendMemoToExisting`) don't stream,
but a memo is still a user-driven append they want to see — apply the same
line there for consistency.

### 5. Reset on thread switch

The reset effect at `ConversationPanel.tsx:309-357` already handles `active`
changes. Add inside that effect (alongside the other ref resets near
line 328):

```ts
stickToBottomRef.current = true;
```

This guarantees that when the user opens a different thread, the initial
paint scrolls to the bottom regardless of the previous thread's state.

## Why a ref, not state

Sticky-status doesn't need to trigger re-renders — it's only read inside
effects and handlers. A ref avoids unnecessary renders and the stale-closure
pitfalls of capturing state inside the SSE chunk handler.

## Why update the ref synchronously in the scroll handler (not in the effect)

When new content streams in, `scrollHeight` grows but `scrollTop` doesn't
change — so checking "near bottom" inside the auto-scroll effect would already
see the new larger `scrollHeight` and incorrectly conclude the user is no
longer at the bottom. Capturing stickiness from real scroll events (which only
fire on user interaction or programmatic scrolls, not on content-driven
layout shifts) gives us the user's *intent* rather than a post-render
measurement.

## Files modified

- `components/ConversationPanel.tsx` — only file to change
  - line 207: add `stickToBottomRef`
  - lines 309-357: reset ref on thread switch
  - lines 359-365: gate auto-scroll on the ref
  - lines 408, 473, 526, 567: force-stick in submit/append paths (Ask, Memo,
    Memo append, Follow-up)
  - line 997: attach `onScroll` to the scroller

## Verification

1. `bun dev` (or `npm run dev`) and open a book thread.
2. Open an existing thread with many messages → it should still scroll to the
   bottom on open.
3. Ask a new question → during streaming, the view should follow the bottom
   (since you were at the bottom when you submitted).
4. While the AI is still streaming, scroll up to read an earlier message →
   the view should stay where you scrolled to; new chunks should not yank you
   back down.
5. Scroll back to the bottom while still streaming → auto-follow should
   resume.
6. Scroll up, then submit a follow-up question → the view should snap to the
   bottom (submission re-sticks).
7. Switch to a different thread → it should open scrolled to the bottom.
