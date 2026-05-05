# Browser back button closes the conversation thread

## Context

In the conversation thread view, the **Esc** key currently closes the open thread and returns to the thread list. The user wants the **browser back button** to do the same thing — so the natural "go back" gesture (mouse back-button, swipe-back on touchpads, browser UI back) behaves identically to Esc.

Today, opening/closing a thread is purely React state (`active` in `Reader.tsx`); the URL never changes, and the back button navigates away from the page entirely. That breaks user expectation when the thread feels like a modal/page they should be able to back out of.

## Change

All edits are in **`/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`**. No changes to `Reader.tsx` or routing.

Add a **new useEffect** in `ConversationPanel`, placed next to the existing keydown effect (~line 535). Pattern: when the thread opens, push a synthetic history entry; listen for `popstate` to close; on cleanup, pop our entry only if it's still on top (guards against StrictMode dev double-invoke).

```tsx
useEffect(() => {
  if (!active) return;
  let poppedByBrowser = false;
  window.history.pushState({ __threadModal: true }, "");
  const onPop = () => {
    poppedByBrowser = true;
    onCloseRef.current();
  };
  window.addEventListener("popstate", onPop);
  return () => {
    window.removeEventListener("popstate", onPop);
    if (!poppedByBrowser && window.history.state?.__threadModal) {
      window.history.back();
    }
  };
}, [!!active]);
```

Notes:
- Boolean dep `[!!active]` so switching from one thread to another does **not** churn the history stack — only open/close transitions push/pop.
- `history.state?.__threadModal` guard in cleanup is essential for React StrictMode (Next 15 has it on by default): the dev double-invoke would otherwise call `history.back()` after the synthetic entry has already been popped, fighting itself.
- The synthetic entry does not change the URL — pre-existing inbound `?c={id}` deep-linking (Reader.tsx:207-210) is unaffected.
- The existing Esc keydown handler at lines 510-534 is untouched.

## Out of scope

- **Backspace key**: dropped per user — browser back is enough, and binding global Backspace is non-standard.
- **URL sync on close**: if a user lands on `…?c=abc`, presses back, the thread closes but `?c=abc` stays in the URL (so a refresh would reopen). The user's request is "back button = Esc"; URL sync is a separate concern. Flagged so it's an explicit decision, not an oversight.
- Touch/swipe-back gestures emit `popstate` like the back button, so they get the new behavior for free.

## Critical files

- `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx` — single new useEffect inserted after the existing keydown effect (~line 535).

## Verification

Run `npm run dev` and open a book with at least one thread. For each case below, the thread should close and return to the list (where indicated):

1. **Esc** — baseline, must still work.
2. **Browser back button** (mouse button, keyboard shortcut, or browser UI) — closes the thread.
3. **Switch threads** by clicking another thread in the list, then press back — should close to the list (not bounce through the previously-open thread).
4. **Open via shared URL `?c={id}`**, then press back — thread closes; pressing back again leaves the page.
5. **Close via Esc**, then press browser back — should leave the page (no stale synthetic entry left behind).
6. **In dev (StrictMode on)** — open and close a thread several times; the thread should not flicker closed-then-open or vice versa from double-invoked effects.
