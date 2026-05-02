# Fix auto-scroll losing the bottom during fast streaming

## Context

`docs/plans/2026-05-02-33-conditional-auto-scroll-during-streaming.md` (commit
`b8686a6`) added `stickToBottomRef` to pause auto-scroll while the user has
scrolled up. It works for slow streams but breaks when a burst of text arrives
at once: the view sometimes stops following the bottom partway through the
response and stays "stuck at the last point," even though the user never
scrolled.

## Current behavior

`components/ConversationPanel.tsx`:

```tsx
onScroll={(e) => {
  const el = e.currentTarget;
  const distanceFromBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottomRef.current = distanceFromBottom <= 32;
}}
```

The flag is recomputed from distance-to-bottom on every scroll event. The
effect that auto-scrolls runs `scrollTo({ top: scrollHeight, behavior: "smooth" })`,
which animates `scrollTop` over hundreds of ms.

Failure mode:

1. New tokens arrive → `scrollHeight` jumps.
2. Effect kicks off a smooth scroll toward the new `scrollHeight`.
3. Before the animation finishes, **another** chunk arrives → `scrollHeight`
   jumps again, further ahead of the still-catching-up `scrollTop`.
4. The in-flight smooth scroll keeps firing `onScroll` events. Each computes
   `distanceFromBottom = (new big scrollHeight) − (lagging scrollTop) − clientHeight`,
   which is `> 32`.
5. `stickToBottomRef.current` flips to `false` even though the user is idle.
6. The effect for the next chunk no longer scrolls. The view stays where the
   in-flight animation last reached.

The check conflates "user scrolled up" with "smooth scroll is lagging behind
growing content," because it only looks at distance.

## Approach

Use the **direction `scrollTop` moves** as the discriminator instead of
distance:

- A programmatic `scrollTo` toward the bottom only ever *increases* `scrollTop`.
- Only the user can *decrease* `scrollTop` (wheel up, touch drag, scrollbar
  drag, PageUp).

So:

- `scrollTop` decreased → user scrolled up → unstick.
- At/near bottom (`distanceFromBottom <= 32`) → re-stick (covers user
  scrolling back down).
- Otherwise → leave the flag alone. A smooth-scroll animation lagging behind
  growing content no longer trips it.

### 1. Track previous scrollTop

In `components/ConversationPanel.tsx`, alongside `stickToBottomRef`:

```ts
const lastScrollTopRef = useRef(0);
```

Reset it in the conversation-change effect alongside the existing
`stickToBottomRef.current = true`:

```ts
lastScrollTopRef.current = 0;
```

### 2. Direction-aware onScroll handler

```tsx
onScroll={(e) => {
  const el = e.currentTarget;
  const newScrollTop = el.scrollTop;
  const distanceFromBottom =
    el.scrollHeight - newScrollTop - el.clientHeight;
  if (newScrollTop < lastScrollTopRef.current - 1) {
    stickToBottomRef.current = false;
  } else if (distanceFromBottom <= 32) {
    stickToBottomRef.current = true;
  }
  lastScrollTopRef.current = newScrollTop;
}}
```

The `- 1` tolerance absorbs sub-pixel jitter from the smooth-scroll animation.

The rest of the previous commit (resetting `stickToBottomRef.current = true`
on send/regenerate, the auto-scroll effect itself) stays as is.

## Why this holds up

| Situation | `scrollTop` behavior | Result |
|---|---|---|
| Idle stream, smooth scroll catching up to growing content | monotonically increases | flag stays `true`, scroll keeps chasing |
| User wheels / touch-drags / drags scrollbar up | decreases | flag flips to `false` |
| User scrolls back to bottom | increases until `distanceFromBottom <= 32` | flag flips to `true` |
| User holds position while content grows | unchanged | flag unchanged |

Edge case: if `scrollHeight` shrinks below `scrollTop + clientHeight` (e.g. a
message gets collapsed), the browser clamps `scrollTop` downward, which the
direction check would read as a user scroll-up. Acceptable — that only
happens on an explicit user UI action, where unsticking is the safe default.

## Verification

1. `npm run dev` and open a conversation.
2. Ask a long question that produces a fast, multi-paragraph reply. Confirm
   the view tracks the bottom all the way through, even when chunks land in
   bursts. (This is the case that was broken.)
3. During streaming, scroll up with the mouse wheel — auto-scroll should
   pause.
4. Scroll back to the bottom — auto-scroll should resume on the next chunk.
5. Scroll up using the scrollbar drag — auto-scroll should also pause
   (covers the "no wheel/touch event" path).
6. Switch threads while one is streaming, then come back — bottom-stick is
   re-enabled by the existing reset.
