# Two-stage Esc in the question composer

## Context

Commit `896fd5f` ("Close conversation thread on Esc in the question composer") made Esc inside the composer textarea close the thread immediately, matching the X button. The user has since changed their mind and wants two-stage behavior, mirroring patterns like macOS sheets and IDE find boxes:

1. **First Esc while textarea is focused** → blur the textarea (no close). Focus moves to the thread-view scroller so the user can scroll messages with PgUp/PgDn/Arrow/Space.
2. **Second Esc** (textarea no longer focused) → close the thread, same as today.

This dovetails with the keyboard-only ergonomics added by `4df84ef` (focus thread scroller on reopen) and `b4b1ae5` (suppress PDF reader keys while a thread is open) — once the user has dismissed the composer, the thread view should own the keyboard until Esc again closes it.

## Change

The window-level Escape handler at `components/ConversationPanel.tsx:427-451` already does the right thing for the **second** Esc: it skips when focus is in INPUT/TEXTAREA/contenteditable, but the scroller is a `<div tabIndex={-1}>`, so Esc on it closes the thread.

The scroller already has the machinery we need:

- `tabIndex={-1}` (line 1145) — accepts programmatic focus
- `overflow-auto` (line 1158) — native keyboard scrolling once focused
- `outline-none` — no focus ring jitter

So the only edit needed is in the textarea's `onKeyDown` (lines 1252-1257): instead of calling `onClose()`, focus the scroller. Calling `.focus()` on the scroller automatically blurs the textarea (single focus invariant). The IME guard (`!e.nativeEvent.isComposing`) stays so a composition is cancelled first.

This applies uniformly to both `active.kind === "new"` and existing threads. For a brand-new thread with little content, the second Esc still closes — consistent and predictable.

### Edit

`components/ConversationPanel.tsx`, inside the textarea `onKeyDown` at lines 1253-1256:

Replace:

```tsx
if (e.key === "Escape" && !e.nativeEvent.isComposing) {
  e.preventDefault();
  onClose();
  return;
}
```

with:

```tsx
if (e.key === "Escape" && !e.nativeEvent.isComposing) {
  e.preventDefault();
  scrollerRef.current?.focus({ preventScroll: true });
  return;
}
```

`scrollerRef` is already in scope (declared at line 219). `preventScroll: true` matches the focus call in the reopen effect at line 404 so the view doesn't jump.

No other files change. No new refs, state, or effects.

## Critical files

- `components/ConversationPanel.tsx` — single edit at the textarea `onKeyDown` (~line 1253)

## Verification

1. Open an existing thread with enough messages to scroll. Click into the textarea, type a few characters.
2. Press Esc once → cursor leaves the textarea, the textarea loses its focus border, thread stays open. Drafted text is preserved.
3. Press PgDn / PgUp / Arrow / Space → the thread scroller scrolls (confirms scroller has focus, not the document body).
4. Press Esc a second time → thread closes; per `e2964df`, focus returns to the originating PDF amber box.
5. Open a new thread by drag-selecting on the PDF (`active.kind === "new"`). Composer auto-focuses. Press Esc once → composer blurs, scroller is focused. Press Esc again → thread closes.
6. IME check (if available): start a Japanese/Korean composition in the textarea, press Esc → composition cancels, textarea remains focused (no blur, no close). Press Esc again → blur to scroller. Press Esc a third time → closes.
7. Cmd/Ctrl+Enter (memo) and Enter (ask) submission paths still work — no regression.
8. Title input (`titleInputRef`) behavior is unchanged — out of scope.

Type-check: `npx tsc --noEmit`.
