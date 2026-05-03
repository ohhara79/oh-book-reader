# Suppress PDF reader keys while a conversation thread is open

## Context

After `2026-05-03-45-focus-thread-scroller-on-reopen.md`, opening an existing thread moves focus to the message-view scroll container so the browser can natively scroll on PgUp/PgDn/Home/End/ArrowUp/ArrowDown. In practice that didn't work: the PDF reader registers a **window-level** `keydown` listener at `components/Reader.tsx:448-518` that maps PgUp/PgDn/Arrow/Home/End/Space to PDF page navigation, plus `+`/`-`/`0` to zoom and `\\` to sidebar toggle. The handler `preventDefault`s these keys before the browser can scroll the focused element, so PDF navigation kept winning even with the thread scroller focused.

The user wants all of these PDF-reader keys suppressed while a conversation thread is open, for consistency — so the thread view owns the keyboard while it's active.

## Change

`components/Reader.tsx:448-518` — bail out of the window keydown handler when `active` (the open conversation, declared at `:108`) is set:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (active) return;
    const t = e.target as HTMLElement | null;
    // …existing input/textarea/modifier guards and switch…
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [active, goPrev, goNext, scrollToPage, numPages, handleScaleChange]);
```

Two edits:
1. Add `if (active) return;` as the first statement inside `onKey`.
2. Add `active` to the effect's dependency array so the guard re-binds with current state.

This suppresses *all* keys the handler owns (page nav, zoom, sidebar toggle) whenever a thread is open — a single rule, easy to reason about. The thread view's own Escape/Delete handler at `components/ConversationPanel.tsx:424-448` is a separate listener and continues to work.

## Files to modify

- `components/Reader.tsx` — two small edits inside the existing keydown effect.

## Verification

1. With no thread open: PgUp/PgDn/Arrow/Space/Home/End still flip PDF pages; `+`/`-`/`0` still zoom; `\\` still toggles the sidebar (existing behavior preserved).
2. Open an existing thread (mouse click or ArrowDown+Enter from the list). Press PgDn / PgUp / Home / End / ArrowUp / ArrowDown → the message view scrolls; the PDF page does *not* change.
3. While the thread is open, press `+` / `-` / `0` / `\\` → nothing happens (PDF zoom and sidebar toggle are suppressed).
4. While the thread is open, press ArrowLeft / ArrowRight → nothing happens (no horizontal scroll, but also no PDF page flip).
5. Close the thread (Esc or X) → all PDF keys work again immediately, with no extra click.
6. Start a *new* thread by dragging a rectangle → composer textarea is focused; PDF keys are suppressed (composer typing isn't disturbed by PDF nav).

Type-check: `npx tsc --noEmit`.
