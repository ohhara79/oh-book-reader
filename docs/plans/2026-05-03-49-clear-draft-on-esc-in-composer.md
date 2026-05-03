# Clear composer draft on first Esc

## Context

The previous change (`af10209`, plan `2026-05-03-48`) made Esc in the question composer two-stage: first Esc focuses the thread scroller (implicitly blurring the textarea), second Esc closes the thread.

The user wants the first Esc to also discard the in-progress draft — text, attachments, and referenced threads — so the composer is empty when they return to it. Today, blurring leaves the draft sitting there; the user has to manually delete it before typing a fresh question.

This matches the post-submit reset (`ConversationPanel.tsx:858-860` for memo, `877-879` for ask) and the panel-close reset (`333-372`), which both clear exactly that trio.

## Change

`components/ConversationPanel.tsx`, inside the textarea `onKeyDown` Escape branch (introduced at lines 1253-1257), add three setter calls before focusing the scroller:

```tsx
if (e.key === "Escape" && !e.nativeEvent.isComposing) {
  e.preventDefault();
  setQuestion("");
  setAttachments([]);
  setReferencedThreads([]);
  scrollerRef.current?.focus({ preventScroll: true });
  return;
}
```

State setters batch with the focus call; order is purely for readability. All three setters are already in scope (declared at lines 202-206).

### Out of scope (intentionally)

- The "referenced thread" picker state (`refInputOpen`, `refInputValue`) is not cleared. The picker is a separate input with its own Esc handler that closes the picker; if the picker is open, focus is on the picker input, not the textarea, so this Esc branch doesn't fire.
- The title-edit input (`titleInputRef`) is not affected — its Esc behavior is unchanged.
- The IME guard (`!e.nativeEvent.isComposing`) is preserved so an in-flight composition is cancelled first.

## Critical files

- `components/ConversationPanel.tsx` — three lines added inside the textarea `onKeyDown` Escape branch (~line 1255)

## Verification

1. Open a thread, type some text in the composer, attach an image, paste a thread reference URL → composer shows text, attachment thumbnail, and referenced-thread chip.
2. Press Esc once → text, attachment, and reference all clear; textarea blurs; scroller takes focus. Thread stays open.
3. Press PgDn / PgUp → thread scrolls.
4. Press Esc again → thread closes (no second-stage regression).
5. Reopen the same thread → composer is empty (the cleared state is per-session anyway, but verify nothing leaked).
6. Type text, start a Korean/Japanese IME composition, press Esc mid-composition → composition cancels, draft is preserved (IME guard still works). Press Esc again → draft clears, blurs to scroller.
7. Cmd/Ctrl+Enter (memo) and Enter (ask) submission paths still work and still clear the draft on success — no regression.

Type-check: `npx tsc --noEmit`.
