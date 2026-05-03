# Focus thread view scroller after re-opening a thread

## Context

When the user re-opens an existing conversation thread from the thread list (mouse click or keyboard Enter), focus stays on the clicked thread button in the list. As a result, PgUp/PgDn/ArrowUp/ArrowDown do nothing useful — the user can't scroll the message view with the keyboard until they manually click somewhere in the thread view.

The user wants focus to land in the thread view's scrollable container after re-open so the browser's built-in keyboard scrolling (PgUp/PgDn/Arrow keys) just works.

Current state (verified):
- `components/ConversationPanel.tsx:1140-1154` — the scrollable container `<div ref={scrollerRef} className="flex-1 overflow-auto …">` has no `tabIndex`, so it cannot receive focus.
- `components/ConversationPanel.tsx:398-405` — an effect focuses the composer textarea only when `active.kind === "new"`. There is no focus management for `active.kind === "existing"`.
- `components/ConversationPanel.tsx:424-448` — a window-level keydown handler intercepts only `Escape` and `Delete` (and ignores events from inputs), so it won't conflict with native scrolling on the focused scroller.

## Change

### 1. Make the scroller focusable

`components/ConversationPanel.tsx:1140-1154` — add `tabIndex={-1}` and a focus-outline suppression class to the scroller div:

```tsx
<div
  ref={scrollerRef}
  tabIndex={-1}
  onScroll={…}
  className="flex-1 overflow-auto px-4 py-3 outline-none print:overflow-visible"
>
```

`tabIndex={-1}` (rather than `0`) keeps the scroller out of the Tab order — Tab should still reach the composer/buttons, not a passive scroll region — while allowing programmatic `.focus()` and click-to-focus. `outline-none` suppresses the focus ring around the whole message area, which would be visually noisy.

### 2. Focus the scroller when an existing thread becomes active

`components/ConversationPanel.tsx:398-405` — extend the existing focus effect to handle the existing-thread case alongside the new-thread case:

```tsx
useEffect(() => {
  if (!active) return;
  const handle = requestAnimationFrame(() => {
    if (active.kind === "new") {
      composerRef.current?.focus();
    } else {
      scrollerRef.current?.focus({ preventScroll: true });
    }
  });
  return () => cancelAnimationFrame(handle);
}, [active]);
```

`preventScroll: true` avoids fighting the smooth scroll-to-bottom in the sibling effect at `:389-396`. Re-runs on every `active` change, so navigating from one existing thread to another (e.g., via a referenced-thread link in `MessageBubble`) also re-focuses the scroller.

## Files to modify

- `components/ConversationPanel.tsx` — two small edits described above.

No other files need to change. The `ThreadList` `onOpen` path (`components/ThreadList.tsx:374` for clicks, native button activation for Enter) and the Reader-level handler (`components/Reader.tsx:1035-1038`) already drive this through `active`, so the new effect catches both mouse and keyboard re-opens.

## Verification

1. From the thread list, click a thread → press PgDn / PgUp / ArrowDown / ArrowUp; the message view scrolls.
2. From the thread list, ArrowDown to a thread and press Enter → same: keyboard scrolling works immediately.
3. Inside an existing thread, click a referenced-thread link in a `MessageBubble` to navigate to another existing thread → keyboard scrolling works in the new thread without an extra click.
4. Drag a rectangle on the page to start a *new* thread → composer textarea is focused (existing behavior preserved; cursor is in the input).
5. With the scroller focused, press `Escape` → thread closes (window handler still fires; scroller is not an input).
6. Press `Tab` from the focused scroller → focus moves to the composer (or next interactive control), not back to the scroller (since `tabIndex={-1}`).
7. Click inside the message area of an open thread → focus returns to the scroller, so keyboard scrolling resumes.

Type-check: `npx tsc --noEmit`.
