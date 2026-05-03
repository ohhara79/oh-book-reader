# Skip composer auto-focus when re-opening an existing thread

## Context

`2026-05-03-02-focus-composer-on-thread-open.md` added an effect that focuses the composer textarea whenever a thread becomes `active`, regardless of whether it was just created from a fresh selection or re-opened from the thread list / `?c=` deep-link.

In practice, opening an existing thread is almost always a "go back and read what was discussed" action, not a "ask another follow-up" action. Auto-focusing the composer in that case is annoying — it can shift the viewport, steal focus from selecting/scrolling within the loaded messages, and pulls the eye to the bottom of the panel instead of the conversation content. Auto-focus on a *new* thread is still useful (the user just selected text intending to ask about it).

## Approach

Narrow the existing focus effect in `components/ConversationPanel.tsx` (lines 389–395) so it only fires when `active.kind === "new"`. The discriminated union (`{ kind: "new" } | { kind: "existing" }`, defined ~lines 133–135) is already in scope, so this is a one-line guard.

### Critical file

- `components/ConversationPanel.tsx` — only file touched.

### Change

```tsx
useEffect(() => {
  if (!active) return;
  if (active.kind !== "new") return;     // skip for re-opened existing threads
  const handle = requestAnimationFrame(() => {
    composerRef.current?.focus();
  });
  return () => cancelAnimationFrame(handle);
}, [active]);
```

That is the entire diff.

### What stays the same

- The post-streaming refocus effect at lines 397–405 (driven by `refocusComposerRef`) is untouched. After the user submits a message in a re-opened thread, focus still returns to the composer when streaming/posting completes.
- The reset effect at lines 324–363 still runs first to clear state and trigger `loadConversation` for existing threads — skipping focus does not interfere with loading.
- The new-thread path is unchanged.

## Verification

1. `npm run dev`, open a book.
2. Drag a selection on a page → composer is focused (caret blinking). ✅ new-thread focus preserved.
3. Click an existing thread in the Library list → messages load, composer is **not** focused, page does not scroll, you can immediately ArrowUp/Down inside the thread list or scroll the conversation. ✅ re-open behavior fixed.
4. Open an existing thread via `?c=<id>` deep-link → composer is **not** focused.
5. Click into the composer of a re-opened thread, type, submit → after the response finishes, focus returns to the composer. ✅ post-message refocus still works.
6. Switch from one existing thread to another via the list → composer stays unfocused.
7. Press `Esc` to close, then drag a fresh selection → composer focuses again.
8. `npx tsc --noEmit` passes.
